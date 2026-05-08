# SpilledCinema Extractor

This app contains the extractor UI and capture workflow used to isolate players and send them into the wider SpilledCinema ecosystem.

## Run

```bash
npm run dev -w apps/extractor
```

## Related pieces

- `../client/extension`
  Chrome bridge for local-runtime access from the web app.
- `../dashboard`
  Main user-facing library app.
- `../server`
  Local/server runtime that backs downloads, auth, and node behavior.
