# SpilledCinema Native App

This Electron shell starts the local SpilledCinema server automatically and opens the latest local dashboard, not the deployed website.

It also reuses an already-running local server or dashboard when those ports are already active, instead of failing on startup.

Run:

```bash
npm run dev -w @spilledcinema/client-native
```

Optional environment:

- `SPILLED_NATIVE_PORT=8787`
- `SPILLED_NATIVE_DASHBOARD_PORT=4173`
- `SPILLED_DASHBOARD_URL=...`
  Optional override if you explicitly want to point Electron at a remote or custom dashboard URL.

Testing workflow:

1. Start the native shell:

```bash
npm run dev:native
```

2. Confirm the local runtime responds:

```bash
curl http://127.0.0.1:8787/api/status
```

3. The app should open a local dashboard at `http://127.0.0.1:4173` unless overridden.

If you already have the dashboard dev server running on `4173`, the native app will attach to that instead of starting another copy.

4. In the dashboard window, open `Settings -> General -> Local runtime`.
   It should show `Local runtime detected` with transport `native`.

5. Test an app action that uses the local runtime:
   - remote search from the dashboard
   - import a title
   - start a browser-resolved or full download

6. If the shell opens but the dashboard looks stale, verify you did not set `SPILLED_DASHBOARD_URL` to the deployed site.
