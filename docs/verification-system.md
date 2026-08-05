# Verifier system and versioning

This guide explains how a Spilled node earns the right to serve the public
internet, which versions of the server and verifier are compatible, and the
exact steps to add a new server so it reaches `verified` on the first or second
verifier pass.

## 1. The three gates

A node is not trusted because it says so. Three independent parties must agree
before a node appears in discovery and receives client tickets:

1. **Identity (the node itself).** On first start the node generates an
   Ed25519 node identity (`nodeId` is derived from the public key), an X25519
   transport keypair, and a `keyVersion`. It signs
   `{ nodeId, transportPublicKey, keyVersion }` with its Ed25519 key
   (`transportKeySignature`) and applies to the control plane:

   ```text
   POST /server/v2/nodes/apply
   ```

   The control plane stores the registration as `pending`. The application is
   authorized by `SPILLED_CONTROL_PLANE_SECRET` plus the node's
   `applicationSignature`.

2. **Reachability (the gateway).** The node opens an outbound WebSocket to the
   gateway and stays connected:

   ```text
   wss://<gateway>/v2/nodes/<nodeId>/connect?role=node
   ```

   It authenticates with the gateway enrollment credential issued during
   enrollment. The Cloudflare Durable Object relays encrypted RPC frames
   between clients and the node, and every heartbeat interval it tells the
   control plane:

   ```text
   POST /server/v2/gateway/heartbeat   { "nodeId": "<nodeId>" }
   ```

   A node is *online* only while its heartbeat `expiresAt` is in the future.
   The gateway never sees plaintext; it attests connectivity and quotas only.

3. **Capability (the verifier).** An automated verifier independently probes
   each advertised capability through the gateway and reports the outcome.

All three must pass, and the control plane is the single source of truth.

## 2. Versioning rules

The only compatibility requirement is that the server, the verifier, and the
control plane all speak **protocol version 2** (`NODE_PROTOCOL_VERSION = 2`,
see `packages/node-protocol/src/index.ts`). Protocol version 1 is legacy.

| Component | Source | What must match |
|---|---|---|
| Server (node) | This repository build; Windows installer `Spilled-Server-Setup-<version>-x64.exe` or `docker-compose.node.yml` | Reports `protocolVersion: 2` |
| Verifier binary | `kao-offline/spilled-black-box` GitHub release `v1.0.0` (`spilled-verifier-*-{linux-x64,linux-arm64,windows-x64}`) or `docker-compose.verifier.yml` | Requires `protocolVersion === 2` on every candidate |
| Control plane | Convex deployment of this repository's `convex/` | Exposes `/server/v2/*`; rejects `protocolVersion !== 2` in `/server/v2/nodes/apply` |

The checks that enforce this:

- `POST /server/v2/nodes/apply` rejects any application whose
  `protocolVersion !== 2` (`convex/http.ts`).
- The verifier refuses to accept a candidate's identity unless
  `protocolVersion === 2` (`apps/verifier/src/index.ts`).
- The verifier re-validates the identity signature over
  `{ nodeId, transportPublicKey, keyVersion }` with the stored Ed25519 public
  key on every pass, so a node that rotates transport keys without re-enrolling
  becomes `quarantined`.

Practical rule: keep server and verifier from the **same protocol generation**
(currently v2). A v1-era server cannot enroll into the v2 system, and a verifier
older than protocol v2 would mark every v2 node `quarantined`.

### Key version vs protocol version

`keyVersion` is not a protocol version. It is incremented when a node rotates
its transport keys. The verifier validates that the signature was produced with
the *current* key material; it does not require a specific number. On key
rotation, re-run enrollment so the control plane records the new public key.

## 3. How verification works, end to end

The verifier runs one pass immediately on start, then every 60 seconds:

```text
GET /server/v2/nodes/verification-candidates?limit=20
```

Candidates are selected in priority order: `pending` first, then `degraded`,
then `verified`. Verified nodes stay eligible so a single stale capability can
recover without resetting the whole node.

For each candidate:

1. **Validate identity.** `protocolVersion === 2` and the
   `transportKeySignature` verifies against `ed25519PublicKey`.
2. **Probe each advertised capability**, but only when identity is valid and
   the node is online:
   - `POST /server/v2/tickets` with `principalKind: "verifier"` mints a signed
     capability ticket. The verifier principal bypasses the
     "node must already be verified" check (that is what lets a `pending` node
     get its first check), but still respects the ticket rate limit.
   - The probe request is encrypted to the node's X25519 public key and embeds
     the ticket.
   - The verifier connects as a client:

     ```text
     wss://<gateway>/v2/nodes/<nodeId>/connect?role=client
     ```

     with subprotocols `spilled-v2` and `ticket.<base64url(ticket)>`. Both the
     gateway and the node verify the ticket signature against the control-plane
     JWKS (`/server/v2/jwks`).
   - The node decrypts, checks capability/action/timing, executes the method,
     and returns an encrypted signed response.
   - The verifier decrypts and requires `ok: true` for the capability to count
     as `verified`.
3. **Report.** `POST /server/v2/nodes/verification` with the per-capability
   results and a global status.

Probes are deliberately sequential (30 s each). Provider imports can do heavy
I/O; running everything in parallel made lightweight search/player checks time
out behind the import workload.

### Default probe templates

Built-in probes exist for `provider.search`, `provider.feed`,
`provider.import`, and `player.resolve`. Capabilities without a template are
marked `degraded`, never silently verified. Capabilities such as
`player.resolve` and `spillshare.read` need explicit templates with known
public identifiers:

```bash
export SPILLED_VERIFIER_PROBES_JSON='{
  "player.resolve": {
    "method": "player.embed.resolve",
    "params": { "embedUrl": "https://example.com/spilled-verifier", "provider": "verifier" }
  },
  "spillshare.read": {
    "method": "spillshare.manifest",
    "contentId": "<dedicated-verification-content-id>",
    "params": { "contentId": "<dedicated-verification-content-id>" }
  }
}'
```

## 4. Node status lifecycle

| Status | Meaning |
|---|---|
| `pending` | Enrolled, waiting for the next verifier pass. |
| `verified` | Identity valid, online, and at least one advertised capability probed `verified`. |
| `degraded` | Identity valid and online, but no capability verified (probe failure, missing template, timeout). |
| `quarantined` | Identity signature invalid (e.g. transport key rotated without re-enrollment). |
| `disabled` | Operator-disabled. |
| `legacy-unverified` | v1 registrations after migration; must re-enroll under v2. |

Recovery is automatic: `pending`, `degraded`, and `verified` candidates are
retried every 60 s, so a capability that starts passing probes recovers on its
own.

### Where the status gates service

The status is not cosmetic. A node that fails any gate is invisible and cannot
be used by clients:

- `POST /server/v2/tickets` (public principal) requires global status
  `verified`, the specific capability health `verified`, and a live heartbeat;
  otherwise it returns `404 Node capability is not verified or available.`
- `GET /server/v2/discovery/nodes?capability=` returns only nodes whose
  capability health row is `verified`.

So an unverified, stale, or offline node never receives client traffic.

## 5. Adding a new server smoothly

Do this in order and confirm each step before moving on.

1. **Install the server.** Windows installer
   (`Spilled-Server-Setup-<version>-x64.exe`) or Docker
   (`docker-compose.node.yml`). Confirm local health:

   ```bash
   curl http://127.0.0.1:8787/v2/health/live
   curl http://127.0.0.1:8787/v2/health/ready
   curl http://127.0.0.1:8787/v2/protocol
   ```

   `v2/protocol` must report `protocolVersion: 2`. If it reports 1, the server
   build is from the legacy generation and cannot join the v2 system.

2. **Enroll the node** (from a machine with this repository):

   ```powershell
   $env:SPILLED_PUBLIC_CAPABILITIES='provider.search,provider.feed,provider.import,player.resolve'
   $env:SPILLED_LOCAL_NODE_URL='http://127.0.0.1:8787'
   $env:SPILLED_CONTROL_PLANE_URL='https://<deployment>.convex.site/server'
   $env:SPILLED_CONTROL_PLANE_SECRET='<controlPlaneAdminSecret>'
   npm run node:enroll-v2
   ```

   This writes `node-enrollment.json` with the node ID and the gateway
   enrollment credential.

3. **Configure the node** with protected values:

   ```text
   SPILLED_GATEWAY_URL=https://nodes.spilled.overload.studio
   SPILLED_GATEWAY_ENROLLMENT=<enrollmentCredential>
   SPILLED_CONTROL_PLANE_JWKS_URL=https://<deployment>.convex.site/server/v2/jwks
   SPILLED_PASSKEY_ORIGIN=https://<node-id>.nodes.spilled.overload.studio
   SPILLED_PUBLIC_CAPABILITIES=provider.search,provider.feed,provider.import,player.resolve
   ```

4. **Restart the node.** It connects outbound to the gateway (no port
   forwarding) and starts heartbeating. Check the node log for a successful
   gateway connection.

5. **Wait one verifier pass** (up to 60 s). The new node appears as `pending`
   in `verification-candidates`, gets probed, and reports back.

6. **Confirm `verified`.** Check the operator console, or in the Convex
   dashboard inspect the `nodeRegistrations` row for the node (expect
   `status: "verified"`) and its `nodeCapabilityHealth` rows (expect
   `status: "verified"`).

7. **If any capability is `degraded`:** add a safe probe template in
   `SPILLED_VERIFIER_PROBES_JSON` (section 3), or check that the probe's
   provider module is reachable and that the node has outbound internet for
   provider I/O.

8. **Confirm discovery.** Once verified, the node appears under
   `/server/v2/discovery/nodes?capability=<capability>` and can receive
   tickets.

## 6. Native Windows verifier app

`apps/verifier-windows` is a native (Electron) tray application that runs the
verifier in the Windows notification area instead of Docker or a headless
binary. It provides:

- a tray icon with live status, last-pass summary, restart, logs, update, and
  quit actions;
- a console window with a live log tail, verification stats, settings, and
  maintenance panels;
- automatic restart if the verifier process crashes;
- self-update from GitHub Releases (`latest.yml` via `electron-updater`);
- one-click replacement of an older verifier deployment.

### Build

```powershell
npm run release:verifier-windows
```

This produces `apps/verifier-windows/release/Spilled-Verifier-Setup-1.1.0-x64.exe`
and `latest.yml` for auto-update.

### First run

1. Install the executable. The app starts with Windows by default (toggle in
   the Settings tab).
2. Open the console from the tray icon and fill in the Settings tab:
   - control plane URL (`SPILLED_CONTROL_PLANE_URL`);
   - gateway URL (`SPILLED_GATEWAY_URL`);
   - control plane secret (`SPILLED_CONTROL_PLANE_SECRET`);
   - probes JSON (`SPILLED_VERIFIER_PROBES_JSON`).
3. Click **Save settings** and **Restart verifier**.

The verifier writes a JSON status file after every pass; the console and tray
render it live. It also respects `SPILLED_VERIFIER_ONCE=1` via the **run once**
setting for a single probe pass.

### Replacing an older verifier

The app can take over from a previous deployment:

- **Standalone binaries** (`spilled-verifier-windows-x64.exe`) are detected and
  stopped.
- **Docker deployment** (`docker-compose.verifier.yml`) containers are detected
  and stopped/removed.

Use **Replace legacy verifier** in the Maintenance tab or tray menu, or enable
**auto-replace legacy verifier on start** in Settings. Only one verifier should
own the verification loop at a time.

### Publishing an update

Upload the installer, `latest.yml`, and the `.exe.blockmap` to the
`kao-offline/spilled-black-box` GitHub release for the new version tag; the app
then updates itself on start or from **Check for updates**.

## 7. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Node stays `pending` for many passes | Verifier not running, or wrong `SPILLED_CONTROL_PLANE_URL`/`SPILLED_CONTROL_PLANE_SECRET`. Check verifier logs. |
| `quarantined` | Identity signature invalid: transport keys rotated without re-enrollment, or the database/identity changed. Re-run enrollment with the current keys. |
| `degraded`, no probe template | Capability has no default probe. Configure `SPILLED_VERIFIER_PROBES_JSON`. |
| `degraded`, probe timeout | Heavy provider I/O; probes are sequential with a 30 s budget. Verify the probe's module ID is live and reachable. |
| Not in discovery though globally `verified` | The specific capability's health row is not `verified`. Discovery is per-capability; confirm every advertised capability was probed. |
| `v2/protocol` reports version 1 | Server build is legacy. Use a protocol v2 build. |
| Tickets return `404 Node capability is not verified or available` | Global status, capability health, or heartbeat is not satisfied. Re-run the verifier pass and confirm the gateway heartbeat. |
