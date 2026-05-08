# SpilledCinema Server

This package is the organized home for the server runtime.

Current contents:

- `src/runtime.ts`
  Re-exports the node runtime used by the dashboard compatibility layer.
- `src/http-surface.ts`
  Defines the server-facing operations that an HTTP transport should expose.
- `src/index.ts`
  Main export barrel for server consumers.
- `src/http-handlers.ts`
  Shared HTTP route handlers used by both the dashboard adapter and standalone server.
- `src/standalone.ts`
  Standalone Node HTTP server entrypoint.

Run locally:

```bash
npm run dev -w @spilledcinema/server
```

Mesh environment:

- `PORT`
  Bind port. Default: `8787`
- `HOST`
  Bind host. Default: `0.0.0.0`
- `SPILLED_NODE_ENDPOINT_URL`
  Public base URL advertised to the mesh and control plane. Set this on
  deployed relays so discovery returns a real reachable URL instead of a local
  fallback.
- `CORS_ORIGIN`
  Allowed origin for browser clients. Default: `*`
- `SPILLED_MESH_PEERS`
  Comma-separated list of peer base URLs, for example:
  `http://node-a:8787,http://node-b:8787`
- `SPILLED_MESH_INTERVAL_MS`
  Peer sync interval. Default: `30000`
- `SPILLED_MESH_FETCH_TIMEOUT_MS`
  Peer HTTP timeout. Default: `8000`

Mesh endpoints:

- `GET /api/node/mesh/snapshot`
- `GET /api/node/mesh/nodes`
- `POST /api/node/mesh/announce`

Control plane environment:

- `SPILLED_CONTROL_PLANE_URL`
  Base URL of the Convex-backed control plane, for example:
  `https://spilled.overload.studio/server`
- `SPILLED_CONTROL_PLANE_INTERVAL_MS`
  Register/heartbeat interval. Default: `30000`
- `SPILLED_CONTROL_PLANE_FETCH_TIMEOUT_MS`
  Control-plane HTTP timeout. Default: `8000`

When configured, the node reports:

- `POST /server/node/register` on boot
- `POST /server/node/heartbeat` on an interval

Run with Docker:

```bash
docker build -f apps/server/Dockerfile -t spilledcinema-server .
docker run --rm -p 8787:8787 spilledcinema-server
```
