const LOCAL_ORIGINS = [
  "http://127.0.0.1:8787",
  "http://localhost:8787",
];

const ALLOWED_PATH_PREFIXES = [
  "/api/status",
  "/api/node/",
  "/api/download-full/",
  "/api/player/",
  "/api/search",
  "/api/explore/",
  "/api/import-",
  "/api/subtitle-proxy",
];

function isAllowedPath(path) {
  return ALLOWED_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

async function fetchLocal(path, init = {}) {
  if (!isAllowedPath(path)) {
    throw new Error(`Blocked local API path: ${path}`);
  }

  let lastError = null;
  for (const origin of LOCAL_ORIGINS) {
    try {
      const response = await fetch(`${origin}${path}`, init);
      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      return {
        ok: response.ok,
        status: response.status,
        origin,
        data,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Local runtime unreachable.");
}

async function handleRuntimeAction(message) {
  switch (message.action) {
    case "ping":
      return {
        ok: true,
        version: chrome.runtime.getManifest().version,
      };
    case "getStatus":
      return await fetchLocal("/api/status", { method: "GET" });
    case "fetchLocal":
      return await fetchLocal(message.path, {
        method: message.method || "GET",
        headers: message.headers || {},
        body: message.body ? JSON.stringify(message.body) : undefined,
      });
    default:
      throw new Error(`Unknown extension action: ${message.action}`);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.namespace !== "spilledcinema") {
    return false;
  }

  void handleRuntimeAction(message)
    .then((payload) => sendResponse({ ok: true, payload }))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  return true;
});
