const APP_SHELL_CACHE = "spilled-library-app-shell-v5";

const IS_LOCAL_DEV = ["localhost", "127.0.0.1", "[::1]"].includes(self.location.hostname);
const IS_VITE_DEV = IS_LOCAL_DEV && self.location.port === "5173";

const APP_SHELL_ASSETS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/app-icon-dark-rounded-192.png",
  "/icons/app-icon-dark-rounded-512.png",
  "/icons/app-icon-light-rounded-192.png",
  "/icons/app-icon-light-rounded-512.png",
];

self.addEventListener("install", (event) => {
  if (IS_VITE_DEV) {
    event.waitUntil(self.registration.unregister());
    return;
  }

  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  if (IS_VITE_DEV) {
    event.waitUntil(self.registration.unregister());
    return;
  }

  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== APP_SHELL_CACHE && !key.startsWith("spilled-library-episode-cache-"))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  if (IS_VITE_DEV) {
    return;
  }

  const requestUrl = new URL(event.request.url);
  const hasRangeHeader = event.request.headers.has("range");

  if (requestUrl.pathname.startsWith("/@vite/") || requestUrl.pathname.startsWith("/@id/") || requestUrl.pathname.startsWith("/@fs/") || requestUrl.pathname.startsWith("/__vite")) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await fetch(event.request);
      } catch {
        const cache = await caches.open(APP_SHELL_CACHE);
        return (await cache.match("/index.html")) ?? new Response("Offline", { status: 503 });
      }
    })());
    return;
  }

  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  // Never cache API or byte-range requests. Range responses must come directly
  // from the network to keep media seeking accurate.
  if (requestUrl.pathname.startsWith("/api/") || hasRangeHeader) {
    event.respondWith((async () => {
      try {
        return await fetch(event.request);
      } catch {
        return new Response("Offline - resource not available", {
          status: 503,
          statusText: "Service Unavailable",
          headers: { "Content-Type": "text/plain" },
        });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    try {
      const response = await fetch(event.request);
      if (response && response.ok) {
        const clone = response.clone();
        void caches.open(APP_SHELL_CACHE).then((cache) => cache.put(event.request, clone));
      }
      return cached || response;
    } catch {
      if (cached) {
        return cached;
      }
      return new Response("Offline - resource not available", {
        status: 503,
        statusText: "Service Unavailable",
        headers: { "Content-Type": "text/plain" },
      });
    }
  })());
});
