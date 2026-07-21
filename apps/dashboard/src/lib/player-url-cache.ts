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

function normalizeRuntimePlaybackUrl(kind: string, url: string) {
  if (kind !== "playback" || typeof window === "undefined") {
    return url;
  }

  try {
    const parsed = new URL(url, window.location.origin);
    if (
      parsed.pathname === "/api/download-full/browser-file" &&
      ["127.0.0.1", "localhost"].includes(parsed.hostname) &&
      parsed.origin !== window.location.origin
    ) {
      return `${window.location.origin}${parsed.pathname}${parsed.search}`;
    }
  } catch {
    return url;
  }

  return url;
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
