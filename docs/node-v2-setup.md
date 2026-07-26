# Spilled Node v2: complete production setup

This guide configures the Windows companion, Linux Docker node, Convex control
plane, Cloudflare Durable Object gateway, automated verifier, coturn relay,
operator OIDC, signed WASM connectors, recovery, invitations, and signed
Windows releases.

## Headless Windows node: normal owner setup

The manual production sections below are for Spilled infrastructure operators.
An owner installing only the server on a spare Windows PC uses the release:

1. Open this repository's GitHub Releases page.
2. Download `Spilled-Server-Setup-<version>-x64.exe`.
3. Run the installer and choose the installation directory if desired.
4. Complete the local setup page that opens automatically.

The wizard asks only for:

- a recognizable server name;
- the owner name and password;
- whether the PC may help with search/catalog refresh, player resolution,
  temporary download acceleration, or SpillShare.

It does not ask for a port, database file, vault path, server URL, setup code,
gateway credential, or Windows startup settings. The installer already
contains the compiled server, Electron host, and native runtime dependencies;
the spare PC does not need the repository, Git, Node.js, or npm. The server
binds to loopback and stores its SQLite database, DPAPI-protected secrets,
vault, temporary files, and logs under the Spilled Server user-data directory.

To reopen the wizard, visit `http://127.0.0.1:8787/setup` on the server PC. To
start the server manually, use the **Spilled Server** Start Menu shortcut. The
tray menu provides setup, health, logs, restart, start-with-Windows, and quit
controls.

Release maintainers build the installer with:

```powershell
npm ci
npm run release:server-windows
```

## 1. What you must own

The repository cannot create trusted credentials on your behalf. Obtain:

- a Convex production deployment;
- a Cloudflare account ID and API token with Worker, Durable Object, route, and
  secret permissions;
- control of `nodes.spilled.overload.studio` and
  `turn.spilled.overload.studio`;
- a Linux host with a public address for coturn;
- an OIDC application for the internal operator team;
- a trusted Windows Authenticode code-signing certificate in PFX format.

The OIDC ID token must contain an `aud` value dedicated to the operator
application. Customer accounts never use this provider.

## 2. Clean installation

Use Node.js 22 and npm 10 or newer:

```powershell
node --version
npm --version
npm ci
```

If Windows reports `EPERM` for `cloudflared.exe`, an old v1 tunnel process is
holding it open. Find only processes belonging to this workspace:

```powershell
Get-CimInstance Win32_Process |
  Where-Object {
    $_.CommandLine -like '*SpilledCinema*cloudflared*'
  } |
  Select-Object ProcessId, Name, CommandLine
```

Stop the displayed SpilledCinema process IDs, then retry:

```powershell
Stop-Process -Id <cloudflared-pid>,<parent-node-pid> -Force
npm ci
```

Do not stop unrelated Node, Electron, or Codex processes. Node v2 does not use
the old automatic cloudflared tunnel.

Verify the repository:

```powershell
npm run test -w apps/dashboard
npm run build -w apps/dashboard
npm run build -w @spilledcinema/extractor
npm run build -w @spilledcinema/server
npm run build -w @spilledcinema/gateway
npm run build -w @spilledcinema/verifier
npx convex codegen
npm run node:smoke-v2
npm run node:smoke-native-v2
```

The current baseline is 36 test files and 151 tests.

## 3. Generate cryptographic material

```powershell
npm run node:generate-v2-secrets
```

This creates `deployment-secrets.json` containing:

- Ed25519 control-plane signing keys and key ID;
- a control-plane administrator secret;
- a gateway service token;
- a 256-bit coturn shared secret;
- an Ed25519 provider-publisher keypair and key ID.

Move this file to an encrypted password manager. Never commit it. Create
separate development and production values.

## 4. Configure operator OIDC

Create a confidential or public OIDC application for the internal operator
console. Configure its allowed callback/logout URLs in the provider. Record:

- issuer URL, exactly matching the token `iss`;
- client/application ID, exactly matching the token `aud`.

Generate the fail-closed Convex configuration:

```powershell
$env:SPILLED_OPERATOR_OIDC_ISSUER='https://issuer.example.com'
$env:SPILLED_OPERATOR_OIDC_CLIENT_ID='spilled-operator-production'
npm run operator:configure-oidc
```

The command validates OIDC discovery and writes
`convex/operatorAuth.generated.ts`. Without this step the provider list is
empty and operator authentication fails closed.

After the first operator signs in, copy their Convex `tokenIdentifier` and add
the initial allowlist record:

```powershell
npx convex run operators:setOperatorRole `
  '{"tokenIdentifier":"<issuer>|<subject>","role":"security-admin","enabled":true}'
```

`setOperatorRole` is internal and should be run only from an authenticated
deployment/admin environment. All operator queries derive identity from
`ctx.auth.getUserIdentity()`; they do not accept caller-supplied user IDs.

## 5. Configure and deploy Convex

Set these in the Convex production deployment:

| Variable | Value |
|---|---|
| `SPILLED_CONTROL_PLANE_PRIVATE_KEY` | `controlPlanePrivateKey` PEM |
| `SPILLED_CONTROL_PLANE_PUBLIC_JWK` | JSON-encoded `controlPlanePublicJwk` |
| `SPILLED_CONTROL_PLANE_KEY_ID` | `controlPlaneKeyId` |
| `SPILLED_CONTROL_PLANE_SECRET` | `controlPlaneAdminSecret` |
| `SPILLED_GATEWAY_SERVICE_TOKEN` | `gatewayServiceToken` |

Deploy the widened schema and functions:

```powershell
npx convex codegen
npx convex deploy
```

For an existing v1 deployment, dry-run first:

```powershell
npx convex run migrations:runAll '{"dryRun":true}'
npx convex run migrations:runAll
```

The migration marks legacy nodes unverified and expires legacy SpillShare
records without copying filenames.

Confirm:

```text
https://<deployment>.convex.site/server/v2/jwks
```

It must return the configured Ed25519 key and key ID.

## 6. Deploy the Cloudflare gateway

In `apps/gateway`:

```powershell
npx wrangler login
npx wrangler secret put CONTROL_PLANE_VERIFY_URL
npx wrangler secret put GATEWAY_SERVICE_TOKEN
npx wrangler secret put TURN_SHARED_SECRET
npx wrangler deploy
```

Values:

```text
CONTROL_PLANE_VERIFY_URL=https://<deployment>.convex.site/server/v2/gateway/verify
GATEWAY_SERVICE_TOKEN=<gatewayServiceToken>
TURN_SHARED_SECRET=<turnSharedSecret>
```

Attach the Worker wildcard route/custom domain:

```text
*.nodes.spilled.overload.studio
```

The Durable Object keeps one authenticated outbound node connection per
`nodeId`. RPC bodies remain end-to-end encrypted; the gateway sees routing and
quota metadata only.

## 7. Deploy coturn

Point `turn.spilled.overload.studio` to the relay host. Install a trusted TLS
certificate and open:

- TCP/UDP 3478;
- TCP 5349;
- UDP 49160-49260.

On the host:

```bash
export TURN_SHARED_SECRET='<turnSharedSecret>'
export TURN_CERT_FILE='/secure/path/fullchain.pem'
export TURN_KEY_FILE='/secure/path/privkey.pem'
docker compose -f infra/coturn/docker-compose.yml up -d
```

Spilled requests short-lived TURN REST credentials from the gateway. Both the
browser and node enforce relay-only ICE. Selected candidate pairs are checked
again before bytes are sent. There is no direct-IP fallback.

## 8. Deploy the automated verifier

The verifier checks identity signatures, v2 protocol, gateway reachability,
encrypted signed responses, and independent advertised capabilities.

Configure capability-safe probes. Search/feed have built-in probes. Operations
requiring provider-specific identifiers need explicit templates:

```bash
export SPILLED_VERIFIER_PROBES_JSON='{
  "player.resolve": {
    "method": "player.resolve",
    "params": {
      "episodeId": "<known-public-verification-episode>"
    }
  },
  "spillshare.read": {
    "method": "spillshare.manifest",
    "contentId": "<dedicated-verification-content-id>",
    "params": {
      "contentId": "<dedicated-verification-content-id>"
    }
  }
}'
```

Deploy:

```bash
export SPILLED_CONTROL_PLANE_URL='https://<deployment>.convex.site/server'
export SPILLED_GATEWAY_URL='https://nodes.spilled.overload.studio'
export SPILLED_CONTROL_PLANE_SECRET='<controlPlaneAdminSecret>'
docker compose -f docker-compose.verifier.yml up -d --build
```

Unconfigured or failing capability probes are marked `degraded`, not silently
verified. Pending and degraded nodes are retried every minute.

## 9. Run a Windows local companion

Development:

```powershell
npm run dev:native
```

The packaged app:

- starts the compiled node helper;
- communicates through
  `\\.\pipe\spilled-node-<install-id>` from Electron main/preload;
- keeps the renderer away from the node bootstrap/identity secrets;
- stores SQLite data under Electron `userData`;
- protects the master key with current-user DPAPI;
- serves only loopback browser compatibility endpoints;
- starts remote and public capabilities disabled.

Validate an unpacked package:

```powershell
npm run build:resources -w @spilledcinema/client-native
Set-Location apps/client/native
npx electron-builder --win --dir
Set-Location ../../..
```

### Produce the signed installer

Import or securely reference your trusted PFX:

```powershell
$env:CSC_LINK='C:\secure\spilled-authenticode.pfx'
$env:CSC_KEY_PASSWORD='<pfx-password>'
$env:CLOUDFLARE_API_TOKEN='<cloudflare-token>'
$env:CLOUDFLARE_ACCOUNT_ID='<account-id>'
$env:SPILLED_CONTROL_PLANE_SECRET='<controlPlaneAdminSecret>'
$env:SPILLED_GATEWAY_SERVICE_TOKEN='<gatewayServiceToken>'
$env:TURN_SHARED_SECRET='<turnSharedSecret>'
$env:SPILLED_OPERATOR_OIDC_ISSUER='https://issuer.example.com'
$env:SPILLED_OPERATOR_OIDC_CLIENT_ID='spilled-operator-production'
npm run release:validate-credentials
npm run dist:windows -w @spilledcinema/client-native
```

Do not distribute an unsigned installer. Verify the finished executable:

```powershell
Get-AuthenticodeSignature `
  'apps/client/native/dist/Spilled-0.1.0-x64.exe' |
  Format-List Status, StatusMessage, SignerCertificate
```

The status must be `Valid`.

## 10. Run a Linux Docker node

```bash
mkdir -p ./secrets
openssl rand -base64 32 > ./secrets/spilled-master-key
chmod 600 ./secrets/spilled-master-key
export SPILLED_MASTER_KEY_FILE="$PWD/secrets/spilled-master-key"
docker compose -f docker-compose.node.yml up -d --build
```

The port is published to loopback only:

```bash
curl http://127.0.0.1:8787/v2/health/live
curl http://127.0.0.1:8787/v2/health/ready
curl http://127.0.0.1:8787/v2/protocol
```

Docker refuses private/public mode without a 0600 master-key secret.

## 11. Enroll the node

Start the node and select only the public capabilities the owner wants:

```powershell
$env:SPILLED_PUBLIC_CAPABILITIES='provider.search,provider.feed,player.resolve'
$env:SPILLED_LOCAL_NODE_URL='http://127.0.0.1:8787'
$env:SPILLED_CONTROL_PLANE_URL='https://<deployment>.convex.site/server'
$env:SPILLED_CONTROL_PLANE_SECRET='<controlPlaneAdminSecret>'
npm run node:enroll-v2
```

`node-enrollment.json` contains the node ID and gateway enrollment credential.
Move the credential into protected node configuration:

```text
SPILLED_GATEWAY_URL=https://nodes.spilled.overload.studio
SPILLED_GATEWAY_ENROLLMENT=<enrollmentCredential>
SPILLED_CONTROL_PLANE_JWKS_URL=https://<deployment>.convex.site/server/v2/jwks
SPILLED_PASSKEY_ORIGIN=https://<node-id>.nodes.spilled.overload.studio
SPILLED_PUBLIC_CAPABILITIES=provider.search,provider.feed,player.resolve
```

Restart the node. It connects outbound; no port forwarding is required.
Capabilities stay undiscoverable until the verifier independently marks them
verified.

## 12. Private accounts and sessions

Private routing tickets come from:

```text
POST /server/v2/private-tickets
```

They route encrypted calls but do not authenticate node accounts. Account
authentication and authorization still happen on the node.

Supported encrypted methods include:

- `auth.passkey.options`
- `auth.passkey.verify`
- `auth.refresh`
- `auth.logout`
- `auth.password.disable`
- `invite.inspect`
- `invite.accept`
- `recovery.export`
- `recovery.restore`

Access tokens last 15 minutes. Refresh tokens last 30 days, are stored only as
hashes, rotate on every use, and revoke the device chain when an old token is
reused. Temporary setup/password fallback uses Argon2id; enroll an owner
passkey and call `auth.password.disable` to return to passkey-only login.

Owner-created invitations use a 128-bit secret, separate six-digit confirmation
code, ten-minute expiry, and atomic consumption after passkey enrollment.

## 13. Recovery kit

Call `recovery.export` with a valid owner/admin access token and immediately
print or save the returned:

- node ID;
- recovery ID;
- 32 recovery words;
- QR payload.

Only an Argon2id verifier and AES-256-GCM encrypted identity backup remain on
the node. The words are shown once by the calling UI.

Calling `recovery.restore`:

- restores the node identity;
- revokes access and refresh sessions;
- consumes invitations;
- removes enrolled passkeys;
- rotates the one-time recovery record;
- returns an owner enrollment code;
- requires gateway re-enrollment and a new owner passkey;
- appends a local immutable security event.

## 14. Relay-only bulk transfer

For SpillShare:

1. Request a content-specific `spillshare.read` ticket.
2. Request TURN credentials from `/v2/turn-credentials`.
3. Create the browser offer using
   `apps/dashboard/src/lib/relay-bulk-transfer.ts`.
4. Call encrypted `spillshare.transfer.prepare` with the offer, TURN
   credentials, and content ID.
5. Apply the answer and candidates.
6. Authenticate inside the data channel using ticket ID, transfer token,
   content ID, and manifest ID.
7. Verify every chunk SHA-256 before writing or playback.
8. Resume using `resumeFromChunk` after interruption.

The node refuses non-relay candidate pairs. The signed manifest never includes
the local filename or path.

## 15. Signed WASM connectors

Production rejects remote JavaScript. Built-in connectors continue to work.
Remote connectors must use the Spilled WASM ABI:

- export `memory`;
- export `spilled_alloc(length)`;
- export `spilled_run(pointer, length)`, returning a packed 64-bit
  `resultPointer << 32 | resultLength`;
- import only `spilled.abort`;
- exchange UTF-8 JSON;
- request network access through staged `{fetch: ...}` output.

The worker has no filesystem preopens, environment, sockets, Node imports, or
child processes. It has memory, output, fetch-stage, response-size, hostname,
method, DNS/SSRF, and wall-clock limits.

Create metadata:

```json
{
  "providerId": "example",
  "version": "2.0.0",
  "publisherKeyId": "<providerPublisherKeyId>",
  "allowedHosts": ["api.example.com"],
  "allowedMethods": ["GET"],
  "maxResponseBytes": 4194304,
  "timeoutMs": 20000
}
```

Sign:

```powershell
$env:SPILLED_PROVIDER_PUBLISHER_PRIVATE_KEY_FILE='C:\secure\provider-private.pem'
npm run connector:sign-wasm -- connector.wasm metadata.json signed-release.json
```

Set the node’s pinned public-key map:

```text
SPILLED_PROVIDER_PUBLISHER_KEYS={"<key-id>":"-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"}
```

Copy the signed release fields into the repository integration runtime:

```json
{
  "apiVersion": 2,
  "format": "wasm",
  "entry": "./connector.wasm",
  "integrity": "sha256-<artifactSha256>",
  "publisherKeyId": "<key-id>",
  "signature": "<signature>",
  "allowedMethods": ["GET"],
  "maxResponseBytes": 4194304,
  "timeoutMs": 20000
}
```

## 16. Migrate a v1 local node

Stop writes and run:

```powershell
$env:SPILLED_LEGACY_STATE_FILE='C:\path\state.json'
$env:SPILLED_NODE_DATABASE='C:\path\node.db'
$env:SPILLED_MASTER_KEY_FILE='C:\secure\master-key'
$env:SPILLED_SECRET_RECORDS_FILE='C:\path\secrets.json'
npm run node:migrate-v2
```

The migration backs up JSON, imports in a transaction, moves identity secrets,
verifies counts and fingerprints, and leaves the JSON backup untouched.

## 17. Backups and upgrades

Automatic verified backups are stored beside SQLite:

```text
backups/node-daily-YYYY-MM-DD.db
backups/node-weekly-YYYY-WW.db
```

The defaults retain seven daily and four weekly backups. Back up encrypted
secret records and DPAPI/Docker master-key material separately.

Upgrade procedure:

1. Back up SQLite and encrypted secrets.
2. Build or pull the new version.
3. Stop with `SIGTERM`.
4. Start the new version.
5. Check readiness and gateway status.
6. Keep the old installer/image for one rollback window.

## 18. Final production checklist

- `npm ci` succeeds without a locked v1 cloudflared process.
- All tests and five production builds pass.
- Convex migration dry-run matches expectations.
- JWKS contains the production Ed25519 key.
- Operator login token `iss` and `aud` match the generated provider config.
- Gateway accepts enrolled nodes and rejects invalid tickets.
- Verifier independently verifies every advertised capability.
- TURN candidates are relay-only on both sides.
- Recovery is printed and tested on a disposable node.
- Invitation secret and confirmation code are tested once.
- Refresh-token reuse revokes the chain.
- Unsigned JavaScript/WASM connectors are rejected.
- Windows installer Authenticode status is `Valid`.
- No public capability is enabled without owner opt-in.

## 19. Troubleshooting

- `EPERM cloudflared.exe`: stop only the old SpilledCinema tunnel process, then
  rerun `npm ci`.
- `Origin is not allowed`: set the exact comma-separated `CORS_ORIGIN`; null
  origins remain rejected.
- `Capability ticket is invalid`: check time synchronization, JWKS/key ID,
  node ID, capability, and ticket expiry.
- `degraded` capability: add a safe verifier probe and inspect the encrypted
  response.
- TURN unavailable: bulk remains unavailable; never enable direct fallback.
- OIDC identity is null: confirm discovery, token `iss`, token `aud`, generated
  provider config, and redeploy Convex.
- Signing status is `NotSigned`: supply a trusted PFX through `CSC_LINK` and
  rebuild; do not distribute that artifact.
- Corrupt SQLite/state: preserve it and restore a verified backup. Never delete
  it to force a blank node.
