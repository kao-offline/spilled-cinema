import { normalizeSearchText } from "../lib/search-ranking";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type LastGoodEntry<T> = {
  updatedAt: number;
  value: T;
};

const memoryCache = new Map<string, CacheEntry<unknown>>();
const lastGoodCache = new Map<string, LastGoodEntry<unknown>>();
const inflightFetches = new Map<string, Promise<string>>();
const FORCE_REFRESH_MIN_INTERVAL_MS = 30_000;

export function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

export function stripTags(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

export function matchOne(html: string, pattern: RegExp) {
  const match = html.match(pattern);
  return match?.[1]?.trim() ?? null;
}

export function absoluteUrl(value: string, baseUrl: string) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

export function normalizeDiscoveryText(value: string | null | undefined) {
  return normalizeSearchText(String(value || ""));
}

export function parseYearRange(value: string | null | undefined) {
  const matches = String(value || "").match(/\b(19|20)\d{2}\b/g) ?? [];
  const years = matches.map((entry) => Number.parseInt(entry, 10)).filter(Number.isFinite);
  return {
    yearLabel: matches.length > 0 ? matches.join(" - ") : null,
    yearMin: years[0] ?? undefined,
    yearMax: years[years.length - 1] ?? undefined,
  };
}

async function fetchText(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    redirect: "follow",
    ...init,
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.8",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText} for ${url}`);
  }

  return response.text();
}

export async function cachedFetchText(url: string, ttlMs: number, init?: RequestInit, forceFresh = false) {
  const cacheKey = `html:${url}:${JSON.stringify(init?.method ?? "GET")}:${JSON.stringify(init?.body ?? null)}`;
  const now = Date.now();
  const cached = memoryCache.get(cacheKey) as CacheEntry<string> | undefined;
  const cachedAt = cached ? cached.expiresAt - ttlMs : 0;
  if (cached && cached.expiresAt > now && (!forceFresh || now - cachedAt < FORCE_REFRESH_MIN_INTERVAL_MS)) {
    return { html: cached.value, stale: false };
  }

  try {
    const pending = inflightFetches.get(cacheKey);
    const request = pending ?? fetchText(url, init);
    if (!pending) {
      inflightFetches.set(cacheKey, request);
    }
    const html = await request.finally(() => {
      if (!pending) inflightFetches.delete(cacheKey);
    });
    const completedAt = Date.now();
    memoryCache.set(cacheKey, {
      value: html,
      expiresAt: completedAt + ttlMs,
    });
    lastGoodCache.set(cacheKey, {
      value: html,
      updatedAt: completedAt,
    });
    return { html, stale: false };
  } catch (error) {
    const lastGood = lastGoodCache.get(cacheKey) as LastGoodEntry<string> | undefined;
    if (lastGood) {
      return { html: lastGood.value, stale: true };
    }
    throw error;
  }
}

export async function cachedComputation<T>(key: string, ttlMs: number, compute: () => Promise<T>) {
  const now = Date.now();
  const cached = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (cached && cached.expiresAt > now) {
    return { value: cached.value, stale: false };
  }

  try {
    const value = await compute();
    memoryCache.set(key, {
      value,
      expiresAt: now + ttlMs,
    });
    lastGoodCache.set(key, {
      value,
      updatedAt: now,
    });
    return { value, stale: false };
  } catch (error) {
    const lastGood = lastGoodCache.get(key) as LastGoodEntry<T> | undefined;
    if (lastGood) {
      return { value: lastGood.value, stale: true };
    }
    throw error;
  }
}

export function uniqueBy<T>(items: T[], getKey: (item: T) => string) {
  return Array.from(new Map(items.map((item) => [getKey(item), item])).values());
}

export function trimArray(values: Array<string | null | undefined>) {
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}
