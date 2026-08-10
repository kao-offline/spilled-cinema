# Playback Issues & Safe Fix Guidelines

Reference for two known playback problems and how to change the related code
without breaking the rest of the codebase. Applies to the dashboard playback
pipeline (`resolvePlaybackStream`, `validateResolvedStream`,
`resolveUniversalPlayback`) and the runtime transport layer (`local-api.ts`).

## Issue 1 — Playback resolution is slow

### Symptoms

Opening the universal player takes a long time before the video starts. Each
play re-fetches the upstream playlist/media and re-resolves the source, even
when the same stream was already resolved seconds ago.

### Root causes

- `validateResolvedStream` (`apps/dashboard/src/server/full-download.ts`)
  fetches the upstream playlist **and** a media resource on every play (7 s
  timeout, `SPILLED_STREAM_VALIDATE_TIMEOUT_MS`). There was no validation cache.
- `resolvePlaybackStream` walks fallback players **sequentially**: if the active
  player fails, each remaining player's full resolution + validation runs one
  after another, so worst case is the *sum* of all attempts.
- Persisted direct URLs (`streamUrl` / `resolvedUrl` on the player) were always
  re-validated, even when freshly resolved moments earlier.

### Fixes already applied (commit `cb7fe60`)

1. **Validation cache** — module-level `validatedStreamCache`
   (`Map<string, { expiresAt, streamType }>`, TTL
   `VALIDATED_STREAM_CACHE_TTL_MS = 10 min`, capped at 512 entries, oldest
   evicted). `validateResolvedStream(target, bypassCache = false)` looks it up
   first and only stores successful validations.
2. **Vidking revalidation bypass** — `resolveVidkingStream` re-validates its own
   cached targets (30 s TTL) with `bypassCache = true` so stale dead entries are
   still dropped. Without this, the 10-minute validation cache would shadow the
   vidking cache and serve dead URLs for too long.
3. **Persisted-stream fast path** — in `resolvePlaybackStream`, a fresh
   persisted URL (per `canReuseDirectStreamUrl`) short-circuits resolution and
   validation entirely; `streamType` comes from `inferStreamType`.
4. **Parallel fallbacks** — the active player is attempted first (preserves
   preference), then the remaining players run concurrently with bounded
   concurrency 2 via `runFirstSuccess`, returning the first success instead of
   summing latency.

## Issue 2 — Mobile shows the player but is stuck at 0:00

### Symptoms

On mobile (hosted dashboard, no local node), the universal player appears and
"resolves", but the video never loads — time stays at 0:00/0:00. Desktop
(extension / native / direct node) works.

### Root cause

The node has no inbound HTTP tunnel (`startPublicTunnel()` returns `null` in
`apps/server/src/standalone.ts`). Remote clients reach it only through the
outbound managed-gateway WebSocket relay (`ManagedGatewayLink` /
`apps/gateway/src/index.ts`), which is **pure RPC — it cannot proxy media HTTP**.

`requestRuntimeJson` (`apps/dashboard/src/lib/local-api.ts`) sets
`origin: response.endpointUrl ?? response.nodeId` for gateway transport. With no
endpoint URL that origin is a **bare node id**, and the node always returns
relative playback paths (`/api/download-full/browser-file?...` via
`buildPlaybackProxyPath`). `resolveRuntimeUrl` then joined them into a broken
`<nodeId>/api/download-full/browser-file?...` URL that no server serves.

### Fix already applied (commit `cb7fe60`)

`mediaOriginFromRuntime(origin, transport)` in
`apps/dashboard/src/lib/full-download-client.ts`:

- If `transport === "gateway"` **and** origin is not an `http(s)` URL, return
  `window.location.origin` (the hosted dashboard).
- Otherwise return the origin unchanged.

Applied at the three call sites that resolve media URLs against the runtime
origin: `resolveUniversalPlayback`, `resolveCleanPlayback`,
`startBrowserResolvedDownload`. The hosted `/api/download-full/browser-file`
serverless function (`apps/dashboard/api/download-full/browser-file.js`) then
proxies the media same-origin, rewrites HLS `URI=`/segment lines, forwards the
referer, and supports range requests.

### Known limitation

Gateway-transport media now flows **through Vercel's datacenter**. Sources that
403 Vercel IPs (e.g. `svetserialu`-hosted media) may still fail on mobile. This
is unavoidable without a node HTTP path; it is the only reachable media route
for remote clients today.

## Guidelines for changing this safely

### Required verification before commit

```powershell
npm run build -w @spilledcinema/dashboard   # tsc -b + vite build must pass
npm run test -w @spilledcinema/dashboard    # 38 files / 155 tests must pass
```

Deploy, commit, push on the branch (`fix/playback-issues` currently):

```powershell
# from apps/dashboard
npx vercel deploy --prod
git add <files> && git commit -m "fix(dashboard): ..."
git push origin <branch>
```

### Don't change the transport precedence in `requestRuntimeJson`

`requestRuntimeJson` tries native -> same-origin node -> extension -> direct ->
hosted API -> gateway -> fetch-server, in that order. Moving gateway before
native/direct, or skipping a transport, changes *all* RPC behavior (search,
imports, status, downloads), not just playback. Never reorder it to "fix" media.

### Preserve behavior for every transport except gateway

`mediaOriginFromRuntime` must stay a no-op for `native`, `node`, `direct`,
`extension`, `fetch-server`, `hosted`, and for gateway when the origin **is** a
real `http(s)` URL. A regression check: after any edit, desktop playback
(extension/native/direct) and localhost dev (`npm run dev` in `apps/dashboard`)
must still resolve to the node's own origin, not the hosted origin.

### Keep the cache keys conservative

- Validation cache key is `streamUrl|refererUrl`. Do not widen it to drop the
  referer — the referer is part of what makes an upstream URL valid.
- Cap the cache (512) and use short TTLs; this module is a serverless singleton
  and unbounded growth leaks memory across requests.
- Cache only **successful** validations (`ok: true`). Caching failures would
  hide transient network errors for the TTL duration.

### Mind test isolation (module-level state)

The module-level caches persist across tests in the same file. This is exactly
how a stale vidking entry leaked into the fallback test. When adding cache
behavior:

- Prefer short TTLs that don't outlive the refresh cadence of the underlying
  cache (vidking revalidates at 30 s; a 10-minute validation cache would mask
  it — hence `bypassCache = true` there).
- If a cache must skip revalidation for correctness (e.g. a "must check
  freshness" path), add an explicit opt-out parameter rather than clearing the
  cache or shrinking the TTL globally.

### Don't let the fast path bypass the refresh/retry contract

The persisted-stream fast path skips validation. Accept this: dead URLs fail at
the player and the user retries via `handleChoosePlayer`/retry in
`PlayerModal.tsx`, which force-fresh-resolves (`playbackErrorRetryRef`). Keep
`canReuseDirectStreamUrl` gating volatility (streamtape fresh signed URLs,
vidking always re-resolve) — do not make the fast path unconditional.

### Concurrency changes must stay bounded

`runFirstSuccess` uses concurrency 2. Raising it hammers provider hosts and can
trip upstream rate limits or get the dashboard IP blocked. Prefer the active
player first, then fallbacks — do not run all players in parallel including the
active one.

### Media relay expectations (Vercel `browser-file.js`)

- It returns `Content-Disposition: inline` when `playback=1` is passed — the
  node's `buildPlaybackProxyPath` and the client fast path must keep sending it.
- It rewrites HLS playlist URIs relative to its own proxy path, so the mobile
  playback URL must be **same-origin** with the dashboard (`window.location.origin`)
  for segments to resolve. Never rewrite a gateway playback URL to the node id.
- Subtitle URLs on mobile resolve to `/api/subtitle-proxy` on the hosted origin;
  if that proxy is ever removed, subtitles silently stop — keep it deployed.

### When in doubt, narrow the change

Every fix here is a small, well-scoped delta (a cache, an origin normalizer, a
loop restructure). If a proposed fix touches transport ordering, the node's HTTP
layer, or the gateway protocol, it is out of scope for these two issues and
should be its own task.
