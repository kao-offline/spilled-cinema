# SpilledCinema Runtime Testing

## 1. Extension path

Use this when testing the deployed dashboard talking to a local runtime through Chrome.

Start the local server:

```bash
npm run start:server
```

Build the extension:

```bash
npm run build -w @spilledcinema/client-extension
```

Load `apps/client/extension/dist` as an unpacked extension in Chrome.

Checks:

- `http://127.0.0.1:8787/api/status` returns JSON
- extension popup shows connected status
- `Settings -> General -> Local runtime` shows `extension`
- remote search/import/download actions still work from the dashboard

## 2. Native app path

Use this when testing the desktop shell that starts the local runtime automatically.

Run:

```bash
npm run dev:native
```

Checks:

- Electron opens the dashboard
- `http://127.0.0.1:8787/api/status` returns JSON
- `Settings -> General -> Local runtime` shows `native`
- search/import/download actions work without the extension installed

## 3. Deployed dashboard path

Use this when testing the public site with a local runtime.

Open:

- `https://spilled.overload.studio`
- `https://spilled.kaooffline.top`

Then either:

- run the Chrome extension + local server
- or run the native shell

Checks:

- the dashboard detects a local runtime
- app actions that normally call `/api/*` succeed through the local bridge
- no public node URL is needed

## 4. Quick smoke commands

Local status:

```bash
curl http://127.0.0.1:8787/api/status
```

Search:

```bash
curl -X POST http://127.0.0.1:8787/api/search ^
  -H "Content-Type: application/json" ^
  -d "{\"query\":\"friends\"}"
```

Downloads list:

```bash
curl http://127.0.0.1:8787/api/download-full/list
```
