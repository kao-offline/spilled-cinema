# SpilledCinema

Production node and managed gateway setup: [docs/node-v2-setup.md](docs/node-v2-setup.md).

SpilledCinema is now a monorepo, not a single `spilled-library` app.

## Easiest Windows server setup

For a spare Windows PC that should run only the server:

1. Download `Spilled-Server-Setup-*.exe` from GitHub Releases.
2. Run the installer.
3. Complete the setup page that opens automatically.

The installer contains the server and runtime. Git, Node.js, npm, and a copy of
this repository are not required on the destination PC. It uses protected
per-user storage, registers the headless host to start at Windows sign-in, and
opens the loopback-only owner wizard. It does not install the Spilled library
UI.

## Structure

- `apps/dashboard`
  Main user-facing app.
- `apps/server`
  Local/server runtime, auth surface, discovery, relay control-plane integration.
- `apps/server-windows`
  Self-contained Windows installer and tray host for the headless server.
- `apps/client/extension`
  Chrome extension bridge from the web app to a local runtime.
- `apps/client/native`
  Electron desktop shell that starts the local runtime and latest local dashboard.
- `apps/extractor`
  Extractor app and capture tooling.
- `convex`
  Control-plane backend for node registration, discovery, relay selection, and signatures.
- `packages/*`
  Shared protocol, node client, security, storage, and discovery code.

## Local workflows

- Dashboard only:
  `npm run dev:dashboard`
- Local server runtime:
  `npm run start:server`
- Native desktop app:
  `npm run dev:native`
- Chrome extension build:
  `npm run build -w @spilledcinema/client-extension`

## Notes

- The native app is intended to be fully local by default.
- The Chrome extension is intended to let the deployed dashboard talk to a local runtime without a public node URL.
- Convex is used as the control plane, not the heavy media execution plane.
