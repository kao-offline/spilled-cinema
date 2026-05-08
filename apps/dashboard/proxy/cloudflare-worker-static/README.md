# Cloudflare Worker Proxy (Static Upload Flow)

This is a minimal proxy for import endpoints when Vercel IPs are blocked by provider-side protections.

## Files in this folder

- worker.js: Worker source code to paste into Cloudflare dashboard.
- vercel-env-example.txt: Vercel environment variable format.

## Quick setup (Dashboard only)

1. Open Cloudflare dashboard.
2. Go to Workers and Pages.
3. Create Worker.
4. If you see "Upload static assets", keep it enabled or disabled, both are fine for this worker.
5. Replace the default worker code with the content from worker.js.
6. Save and Deploy.

## Add secret key

1. Open your deployed Worker.
2. Settings -> Variables.
3. Add secret:
   - Name: PROXY_KEY
   - Value: any long random string (32+ chars recommended)
4. Save.

## Configure Vercel

1. Open Vercel project settings.
2. Environment Variables.
3. Add:
   - Name: IMPORT_FETCH_PROXY_TEMPLATE
   - Value: from vercel-env-example.txt, replacing worker URL and key.
4. Redeploy.

## Test quickly

Use browser with your real key:

https://your-worker-name.your-subdomain.workers.dev/?key=YOUR_LONG_RANDOM_KEY&url=https%3A%2F%2Fsvetserialu.to%2Fserial%2Fbreaking-bad

Expected result: HTML response body from target page.

## Security notes

- Worker enforces host allowlist to only your target sites.
- Worker requires key parameter that must match PROXY_KEY.
- Keep key secret and rotate if leaked.
