# SpilledCinema

Production node and managed gateway setup: [docs/node-v2-setup.md](docs/node-v2-setup.md).

How nodes are verified, version compatibility, and adding a new server:
[docs/verification-system.md](docs/verification-system.md).

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

## Raspberry Pi IR remote setup

For a Raspberry Pi in an Argon case with its IR remote. Run on the Pi —
buttons load at boot and reach the dashboard with no extra steps:

```bash
curl -fsSL https://raw.githubusercontent.com/kao-offline/spilled-cinema/master/testing/ir-remote-prototype/pi/install.sh | sudo bash
```

If the dashboard runs on another computer, the Pi can forward button presses
to it instead (replace the address and token):

```bash
curl -fsSL https://raw.githubusercontent.com/kao-offline/spilled-cinema/master/testing/ir-remote-prototype/pi/install.sh | sudo bash -s -- --with-bridge --receiver-url http://192.168.1.50:8765 --token "YOUR_TOKEN"
```

Details: [testing/ir-remote-prototype/README.md](testing/ir-remote-prototype/README.md).

## Structure

- `apps/dashboard`
  Main user-facing app.
- `apps/server`
  Local/server runtime, auth surface, discovery, relay control-plane integration.
- `apps/server-windows`
  Self-contained Windows installer and tray host for the headless server.
- `apps/verifier-windows`
  Native Windows tray app for the automated verifier: logs, restart, legacy
  replacement, and self-update.
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
