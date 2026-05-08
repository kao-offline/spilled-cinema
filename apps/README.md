# Apps

- `server` contains the node runtime, security/auth surface, and server-facing contracts.
- `dashboard` contains the main Vite dashboard UI.
- `client/extension` contains the Chrome bridge that lets the deployed dashboard talk to a local runtime.
- `client/native` contains the Electron shell that starts the local server automatically and opens the dashboard.
- `extractor` contains the Next.js extractor and browser extension workflow.
- `node` is the legacy internal runtime location kept temporarily for compatibility during the reorganization.
