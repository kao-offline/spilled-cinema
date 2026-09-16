// Replaced with a content-hashed asset list by the production Vite build.
const BUILD = "__SPILLED_PRECACHE__";
const APP_SHELL_CACHE = `spilled-library-app-shell-${BUILD.version ?? "development"}`;
const ASSETS = typeof BUILD === "object" ? BUILD.assets : [];

self.addEventListener("install", (event) => {
  if (!ASSETS.length) return; // This worker is registered only in production.
  event.waitUntil(caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(ASSETS)));
  // Let an update wait until old tabs close; never interrupt active playback.
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("spilled-library-app-shell-") && key !== APP_SHELL_CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Never intercept credentials, API calls, streams, downloads or byte ranges.
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || request.headers.has("range")) return;
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      try {
        const response = await fetch(request, { signal: controller.signal });
        if (!response.ok) throw new Error("Navigation unavailable");
        return response;
      } catch {
        const cache = await caches.open(APP_SHELL_CACHE);
        return await cache.match("/index.html") ?? new Response("Offline. Open Spilled once while connected to save the app.", { status: 503, headers: { "Content-Type": "text/plain" } });
      } finally { clearTimeout(timer); }
    })());
    return;
  }
  // Only build-listed static assets are cached. Media lives in the existing vault.
  if (!ASSETS.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(APP_SHELL_CACHE);
    return await cache.match(url.pathname) ?? fetch(request);
  })());
});
