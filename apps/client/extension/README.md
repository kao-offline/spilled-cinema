# SpilledCinema Chrome Extension

This extension bridges the deployed SpilledCinema web app to a local runtime on:

- `http://127.0.0.1:8787`
- `http://localhost:8787`

Build:

```bash
npm run build -w @spilledcinema/client-extension
```

Then load `apps/client/extension/dist` as an unpacked extension in Chrome.

Testing workflow:

1. Start the local server:

```bash
npm run start:server
```

2. Verify the runtime directly:

```bash
curl http://127.0.0.1:8787/api/status
```

3. Load the unpacked extension from `apps/client/extension/dist`.

4. Open the extension popup.
   It should show `Connected via http://127.0.0.1:8787` or `http://localhost:8787`.

5. Open the dashboard:
   - local dev: `npm run dev:dashboard`
   - deployed app: `https://spilled.overload.studio` or `https://spilled.kaooffline.top`

6. In `Settings -> General -> Local runtime`, confirm transport `extension`.

7. Test one API-backed feature:
   - search
   - import
   - download start

If those work from the deployed dashboard without a public node URL, the extension bridge is doing its job.
