import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { algoliasearch } from "algoliasearch";
import { normalizeSearchText, scoreSearchCandidate } from "../lib/search-ranking";
import type { SvetSerialuSearchResult } from "./svetserialu";

type AlgoliaHit = {
  objectID?: string;
  slug?: string;
  title?: string;
  alt_title?: string | null;
  year?: string | null;
  description?: string | null;
  poster_url?: string | null;
  genres?: string[] | string | null;
  imdb_rating?: number | null;
  csfd_rating?: number | string | null;
  network?: string | null;
  _rankingInfo?: {
    nbTypos?: number;
    firstMatchedWord?: number;
    userScore?: number;
    proximityDistance?: number;
  };
};

export type SvetSerialuIndexRecord = {
  objectID: string;
  slug: string;
  title: string;
  alt_title?: string | null;
  year?: string | null;
  year_start?: number | null;
  year_end?: number | null;
  description?: string | null;
  poster_url?: string | null;
  genres?: string[];
  network?: string | null;
  country?: string | null;
  language?: string[];
  status?: string | null;
  imdb_id?: string | null;
  imdb_rating?: number | null;
  csfd_id?: string | null;
  csfd_rating?: number | null;
  runtime?: number | null;
  episode_count?: number;
  actor_count?: number;
  season_count?: number;
  actors?: Array<{ n?: string; r?: string | null; tmdb_id?: number | null }>;
  crew?: Array<{ n?: string; j?: string; d?: string | null; tmdb_id?: number | null }>;
  production_companies?: Array<{ n?: string; tmdb_id?: number | null }>;
  episodes?: Array<{ c?: string; t?: string | null; s?: number }>;
  episodes_text?: string | null;
};

const INDEX_NAME = "spilledcinema_shows";
const CACHE_TTL_MS = 2 * 60 * 1000;
const CACHE_MAX = 200;
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../..");
const catalogEnvPath = join(repoRoot, "tools/svetserialu-catalog/.env");

let client: ReturnType<typeof algoliasearch> | null | undefined;
let warnedUnavailable = false;
const searchCache = new Map<string, { expiresAt: number; results: SvetSerialuSearchResult[] }>();

function loadCatalogEnv() {
  if (!existsSync(catalogEnvPath)) {
    return;
  }

  try {
    const env = readFileSync(catalogEnvPath, "utf8");
    for (const line of env.split(/\r?\n/)) {
      const match = line.match(/^\s*(ALGOLIA_APP_ID|ALGOLIA_API_KEY)=(.*)$/);
      if (!match || process.env[match[1]]) {
        continue;
      }
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // Algolia remains optional; legacy SvetSerialu search will cover failures.
  }
}

function getAlgoliaClient() {
  if (client !== undefined) {
    return client;
  }

  loadCatalogEnv();
  const appId = process.env.ALGOLIA_APP_ID?.trim();
  const apiKey = process.env.ALGOLIA_API_KEY?.trim();
  if (!appId || !apiKey) {
    if (!warnedUnavailable) {
      console.warn("[svetserialu-algolia] unavailable: ALGOLIA_APP_ID or ALGOLIA_API_KEY is missing.");
      warnedUnavailable = true;
    }
    client = null;
    return client;
  }

  try {
    client = algoliasearch(appId, apiKey);
  } catch (error) {
    if (!warnedUnavailable) {
      console.warn("[svetserialu-algolia] failed to initialize", error instanceof Error ? error.message : String(error));
      warnedUnavailable = true;
    }
    client = null;
  }
  return client;
}

function parseGenres(value: AlgoliaHit["genres"]) {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  }
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [];
  } catch {
    return String(value)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
}

function ratingBoost(hit: AlgoliaHit) {
  const imdb = typeof hit.imdb_rating === "number" ? hit.imdb_rating : 0;
  const csfd = typeof hit.csfd_rating === "number" ? hit.csfd_rating : Number.parseFloat(String(hit.csfd_rating ?? ""));
  return Math.round(Math.max(0, imdb) * 20 + (Number.isFinite(csfd) ? csfd : 0));
}

function algoliaRankBoost(hit: AlgoliaHit, index: number) {
  const ranking = hit._rankingInfo;
  return Math.max(0, 600 - index * 18)
    + Math.max(0, 180 - (ranking?.firstMatchedWord ?? 0) * 12)
    - Math.max(0, ranking?.nbTypos ?? 0) * 120
    - Math.max(0, ranking?.proximityDistance ?? 0) * 4;
}

function mapHit(query: string, hit: AlgoliaHit, index: number): SvetSerialuSearchResult | null {
  const slug = String(hit.slug ?? hit.objectID ?? "").trim();
  const title = String(hit.title ?? "").trim();
  if (!slug || !title) {
    return null;
  }

  const altTitle = typeof hit.alt_title === "string" ? hit.alt_title.trim() : "";
  const genres = parseGenres(hit.genres);
  const matchScore = scoreSearchCandidate(query, [
    title,
    altTitle,
    slug.replace(/-/g, " "),
    hit.year,
    hit.network,
    ...genres,
  ], index) + ratingBoost(hit) + algoliaRankBoost(hit, index);

  if (matchScore <= 0) {
    return null;
  }

  return {
    title,
    slug,
    platform: "svetserialu",
    posterUrl: hit.poster_url ?? null,
    mediaType: "serial",
    year: hit.year ?? null,
    alternateTitles: [altTitle].filter((entry) => entry && entry !== title),
    description: hit.description ?? null,
    genres,
    csfdRating: hit.csfd_rating ?? null,
    detailUrl: `https://svetserialu.to/serial/${slug}`,
    matchScore,
  };
}

function readCache(key: string) {
  const cached = searchCache.get(key);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= Date.now()) {
    searchCache.delete(key);
    return null;
  }
  return cached.results;
}

function writeCache(key: string, results: SvetSerialuSearchResult[]) {
  searchCache.set(key, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    results,
  });
  if (searchCache.size > CACHE_MAX) {
    const oldestKey = searchCache.keys().next().value as string | undefined;
    if (oldestKey) {
      searchCache.delete(oldestKey);
    }
  }
}

export function isSvetSerialuAlgoliaAvailable() {
  return Boolean(getAlgoliaClient());
}

export async function saveSvetSerialuRecords(records: SvetSerialuIndexRecord[]) {
  const deduped = Array.from(
    new Map(records.map((record) => [record.objectID, record])).values(),
  );
  if (deduped.length === 0) {
    return true;
  }

  const algolia = getAlgoliaClient();
  if (!algolia) {
    return false;
  }

  try {
    await algolia.saveObjects({ indexName: INDEX_NAME, objects: deduped });
    return true;
  } catch (error) {
    if (!warnedUnavailable) {
      console.warn("[svetserialu-algolia] failed to save records", error instanceof Error ? error.message : String(error));
      warnedUnavailable = true;
    }
    client = null;
    return false;
  }
}

export async function searchSvetSerialuAlgolia(query: string, limit = 12): Promise<SvetSerialuSearchResult[]> {
  const trimmed = query.trim();
  const cacheKey = normalizeSearchText(trimmed);
  if (cacheKey.length < 2) {
    return [];
  }

  const cached = readCache(cacheKey);
  if (cached) {
    return cached.slice(0, limit);
  }

  const algolia = getAlgoliaClient();
  if (!algolia) {
    return [];
  }

  try {
    const { results } = await algolia.search<AlgoliaHit>({
      requests: [{
        indexName: INDEX_NAME,
        query: trimmed,
        hitsPerPage: Math.max(limit, 12),
        getRankingInfo: true,
      }],
    });
    const hits = (results[0] as { hits?: AlgoliaHit[] } | undefined)?.hits ?? [];
    const mapped = hits
      .map((hit, index) => mapHit(trimmed, hit, index))
      .filter((item): item is SvetSerialuSearchResult => Boolean(item));
    const unique = new Map<string, SvetSerialuSearchResult>();
    for (const result of mapped.sort((left, right) => (right.matchScore ?? 0) - (left.matchScore ?? 0))) {
      if (!unique.has(result.slug)) {
        unique.set(result.slug, result);
      }
    }
    const output = [...unique.values()];
    writeCache(cacheKey, output);
    return output.slice(0, limit);
  } catch (error) {
    if (!warnedUnavailable) {
      console.warn("[svetserialu-algolia] search unavailable; falling back to legacy search.", error instanceof Error ? error.message : String(error));
      warnedUnavailable = true;
    }
    client = null;
    return [];
  }
}
