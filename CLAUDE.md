# CLAUDE.md

**Read `AGENTS.md` first** — it contains the full server network architecture, runtime cascade, CORS rules, gotchas, and file reference.

When working on Convex code, also read `convex/_generated/ai/guidelines.md` for Convex-specific rules.

---

## Build Commands

| What | Command |
|------|---------|
| Dashboard build | `npm run build -w @spilledcinema/dashboard` |
| Dashboard test | `npm test -w @spilledcinema/dashboard` |
| Dashboard deploy | `npx vercel deploy --prod --yes` (from `apps/dashboard/`) |
| Server build | `npm run build -w @spilledcinema/server` |
| Server installer | `npm run dist:windows -w @spilledcinema/server-windows` |
| Gateway deploy | `npx wrangler deploy` (from `apps/gateway/`) |
| Control plane deploy | `$env:CONVEX_DEPLOYMENT="cheerful-lynx-4"; npx convex deploy` |

## Project Layout

```
apps/
  dashboard/          # Vite + React 19 web UI, deploys to Vercel
  server/             # Node.js server runtime (port 8787)
  server-windows/     # Electron NSIS installer for the server
  gateway/            # Cloudflare Worker + Durable Object
  verifier/           # Capability probe service
  verifier-windows/   # Electron tray app for verifier
  extractor/          # Next.js provider extraction
  client/             # Chrome extension + Electron desktop app
  node/               # Legacy internal runtime (compat)
convex/               # Control plane (Convex backend)
packages/
  node-protocol/      # V2 protocol types
  security/           # Encryption, signing, keys
  node-client/        # Client library for server comms
  storage/            # SQLite storage
  discovery/          # Node discovery
```
