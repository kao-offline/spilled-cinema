export type SkipSegmentType = "intro" | "outro" | "recap" | "credits";

export type SkipSegment = {
  start: number;
  end: number | null;
  type: SkipSegmentType;
};

export type SkipTitleIds = {
  imdb?: string;
  tmdb?: string;
  tvdb?: string;
};

const ID_PATTERNS = {
  imdb: /tt\d{5,10}/i,
  tmdb: /(?:\btmdb(?:_id|id)?=|\/movie\/|\/tv\/|\/watch\/|\/title\/(?:tv|movie)\/)(\d{3,9})/i,
};

function extractIdsFromUrl(url: string): SkipTitleIds {
  const ids: SkipTitleIds = {};
  if (!url) return ids;
  const imdbMatch = url.match(ID_PATTERNS.imdb);
  if (imdbMatch) ids.imdb = imdbMatch[0].toLowerCase();
  try {
    const parsed = new URL(url);
    const tmdbParam = parsed.searchParams.get("tmdb") ?? parsed.searchParams.get("tmdb_id");
    if (tmdbParam && /^\d{3,9}$/.test(tmdbParam)) ids.tmdb = tmdbParam;
  } catch {}
  const tmdbMatch = url.match(/\/(?:movie|tv|watch|title\/(?:tv|movie))\/(\d{3,9})(?:[/?#]|$)/i);
  if (tmdbMatch && !ids.tmdb) ids.tmdb = tmdbMatch[1];
  return ids;
}

export function collectSkipTitleIds(show: unknown, episode: unknown): SkipTitleIds {
  const ids: SkipTitleIds = {};
  const seen = new Set<string>();
  const addImdb = (value: unknown) => {
    if (typeof value === "string" && ID_PATTERNS.imdb.test(value)) {
      const v = value.toLowerCase();
      if (!seen.has(v)) { seen.add(v); ids.imdb = v; }
    }
  };
  const addTmdb = (value: unknown) => {
    if (typeof value === "string" && /^\d{3,9}$/.test(value)) {
      if (!seen.has(`tmdb:${value}`)) { seen.add(`tmdb:${value}`); ids.tmdb = value; }
    }
  };

  const showAny = show as { externalIds?: SkipTitleIds; canonicalIdentity?: { externalIds?: SkipTitleIds } } | null | undefined;
  addImdb(showAny?.externalIds?.imdb);
  addImdb(showAny?.canonicalIdentity?.externalIds?.imdb);
  addTmdb(showAny?.externalIds?.tmdb);
  addTmdb(showAny?.canonicalIdentity?.externalIds?.tmdb);
  addTmdb(showAny?.externalIds?.tvdb?.startsWith("tmdb") ? showAny.externalIds.tvdb.replace(/^tmdb/i, "") : showAny?.externalIds?.tvdb);

  const episodeAny = episode as {
    episodeUrl?: string;
    players?: Array<{ embedUrl?: string; sourcePageUrl?: string; streamUrl?: string }>;
  } | null | undefined;
  const urls = [
    episodeAny?.episodeUrl,
    ...(episodeAny?.players ?? []).flatMap((player) => [player.embedUrl, player.sourcePageUrl, player.streamUrl]),
  ].filter(Boolean) as string[];
  for (const url of urls) {
    const fromUrl = extractIdsFromUrl(url);
    if (fromUrl.imdb && !ids.imdb) addImdb(fromUrl.imdb);
    if (fromUrl.tmdb && !ids.tmdb) addTmdb(fromUrl.tmdb);
  }

  return ids;
}

const TIDB_BASE = "https://api.theintrodb.org/v3";
const TOSD_BASE = "https://tosd.qtchaos.de/v1/skip";
const SKIPME_BASE = "https://api.skipme.db/v1/segments";
const CACHE_PREFIX = "spilled.intro-skip.v1";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function cacheKey(id: string, season: number, episode: number): string {
  return `${CACHE_PREFIX}:${id}:s${season}:e${episode}`;
}

function readCache(imdbId: string, season: number, episode: number): SkipSegment[] | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(imdbId, season, episode));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { segments: SkipSegment[]; savedAt: number };
    if (Date.now() - parsed.savedAt > CACHE_TTL_MS) {
      window.localStorage.removeItem(cacheKey(imdbId, season, episode));
      return null;
    }
    return parsed.segments;
  } catch {
    return null;
  }
}

function writeCache(imdbId: string, season: number, episode: number, segments: SkipSegment[]) {
  try {
    window.localStorage.setItem(cacheKey(imdbId, season, episode), JSON.stringify({
      segments,
      savedAt: Date.now(),
    }));
  } catch {}
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

function normalizeTIDBSegments(data: Record<string, unknown>): SkipSegment[] {
  const segments: SkipSegment[] = [];
  for (const type of ["intro", "recap", "credits", "preview"] as const) {
    const arr = data[type];
    if (!Array.isArray(arr)) continue;
    const segType: SkipSegmentType = type === "intro" ? "intro" : type === "recap" ? "recap" : type === "credits" ? "credits" : "outro";
    for (const entry of arr) {
      if (!entry || typeof entry !== "object") continue;
      const obj = entry as Record<string, unknown>;
      const startMs = obj.start_ms as number | null;
      const endMs = obj.end_ms as number | null;
      if (endMs === 0) continue;
      if (startMs !== null && endMs !== null && startMs >= endMs) continue;
      segments.push({
        start: (startMs ?? 0) / 1000,
        end: endMs != null ? endMs / 1000 : null,
        type: segType,
      });
    }
  }
  return segments;
}

function normalizeGenericSegments(items: unknown[]): SkipSegment[] {
  const typeMap: Record<string, SkipSegmentType> = {
    opening: "intro", op: "intro", intro: "intro",
    ending: "outro", ed: "outro", outro: "outro",
    recap: "recap", credits: "credits", preview: "outro",
  };
  const segments: SkipSegment[] = [];
  for (const entry of items) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const start = typeof obj.start === "number" ? obj.start : typeof obj.startTime === "number" ? obj.startTime : null;
    const end = typeof obj.end === "number" ? obj.end : typeof obj.endTime === "number" ? obj.endTime : null;
    if (start == null || end == null || start >= end) continue;
    const rawType = (typeof obj.type === "string" ? obj.type : typeof obj.segmentType === "string" ? obj.segmentType : "intro").toLowerCase();
    segments.push({ start, end, type: typeMap[rawType] || "intro" });
  }
  return segments;
}

async function fetchFromTIDB(ids: SkipTitleIds, season: number, episode: number): Promise<SkipSegment[]> {
  try {
    const params = new URLSearchParams({ season: String(season), episode: String(episode) });
    if (ids.imdb) params.set("imdb_id", ids.imdb);
    if (ids.tmdb) params.set("tmdb_id", ids.tmdb);
    if (ids.tvdb) params.set("tvdb_id", ids.tvdb);
    const url = `${TIDB_BASE}/media?${params.toString()}`;
    const response = await fetchWithTimeout(url, {
      headers: { "Accept": "application/json" },
    }, 8000);
    if (!response.ok) return [];
    const data = await response.json() as Record<string, unknown>;
    return normalizeTIDBSegments(data);
  } catch {
    return [];
  }
}

async function fetchFromSkipMe(imdbId: string, season: number, episode: number): Promise<SkipSegment[]> {
  try {
    const url = `${SKIPME_BASE}?imdb=${encodeURIComponent(imdbId)}&season=${season}&episode=${episode}`;
    const response = await fetchWithTimeout(url, {
      headers: { "Accept": "application/json" },
    }, 8000);
    if (!response.ok) return [];
    const data = await response.json() as unknown;
    const items = Array.isArray(data) ? data : (data && typeof data === "object" && "segments" in data && Array.isArray((data as { segments: unknown }).segments) ? (data as { segments: unknown[] }).segments : []);
    return normalizeGenericSegments(items);
  } catch {
    return [];
  }
}

async function fetchFromTOSD(imdbId: string, season: number, episode: number): Promise<SkipSegment[]> {
  try {
    const url = `${TOSD_BASE}/${imdbId}/${season}/${episode}`;
    const response = await fetchWithTimeout(url, {
      headers: { "Accept": "application/json" },
    }, 8000);
    if (!response.ok) return [];
    const data = await response.json() as unknown;
    const items = Array.isArray(data) ? data : (data && typeof data === "object" && "segments" in data && Array.isArray((data as { segments: unknown }).segments) ? (data as { segments: unknown[] }).segments : []);
    return normalizeGenericSegments(items);
  } catch {
    return [];
  }
}

const tmdbSearchCache = new Map<string, { tmdbId: string | null; imdbId: string | null }>();

export async function resolveSkipTitleIdsByTitle(
  title: string,
  mediaType: string | undefined,
  year: string | number | null | undefined,
): Promise<SkipTitleIds> {
  const normalizedTitle = title.trim().toLowerCase();
  if (!normalizedTitle) return {};
  const yearStr = year != null ? String(year).replace(/[^\d].*$/, "").slice(0, 4) : "";
  const cacheKey = `${mediaType}:${normalizedTitle}:${yearStr}`;
  const cached = tmdbSearchCache.get(cacheKey);
  if (cached) return { tmdb: cached.tmdbId ?? undefined, imdb: cached.imdbId ?? undefined };
  try {
    const params = new URLSearchParams({ title: title.trim(), mediaType: mediaType === "movie" ? "movie" : "tv" });
    if (yearStr) params.set("year", yearStr);
    const url = `/api/tmdb-search?${params.toString()}`;
    const response = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, 8000);
    if (!response.ok) { tmdbSearchCache.set(cacheKey, { tmdbId: null, imdbId: null }); return {}; }
    const data = await response.json() as { tmdbId?: string | null; imdbId?: string | null };
    const ids: SkipTitleIds = {};
    if (typeof data.tmdbId === "string" && /^\d{3,9}$/.test(data.tmdbId)) ids.tmdb = data.tmdbId;
    if (typeof data.imdbId === "string" && /^tt\d{5,10}$/i.test(data.imdbId)) ids.imdb = data.imdbId.toLowerCase();
    tmdbSearchCache.set(cacheKey, { tmdbId: ids.tmdb ?? null, imdbId: ids.imdb ?? null });
    return ids;
  } catch {
    tmdbSearchCache.set(cacheKey, { tmdbId: null, imdbId: null });
    return {};
  }
}

export async function fetchSkipSegments(
  imdbId: string | undefined,
  season: number,
  episode: number,
  tmdbId?: string,
): Promise<SkipSegment[]> {
  const ids: SkipTitleIds = { imdb: imdbId, tmdb: tmdbId };
  return fetchSkipSegmentsForIds(ids, season, episode);
}

export async function fetchSkipSegmentsForIds(
  ids: SkipTitleIds,
  season: number,
  episode: number,
): Promise<SkipSegment[]> {
  if ((!ids.imdb && !ids.tmdb && !ids.tvdb) || season < 1 || episode < 1) return [];

  const cacheId = ids.imdb ?? (ids.tmdb ? `tmdb:${ids.tmdb}` : `tvdb:${ids.tvdb}`);
  const cached = readCache(cacheId, season, episode);
  if (cached) return cached;

  let segments = await fetchFromTIDB(ids, season, episode);

  if (segments.length === 0 && ids.imdb) {
    const imdbCacheId = ids.imdb;
    const imdbCached = readCache(imdbCacheId, season, episode);
    if (imdbCached) return imdbCached;
    segments = await fetchFromSkipMe(ids.imdb, season, episode);
    if (segments.length === 0) {
      segments = await fetchFromTOSD(ids.imdb, season, episode);
    }
    if (segments.length > 0) {
      writeCache(imdbCacheId, season, episode, segments);
    }
  }

  if (segments.length > 0) {
    writeCache(cacheId, season, episode, segments);
  }

  return segments;
}

export function getIntroSegments(segments: SkipSegment[]): SkipSegment[] {
  return segments.filter((s) => s.type === "intro");
}

export function getOutroSegments(segments: SkipSegment[]): SkipSegment[] {
  return segments.filter((s) => s.type === "outro");
}

export function findActiveSkipSegment(
  segments: SkipSegment[],
  currentTime: number,
): SkipSegment | null {
  for (const segment of segments) {
    if (segment.end === null) {
      if (currentTime >= segment.start) return segment;
    } else {
      if (currentTime >= segment.start && currentTime <= segment.end) return segment;
    }
  }
  return null;
}

export async function prewarmSkipTarget(
  playbackUrl: string,
  targetTime: number,
): Promise<void> {
  if (!playbackUrl || targetTime <= 0) return;
  try {
    const isHls = /\.m3u8(?:$|[?#])|\/hls3\//i.test(playbackUrl);
    if (isHls) {
      const response = await fetch(playbackUrl, { cache: "force-cache", credentials: "same-origin" });
      if (response.ok) await response.arrayBuffer().catch(() => undefined);
    }
  } catch {}
}
