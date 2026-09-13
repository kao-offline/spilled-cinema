const CACHE_PREFIX = "spilled.player-url-cache.v3";
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PLAYBACK_CACHE_TTL_MS = 20 * 60 * 1000;

type CachedPlayerUrl = {
  url: string;
  cachedAt: number;
};

type CachedPlayerFailure = {
  error: string;
  cachedAt: number;
};

const BROWSER_FILE_PATH = "/api/download-full/browser-file";

function findBrowserFileSegment(url: string) {
  const searchIndex = url.indexOf("?");
  const pathPart = searchIndex === -1 ? url : url.slice(0, searchIndex);
  const markerIndex = pathPart.indexOf(BROWSER_FILE_PATH);
  if (markerIndex === -1) {
    return null;
  }
  return {
    search: searchIndex === -1 ? "" : url.slice(searchIndex),
  };
}

export function normalizePlaybackUrlForClient(url: string) {
  if (typeof window === "undefined") {
    return url;
  }

  const segment = findBrowserFileSegment(url);
  if (!segment) {
    return url;
  }

  let parsed: URL;
  try {
    parsed = new URL(url, window.location.origin);
  } catch {
    return url;
  }

  const isCanonicalPath = parsed.pathname === BROWSER_FILE_PATH;
  if (isCanonicalPath && parsed.origin === window.location.origin) {
    return url;
  }

  const localRuntimeHost = ["127.0.0.1", "localhost"].includes(parsed.hostname);
  if (isCanonicalPath && !localRuntimeHost) {
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "loca.lt" || hostname.endsWith(".loca.lt")) {
      // Localtunnel serves a 511 interstitial ("Network Authentication Required")
      // to browser-navigated/media requests that lack the bypass-tunnel-reminder
      // header. A <video> tag cannot send that header, so route localtunnel
      // media through the same-origin /api/node-proxy, which adds the header
      // server-side. (trycloudflare.com has no interstitial and stays direct.)
      const proxy = new URL("/api/node-proxy", window.location.origin);
      proxy.searchParams.set("node", parsed.origin);
      proxy.searchParams.set("path", `${BROWSER_FILE_PATH}${segment.search}`);
      return `${proxy.pathname}${proxy.search}`;
    }
    // A reachable node endpoint (e.g. a public fetch tunnel) proxies media from
    // the source IP and rewrites the playlist to its own origin, so it works on
    // every device, including Apple mobile. Keep it as-is.
    return url;
  }

  // Local-runtime hosts (127.0.0.1/localhost) are never reachable from a hosted
  // page, and stale node-id-prefixed cache entries are not resolvable; route
  // those through the same-origin dashboard proxy.
  return `${window.location.origin}${BROWSER_FILE_PATH}${segment.search}`;
}

function normalizeRuntimePlaybackUrl(kind: string, url: string) {
  if (kind !== "playback" || typeof window === "undefined") {
    return url;
  }

  return normalizePlaybackUrlForClient(url);
}

function cacheKey(kind: string, key: string) {
  return `${CACHE_PREFIX}:${kind}:${encodeURIComponent(key)}`;
}

function cacheTtl(kind: string) {
  return kind === "playback" ? PLAYBACK_CACHE_TTL_MS : DEFAULT_CACHE_TTL_MS;
}

export function readCachedPlayerUrl(kind: string, key: string) {
  try {
    const raw = localStorage.getItem(cacheKey(kind, key));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<CachedPlayerUrl>;
    if (typeof parsed.url !== "string" || typeof parsed.cachedAt !== "number") {
      return null;
    }

    if (Date.now() - parsed.cachedAt > cacheTtl(kind)) {
      localStorage.removeItem(cacheKey(kind, key));
      return null;
    }

    return normalizeRuntimePlaybackUrl(kind, parsed.url);
  } catch {
    return null;
  }
}

export function removeCachedPlayerUrl(kind: string, key: string) {
  try {
    localStorage.removeItem(cacheKey(kind, key));
  } catch {
    // Cache failure should not block playback.
  }
}

export function writeCachedPlayerUrl(kind: string, key: string, url: string) {
  try {
    localStorage.setItem(cacheKey(kind, key), JSON.stringify({
      url,
      cachedAt: Date.now(),
    } satisfies CachedPlayerUrl));
  } catch {
    // Cache failure should not block playback.
  }
}

export function readCachedPlayerFailure(kind: string, key: string) {
  try {
    const raw = localStorage.getItem(cacheKey(`${kind}:failure`, key));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<CachedPlayerFailure>;
    if (typeof parsed.error !== "string" || typeof parsed.cachedAt !== "number") {
      return null;
    }

    if (Date.now() - parsed.cachedAt > 10 * 60 * 1000) {
      localStorage.removeItem(cacheKey(`${kind}:failure`, key));
      return null;
    }

    return parsed.error;
  } catch {
    return null;
  }
}

export function writeCachedPlayerFailure(kind: string, key: string, error: string) {
  try {
    localStorage.setItem(cacheKey(`${kind}:failure`, key), JSON.stringify({
      error,
      cachedAt: Date.now(),
    } satisfies CachedPlayerFailure));
  } catch {
    // Cache failure should not block playback.
  }
}

export function removeCachedPlayerFailure(kind: string, key: string) {
  try {
    localStorage.removeItem(cacheKey(`${kind}:failure`, key));
  } catch {
    // Cache failure should not block playback.
  }
}
