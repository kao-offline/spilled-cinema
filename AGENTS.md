# AGENTS.md — SpilledCinema Server Network

> Read this before building anything. Breaking things here is expensive.

## What This Is

A self-hosted media streaming platform. Users run a **Spilled Server** (local Node.js) that discovers content, downloads media, and serves streams. A hosted **dashboard** (Vercel) provides the UI. A **gateway** (Cloudflare Worker) brokers encrypted RPC between browsers and nodes. A **control plane** (Convex) handles registration, heartbeats, discovery, and verification.

---

## Architecture

```
Browser (dashboard on Vercel)
  ↓ requestRuntimeJson cascade
  ├─ native (Electron bridge)
  ├─ sameOrigin (localhost dashboard + server)
  ├─ extension (Chrome extension postMessage)
  ├─ direct (127.0.0.1:8787 / localhost:8787)
  ├─ hosted (Vercel serverless — artwork APIs only)
  ├─ gateway (Cloudflare Worker → encrypted RPC → node)
  └─ legacy fetch-server (public tunnel origins)

Node (Spilled Server — Electron on Windows, or bare Node.js)
  ├─ HTTP server (standalone.ts, port 8787)
  ├─ Gateway link (WebSocket → Cloudflare Worker → Durable Object)
  ├─ Control plane registration (Convex backend)
  ├─ Auto-tunnel (cloudflared / localtunnel)
  └─ SQLite database + vault (filesystem)

Control Plane (Convex — cheerful-lynx-4)
  ├─ Node registration + heartbeats (TTL 15s)
  ├─ Capability verification
  ├─ Discovery (list verified nodes)
  ├─ Capability tickets (signed, scoped)
  └─ Spillshare / relay selection
```

---

## Runtime Cascade

`apps/dashboard/src/lib/local-api.ts` → `requestRuntimeJson(path, init)`

This is how the dashboard reaches the server. Each transport is tried in order; the first usable result wins.

| # | Transport | How It Works | When It's Used |
|---|-----------|-------------|----------------|
| 1 | `native` | `window.spilledNative.requestRuntime()` | Electron desktop app |
| 2 | `node` | Same-origin fetch to `localhost` | Dashboard served from `localhost:5173` with server on same port |
| 3 | `extension` | `postMessage` to Chrome extension | Extension installed |
| 4 | `direct` | `fetch('http://127.0.0.1:8787/...')` then `localhost:8787` | Local server running (30s cooldown on failure) |
| 5 | `hosted` (early) | Vercel serverless `/api/artwork/*` only | Hosted dashboard, artwork APIs |
| 6 | `gateway` | Encrypted WebSocket RPC via Cloudflare Worker | **Primary for hosted dashboard** — most operations |
| 7 | `fetch-server` | Legacy public tunnel origins via `/api/node-proxy` | Fallback if gateway fails |

**Timeouts:**
- `DIRECT_LOCAL_TIMEOUT_MS` = 3s (localhost probe)
- `LOCAL_RUNTIME_TIMEOUT_MS` = 15s (default)
- `LONG_RUNTIME_TIMEOUT_MS` = 60s (imports, artwork)
- `PLAYBACK_RUNTIME_TIMEOUT_MS` = 90s (player resolution, browser-start)

**Retry:** If transport returns 404/408/409/422/5xx, falls through to next transport (only for `native`, `node`, `direct`, `extension`).

---

## Server Network

### Nodes

- **Registration:** `enrollV2Node` in `convex/controlPlane.ts:415` — stores identity keys, endpoint URL, capabilities.
- **Heartbeat:** `recordGatewayHeartbeatV2` in `convex/controlPlane.ts:591` — every 10s from gateway alarm, TTL clamped to 15-120s. Node is "online" if heartbeat not expired.
- **Discovery:** `listVerifiedV2Nodes` in `convex/controlPlane.ts:683` — returns nodes with verified capability, non-expired heartbeat, valid identity.
- **Verification:** `apps/verifier` probes nodes through gateway every 60s. Reports `verified` or `degraded` per capability.

### Gateway (Cloudflare Worker)

- **Location:** `apps/gateway/src/index.ts`
- **Deployed:** `spilled-node-gateway.hrdykrystof.workers.dev`
- **Durable Object:** `NodeLink` — one per node, stores node socket + client sockets.
- **Heartbeat alarm:** Every 10s, sends heartbeat to control plane. If node socket is gone, cleans up.
- **Frame relay:** Client → node (with clientId appended) and node → specific client (by clientId).
- **Max frame:** 1MB (`MAX_FRAME_BYTES`).
- **Auth:** Nodes present enrollment credential; clients present signed capability ticket.
- **Secrets:** `GATEWAY_SERVICE_TOKEN` (gateway→CP auth), `TURN_SHARED_SECRET` (TURN credentials).

### Control Plane (Convex)

- **Deployment:** `cheerful-lynx-4` at `https://cheerful-lynx-4.convex.site`
- **HTTP router:** `convex/http.ts` (996 lines) — exposes `/server/*` REST API.
- **Key tables:** `nodes`, `nodeHeartbeatsV2`, `nodeIdentities`, `nodeRegistrations`, `nodeCapabilityHealth`, `capabilityTicketAudit`, `integrations`.
- **Capability tickets:** Signed, scoped, rate-limited. Verified via JWKS.

---

## Key Routes (Server)

Full route table in `apps/server/src/standalone.ts:144-230`. Highlights:

| Route | Purpose | Gotchas |
|-------|---------|---------|
| `/api/status` | Node status | Used for health checks |
| `/api/download-full/browser-file` | **Playback proxy** — streams HLS/MP4 from upstream | Uses `applyPermissiveCors` (any origin). HLS playlists are rewritten to proxy all segments. |
| `/api/subtitle-proxy` | Fetches subtitle files from upstream | Tries 4 header strategies × 3 domain candidates. Returns `text/vtt`. |
| `/api/player/playback-resolve` | Resolves a player to a playable stream URL | 90s timeout. Can be slow for some providers. |
| `/api/player/resolve` | Resolves embed URL from player page | 90s timeout. |
| `/api/provider-import` | Imports a show from a provider | 60s timeout. Heavy operation. |
| `/api/server` | Proxies to Convex control plane | Used by dashboard for discovery, tickets, etc. |
| `/api/node-proxy` | Proxies requests to a remote node | Max 60s. Used for tunnel-origin requests. |

---

## CORS Rules

`apps/server/src/standalone.ts:232-277`

**Default allowed origins:**
- `http://localhost:5173`, `http://127.0.0.1:5173`
- `http://localhost:4173`, `http://127.0.0.1:4173`
- `https://spilled.overload.studio`
- Any `http://localhost:{port}` or `http://127.0.0.1:{port}` dynamically

**Two CORS functions:**
1. `applyCors(req, res)` — Standard CORS. Echoes origin. Allows `GET,POST,HEAD,OPTIONS`. Used for all routes **except** browser-file.
2. `applyPermissiveCors(req, res)` — Permissive CORS. Echoes origin or `*`. **Only** used for `/api/download-full/browser-file`. Allows `GET,HEAD,OPTIONS` only (no POST).

**Critical:** If you add a new route that needs cross-origin access, it uses `applyCors` by default. If the browser-file route is exempted from `applyCors`, it means `applyPermissiveCors` handles it instead — **both must set the same headers** (Range, Content-Length, Content-Range, Accept-Ranges, Content-Disposition, Content-Type, Private-Network).

---

## Subtitle Proxy

`apps/server/src/http-handlers.ts:1585-1670` and `apps/dashboard/api/subtitle-proxy.js`

**Flow:**
1. Receive `?url=<subtitle_url>` (e.g., `https://svetserialu.to/jsonsubs/4/73`).
2. If URL is on `svetserialu.to` domain, generate alternate candidates: `svetserialu.io`, `svetserialov.to`.
3. For each candidate × each header strategy (4 strategies):
   - Fetch with User-Agent + Accept + Referer headers.
   - If 403/401, try next header.
   - If JSON response, extract `.file` from first entry with `.default`, fetch the actual VTT.
4. Normalize: if SRT format, prepend `WEBVTT\n\n`, convert commas to dots in timestamps.
5. Return `text/vtt` with `Access-Control-Allow-Origin: *`.

**Gotcha:** The Vercel serverless proxy (`apps/dashboard/api/subtitle-proxy.js`) runs on Vercel's datacenter IPs. Some upstream sites (like `svetserialov.to`) block datacenter IPs with 403. The domain fallback + normalization mitigates this.

**Subtitle URL normalization:** `normalizeSvetSubtitleUrl` in `apps/dashboard/src/server/svetserialu.ts:83-100` rewrites `svetserialov.to`/`svetserialu.io` to the primary `svetserialu.to` domain before returning from the provider. This means the browser hits the Vercel proxy with the primary domain first.

---

## Browser-File Playback

`apps/server/src/http-handlers.ts:1376-1457`

This is the most complex route. It proxies HLS streams and serves as the playback endpoint.

**Parameters:** `url` (required), `name` (required), `referer` (optional), `playback` (optional, `"1"` for inline Content-Disposition).

**Flow:**
1. Try 4 header strategies to fetch upstream.
2. If HLS (`.m3u8` or `application/vnd.apple.mpegurl`):
   - **Rewrite all segment/variant URLs** in the playlist to go through this proxy.
   - Each segment becomes: `/api/download-full/browser-file?url=<segment_url>&name=<name>&referer=<playlist_url>&playback=1`
   - Ad/image segments filtered out.
3. If binary (MP4, segments): stream directly.
4. CORS: Uses `applyPermissiveCors` — any origin can fetch.

**How playback URLs are built:**
`apps/dashboard/src/server/full-download.ts:143-158` → `buildPlaybackProxyPath`:
- Builds relative URL: `/api/download-full/browser-file?url=<stream>&name=<id>.m3u8&referer=<origin>&playback=1`
- If `SPILLED_NODE_ENDPOINT_URL` is set (auto-tunnel URL), prepends it to make absolute URL.
- **The browser plays from the node's tunnel origin**, not from Vercel. This is why CORS on the node must allow `https://spilled.overload.studio`.

---

## Library Vault

`apps/dashboard/src/lib/library-folder.ts`

Browser-side offline storage for downloaded media using the **File System Access API**.

**Storage mechanism (priority):**
1. **Native vault** (`window.spilledNative`) — Electron desktop app filesystem operations.
2. **File System Access API** (`showDirectoryPicker`) — Desktop Chrome/Edge, persistent folder handle in IndexedDB.
3. **OPFS** (`navigator.storage.getDirectory()`) — Mobile browsers, enabled via `spilled-mobile-vault-enabled` localStorage flag.

**Directory structure:**
```
<selected-folder>/
  spilled-library/
    vault/                    -- Downloaded media files
    offline-records/          -- Per-episode JSON records
    library-state.json        -- Vault snapshot (version 1)
```

**Logging:** `recordVaultInfo` in `library-folder.ts:114` only logs via `console.info` when `import.meta.env.DEV` is true (Vite dev mode). Diagnostics are always tracked internally via `recordVaultDiagnostics`.

---

## Environment Variables

### Server (Critical)

| Variable | Purpose | Default |
|----------|---------|---------|
| `SPILLED_NODE_DATABASE` | SQLite database path | `./data/spilled.db` |
| `SPILLED_SECRET_RECORDS_FILE` | Secrets JSON path | `./data/secrets.json` |
| `SPILLED_VAULT_PATH` | Download vault folder | `./downloads/` |
| `SPILLED_NODE_ENDPOINT_URL` | Public tunnel URL (auto-set if tunnel enabled) | — |
| `SPILLED_CONTROL_PLANE_URL` | Convex control plane URL | `https://cheerful-lynx-4.convex.site` |
| `SPILLED_GATEWAY_URL` | Gateway WebSocket URL | `wss://spilled-node-gateway.hrdykrystof.workers.dev` |
| `SPILLED_DISABLE_AUTO_TUNNEL` | Disable auto-tunnel creation | `false` |
| `SPILLED_PUBLIC_TUNNEL_PROVIDERS` | Tunnel providers (`cloudflared`, `localtunnel`) | both |
| `SPILLED_PUBLIC_CAPABILITIES` | Comma-separated public capabilities | — |
| `SPILLED_NODE_MODE` | Node mode: `full`, `local` | `full` |
| `SPILLED_ALLOW_PRIVATE_PROXY` | Allow proxying to private IPs | `false` |
| `SPILLED_PROXY_MAX_BYTES` | Max proxy response size | `104857600` (100MB) |

### Gateway (Cloudflare Worker Secrets)

| Variable | Purpose |
|----------|---------|
| `GATEWAY_SERVICE_TOKEN` | Gateway → Control Plane auth token |
| `TURN_SHARED_SECRET` | HMAC-SHA1 secret for TURN credentials |

### Control Plane (Convex)

| Variable | Purpose |
|----------|---------|
| `SPILLED_CONTROL_PLANE_SECRET` | Admin secret for control plane |
| `SPILLED_CONTROL_PLANE_PRIVATE_KEY` | Ed25519 private key for ticket signing |
| `SPILLED_GATEWAY_SERVICE_TOKEN` | Gateway service token |
| `SPILLED_DASHBOARD_URL` | Dashboard URL (`https://spilled.overload.studio`) |

---

## Deployment

### Dashboard (Vercel)
```bash
# From apps/dashboard/
npx vercel deploy --prod --yes
# Alias: https://spilled.overload.studio
```
- Vite build, output to `dist/`.
- Serverless functions: `api/artwork/*.ts`, `api/node-proxy.js`, `api/subtitle-proxy.js`.
- `api/server.js` proxies to Convex control plane.

### Server (Windows Installer)
```bash
# From apps/server-windows/
# 1. Bump version in package.json
# 2. Build installer
npm run dist:windows -w @spilledcinema/server-windows
# Output: release/Spilled-Server-Setup-{version}-x64.exe
# 3. Commit, tag, push, create GitHub release
```
- `npm run build -w @spilledcinema/server` builds `dist/standalone.mjs` (esbuild, Node 22 ESM).
- `prepare-server-windows-payload.mjs` copies the bundle into `apps/server-windows/server/`.
- `electron-builder --win nsis` creates the signed installer.

### Gateway (Cloudflare Workers)
```bash
# From apps/gateway/
npx wrangler deploy
# Worker: spilled-node-gateway.hrdykrystof.workers.dev
# Secrets: GATEWAY_SERVICE_TOKEN, TURN_SHARED_SECRET
```
- Durable Object: `NodeLink` with SQLite storage.
- Migrations: Add new `migrations` entry in `wrangler.toml` when schema changes.

### Control Plane (Convex)
```bash
$env:CONVEX_DEPLOYMENT="cheerful-lynx-4"
npx convex deploy
# https://cheerful-lynx-4.convex.site
```
- Schema in `convex/schema.ts`.
- HTTP router in `convex/http.ts`.
- **Always** read `convex/_generated/ai/guidelines.md` before writing Convex code.

### Verifier
```bash
# From apps/verifier/
npm run build
# Output: dist/index.mjs
# Runs every 60s, probes nodes through gateway
```

---

## Things That Are Easy to Break

### 1. CORS on browser-file route
The browser-file route (`/api/download-full/browser-file`) is exempted from `applyCors` and uses `applyPermissiveCors` instead. If you change either function's headers, you must keep them in sync for Range/Content-Length/Content-Range/Accept-Ranges/Content-Disposition/Content-Type/Private-Network headers. **This caused the playback CORS outage on 2026-08-06** (commit `38f34c6` exempted the route but forgot to call `applyPermissiveCors`).

### 2. Playback proxy URL construction
`buildPlaybackProxyPath` in `full-download.ts` builds absolute URLs using `SPILLED_NODE_ENDPOINT_URL`. If this env var is missing or wrong, the browser tries to play from the wrong origin. The tunnel URL is set automatically by `startPublicTunnelMonitor` in `standalone.ts`.

### 3. Subtitle proxy 403s
Upstream sites like `svetserialov.to` block datacenter IPs (Vercel). The domain fallback + normalization mitigates this, but new upstream sites may need new fallback strategies.

### 4. Heartbeat TTL
Control plane heartbeats expire at 15s TTL. Gateway alarm fires every 10s. If the gateway worker is redeployed with stale heartbeat interval code, nodes flicker offline. **This happened on 2026-08-06** — gateway was deployed with 30s interval while prod expected 15s.

### 5. Localhost probe spam
`fetchDirect` and `probeDirectLocalRuntime` probe `127.0.0.1:8787` and `localhost:8787`. On hosted dashboard without local server, this produces ERR_CONNECTION_REFUSED spam. **Mitigated** by `localhost-probe-cache.ts` (30s cooldown). If you add new code that probes localhost, use the cache.

### 6. Vault logging
`recordVaultInfo` logs to `console.info` in production. **Mitigated** by gating behind `import.meta.env.DEV`. If you add vault operations, use `recordVaultInfo` (which is gated) not raw `console.info`.

### 7. Gateway worker secrets
`GATEWAY_SERVICE_TOKEN` and `TURN_SHARED_SECRET` are **not** in the repo. They must be set via `wrangler secret put`. Losing them requires generating new ones and updating the control plane.

### 8. Convex deployment target
Production is `cheerful-lynx-4`. Never deploy to a different deployment without explicit approval. Check `$env:CONVEX_DEPLOYMENT` before `npx convex deploy`.

---

## File Reference

| Path | What It Does |
|------|-------------|
| `apps/dashboard/src/lib/local-api.ts` | Runtime cascade, requestRuntimeJson |
| `apps/dashboard/src/lib/runtime-bridge.ts` | probeLocalRuntime, transport detection |
| `apps/dashboard/src/lib/localhost-probe-cache.ts` | Cooldown cache for localhost probes |
| `apps/dashboard/src/lib/library-folder.ts` | Vault storage (OPFS/IDB/native) |
| `apps/dashboard/src/lib/v2-gateway-client.ts` | Gateway RPC client, crypto, discovery |
| `apps/dashboard/src/server/full-download.ts` | Download jobs, buildPlaybackProxyPath |
| `apps/dashboard/src/server/svetserialu.ts` | Svetserialu provider (import, search, subtitles) |
| `apps/dashboard/api/subtitle-proxy.js` | Vercel subtitle proxy (domain fallback) |
| `apps/dashboard/api/server.js` | Vercel → Convex control plane proxy |
| `apps/dashboard/api/node-proxy.js` | Vercel → remote node proxy |
| `apps/server/src/standalone.ts` | Server entry, route table, CORS, tunnel |
| `apps/server/src/http-handlers.ts` | All route handlers |
| `apps/server/src/gateway-link.ts` | Node → gateway WebSocket link |
| `apps/server/src/control-plane.ts` | Node → control plane registration |
| `apps/gateway/src/index.ts` | Gateway Worker + NodeLink Durable Object |
| `apps/gateway/wrangler.toml` | Gateway config |
| `apps/verifier/src/index.ts` | Capability probe service |
| `convex/controlPlane.ts` | Control plane mutations/queries |
| `convex/http.ts` | Control plane HTTP router |
| `convex/schema.ts` | Database schema |
| `packages/node-protocol/` | V2 protocol types, capability definitions |
| `packages/security/` | Encryption, signing, key management |
