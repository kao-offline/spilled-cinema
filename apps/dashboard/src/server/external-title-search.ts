import { compareSearchScores, normalizeSearchText, scoreSearchCandidate } from "../lib/search-ranking";

export type ExternalTitleCandidate = {
  id: string;
  title: string;
  originalTitle?: string | null;
  mediaType: "movie" | "serial";
  year?: string | null;
  posterUrl?: string | null;
  source: "alias" | "imdb" | "tmdb" | "tvmaze" | "wikidata";
  matchScore: number;
  popularity?: number | null;
  voteCount?: number | null;
  voteAverage?: number | null;
  releaseDate?: string | null;
  originalLanguage?: string | null;
};

type ImdbSuggestionEntry = {
  id?: string;
  l?: string;
  q?: string;
  y?: number;
  yr?: string;
  i?: { imageUrl?: string };
};

type TmdbSearchResult = {
  id?: number;
  media_type?: string;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  popularity?: number;
  vote_count?: number;
  vote_average?: number;
  original_language?: string;
};

type TvMazeSearchResult = {
  show?: {
    id?: number;
    name?: string;
    premiered?: string | null;
    image?: { medium?: string | null; original?: string | null } | null;
  };
  score?: number;
};

type WikidataSearchEntity = {
  id?: string;
  label?: string;
  description?: string;
  aliases?: string[];
};

type WikidataSparqlBinding = {
  item?: { value?: string };
  itemLabel?: { value?: string };
  year?: { value?: string };
};

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_POSTER_BASE = "https://image.tmdb.org/t/p/w342";
const WIKIDATA_API_BASE = "https://www.wikidata.org/w/api.php";
const WIKIDATA_SPARQL_BASE = "https://query.wikidata.org/sparql";
const CATALOG_TIMEOUT_MS = 3500;
const CURRENT_YEAR = new Date().getFullYear();
const TMDB_SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const TMDB_SEARCH_CACHE_MAX = 200;
const tmdbSearchCache = new Map<string, { expiresAt: number; results: ExternalTitleCandidate[] }>();

const JAMES_BOND_ALIAS_TITLES: Array<{ title: string; originalTitle?: string; year: string }> = [
  { title: "Casino Royale", year: "2006" },
  { title: "Quantum of Solace", year: "2008" },
  { title: "Skyfall", year: "2012" },
  { title: "Spectre", year: "2015" },
  { title: "Nie je cas zomriet", originalTitle: "No Time to Die", year: "2021" },
  { title: "GoldenEye", year: "1995" },
  { title: "Tomorrow Never Dies", year: "1997" },
  { title: "The World Is Not Enough", year: "1999" },
  { title: "Die Another Day", year: "2002" },
  { title: "Dr. No", year: "1962" },
  { title: "From Russia with Love", year: "1963" },
  { title: "Goldfinger", year: "1964" },
  { title: "Thunderball", year: "1965" },
  { title: "You Only Live Twice", year: "1967" },
  { title: "On Her Majesty's Secret Service", year: "1969" },
  { title: "Diamonds Are Forever", year: "1971" },
  { title: "Live and Let Die", year: "1973" },
  { title: "The Man with the Golden Gun", year: "1974" },
  { title: "The Spy Who Loved Me", year: "1977" },
  { title: "Moonraker", year: "1979" },
  { title: "For Your Eyes Only", year: "1981" },
  { title: "Octopussy", year: "1983" },
  { title: "A View to a Kill", year: "1985" },
  { title: "The Living Daylights", year: "1987" },
  { title: "Licence to Kill", year: "1989" },
];

function getTmdbReadToken() {
  return process.env.TMDB_API_READ_TOKEN?.trim() || "";
}

function getTmdbApiKey() {
  return process.env.TMDB_API_KEY?.trim() || "";
}

function parseYear(value: string | number | null | undefined) {
  const match = String(value ?? "").match(/\b(19|20)\d{2}\b/);
  return match?.[0] ?? null;
}

function isLikelyTitleSuggestion(entry: ImdbSuggestionEntry) {
  const normalized = normalizeSearchText(entry.l ?? "");
  const category = String(entry.q ?? "");
  return Boolean(normalized) && !/\b(?:name|person|actor|actress|director|podcast|music video|video game)\b/i.test(category);
}

function isJamesBondAliasQuery(query: string) {
  const normalized = normalizeSearchText(query);
  if (normalized === "james bond" || normalized === "bond") {
    return true;
  }

  const tokens = normalized.split(" ").filter(Boolean);
  if (!tokens.includes("007")) {
    return false;
  }

  const allowed = new Set(["007", "film", "films", "movie", "movies"]);
  return tokens.every((token) => allowed.has(token));
}

function searchAliasCatalog(query: string): ExternalTitleCandidate[] {
  if (!isJamesBondAliasQuery(query)) {
    return [];
  }

  return JAMES_BOND_ALIAS_TITLES.map((entry, index) => ({
    id: `alias:james-bond:${normalizeSearchText(entry.originalTitle ?? entry.title).replace(/\s+/g, "-")}`,
    title: entry.title,
    originalTitle: entry.originalTitle ?? null,
    mediaType: "movie" as const,
    year: entry.year,
    posterUrl: null,
    source: "alias" as const,
    matchScore: 7200 - index * 20,
  }));
}

function scoreWikidataEntity(query: string, entity: WikidataSearchEntity, index: number) {
  const normalizedQuery = normalizeSearchText(query);
  const description = entity.description ?? "";
  const aliasText = Array.isArray(entity.aliases) ? entity.aliases.join(" ") : "";
  const textScore = scoreSearchCandidate(query, [entity.label, aliasText], index);
  const franchiseBoost = /\b(?:film series|media franchise|franchise|shared universe|book series)\b/i.test(description)
    ? 700
    : 0;
  const characterBoost = normalizedQuery.length <= 4 && /\b(?:character|fictional)\b/i.test(description) ? 250 : 0;
  const noisePenalty = /\b(?:surname|family name|given name|human|researcher|company|song|album|video game)\b/i.test(description)
    ? -900
    : 0;
  const characterPenalty = normalizedQuery.length > 4 && /\b(?:character|fictional)\b/i.test(description) ? -2000 : 0;

  return textScore + franchiseBoost + characterBoost + noisePenalty + characterPenalty;
}

async function searchWikidataEntities(query: string) {
  const url = new URL(WIKIDATA_API_BASE);
  url.searchParams.set("action", "wbsearchentities");
  url.searchParams.set("search", query);
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "6");
  url.searchParams.set("type", "item");

  const payload = await fetchJson<{ search?: WikidataSearchEntity[] }>(url.toString());
  const entities = Array.isArray(payload?.search) ? payload.search : [];

  return entities
    .map((entity, index) => ({ entity, score: scoreWikidataEntity(query, entity, index) }))
    .filter((entry) => entry.entity.id && entry.score >= 500)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);
}

async function fetchWikidataMemberTitles(entityId: string, scoreBoost: number): Promise<ExternalTitleCandidate[]> {
  const query = `
SELECT DISTINCT ?item ?itemLabel ?year WHERE {
  {
    ?item wdt:P179 wd:${entityId}.
  } UNION {
    wd:${entityId} wdt:P527 ?item.
  } UNION {
    ?item wdt:P361 wd:${entityId}.
  } UNION {
    ?item wdt:P674 wd:${entityId}.
  }
  ?item wdt:P31/wdt:P279* wd:Q11424.
  OPTIONAL { ?item wdt:P577 ?date. BIND(YEAR(?date) AS ?year) }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY DESC(?year) ?itemLabel
LIMIT 35`;

  const url = new URL(WIKIDATA_SPARQL_BASE);
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");

  const payload = await fetchJson<{ results?: { bindings?: WikidataSparqlBinding[] } }>(url.toString(), {
    headers: {
      "User-Agent": "SpilledCinemaSearch/1.0",
    },
  });
  const bindings = Array.isArray(payload?.results?.bindings) ? payload.results.bindings : [];

  const candidates = bindings
    .map((binding, index) => {
      const title = String(binding.itemLabel?.value ?? "").trim();
      const id = String(binding.item?.value?.split("/").pop() ?? "");
      const year = parseYear(binding.year?.value);
      return {
        id: `wikidata:${id}`,
        title,
        originalTitle: null,
        mediaType: "movie" as const,
        year,
        posterUrl: null,
        source: "wikidata" as const,
        matchScore: scoreBoost + Math.max(0, 700 - index * 12),
      };
    })
    .filter((entry) => {
      const year = entry.year ? Number.parseInt(entry.year, 10) : null;
      return (
        entry.id !== "wikidata:" &&
        entry.title &&
        !/^untitled\b/i.test(entry.title) &&
        (!year || year <= CURRENT_YEAR)
      );
    });
  const unique = new Map<string, ExternalTitleCandidate>();

  for (const candidate of candidates) {
    const key = normalizeSearchText(candidate.title);
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, candidate);
      continue;
    }

    const existingYear = existing.year ? Number.parseInt(existing.year, 10) : null;
    const candidateYear = candidate.year ? Number.parseInt(candidate.year, 10) : null;
    const shouldPreferCandidate =
      candidateYear !== null &&
      (existingYear === null || (candidateYear >= 1880 && candidateYear < existingYear));

    if (shouldPreferCandidate) {
      unique.set(key, {
        ...candidate,
        matchScore: Math.max(candidate.matchScore, existing.matchScore),
      });
    }
  }

  return [...unique.values()];
}

async function searchWikidataFranchiseTitles(query: string): Promise<ExternalTitleCandidate[]> {
  const entities = await searchWikidataEntities(query);
  const settled = await Promise.allSettled(
    entities.map((entry) => fetchWikidataMemberTitles(entry.entity.id ?? "", Math.max(900, entry.score))),
  );

  return settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...options?.headers,
      },
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function searchImdbSuggestions(query: string): Promise<ExternalTitleCandidate[]> {
  const normalized = normalizeSearchText(query);
  const first = normalized[0];
  if (!first) {
    return [];
  }

  const url = `https://v3.sg.media-imdb.com/suggestion/${encodeURIComponent(first)}/${encodeURIComponent(query)}.json`;
  const payload = await fetchJson<{ d?: ImdbSuggestionEntry[] }>(url);
  const entries = Array.isArray(payload?.d) ? payload.d : [];

  return entries
    .filter((entry) => entry.id?.startsWith("tt") && isLikelyTitleSuggestion(entry))
    .map((entry, index) => {
      const title = String(entry.l ?? "").trim();
      const mediaType: "movie" | "serial" = /tv|series/i.test(entry.q ?? "") ? "serial" : "movie";
      const year = parseYear(entry.y ?? entry.yr);
      const baseScore = scoreSearchCandidate(query, [title, year, entry.q], index);
      return {
        id: `imdb:${entry.id}`,
        title,
        originalTitle: null,
        mediaType,
        year,
        posterUrl: entry.i?.imageUrl ?? null,
        source: "imdb" as const,
        matchScore: baseScore + Math.max(0, 180 - index * 12),
      };
    });
}

async function searchTmdb(query: string): Promise<ExternalTitleCandidate[]> {
  const token = getTmdbReadToken();
  const apiKey = getTmdbApiKey();
  if (!token && !apiKey) {
    return [];
  }

  const cacheKey = normalizeSearchText(query);
  const cached = tmdbSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.results;
  }

  const url = new URL(`${TMDB_API_BASE}/search/multi`);
  url.searchParams.set("query", query);
  url.searchParams.set("include_adult", "false");
  url.searchParams.set("language", "cs-CZ");
  url.searchParams.set("page", "1");
  if (!token && apiKey) {
    url.searchParams.set("api_key", apiKey);
  }

  let payload = await fetchJson<{ results?: TmdbSearchResult[] }>(url.toString(), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!payload && token && apiKey) {
    url.searchParams.set("api_key", apiKey);
    payload = await fetchJson<{ results?: TmdbSearchResult[] }>(url.toString());
  }
  const results = Array.isArray(payload?.results) ? payload.results : [];

  const candidates = results
    .filter((entry) => entry.id && (entry.media_type === "movie" || entry.media_type === "tv"))
    .map((entry, index) => {
      const mediaType: "movie" | "serial" = entry.media_type === "tv" ? "serial" : "movie";
      const title = String(entry.title ?? entry.name ?? "").trim();
      const originalTitle = String(entry.original_title ?? entry.original_name ?? "").trim() || null;
      const year = parseYear(entry.release_date ?? entry.first_air_date);
      const popularityBoost = Math.min(120, Math.round(entry.popularity ?? 0));
      const baseScore = scoreSearchCandidate(query, [title, originalTitle, year], index);
      return {
        id: `tmdb:${entry.media_type}:${entry.id}`,
        title,
        originalTitle,
        mediaType,
        year,
        posterUrl: entry.poster_path ? `${TMDB_POSTER_BASE}${entry.poster_path}` : null,
        source: "tmdb" as const,
        matchScore: baseScore + 130 + popularityBoost,
        popularity: entry.popularity ?? null,
        voteCount: entry.vote_count ?? null,
        voteAverage: entry.vote_average ?? null,
        releaseDate: entry.release_date ?? entry.first_air_date ?? null,
        originalLanguage: entry.original_language ?? null,
      };
    })
    .filter((entry) => entry.title && scoreSearchCandidate(query, [entry.title, entry.originalTitle, entry.year]) > 0);

  tmdbSearchCache.set(cacheKey, {
    expiresAt: Date.now() + TMDB_SEARCH_CACHE_TTL_MS,
    results: candidates,
  });
  if (tmdbSearchCache.size > TMDB_SEARCH_CACHE_MAX) {
    const oldestKey = tmdbSearchCache.keys().next().value as string | undefined;
    if (oldestKey) {
      tmdbSearchCache.delete(oldestKey);
    }
  }

  return candidates;
}

async function searchTvMaze(query: string): Promise<ExternalTitleCandidate[]> {
  const payload = await fetchJson<TvMazeSearchResult[]>(
    `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`,
  );
  const results = Array.isArray(payload) ? payload : [];

  return results
    .filter((entry) => entry.show?.id && entry.show.name)
    .map((entry, index) => {
      const title = String(entry.show?.name ?? "").trim();
      const year = parseYear(entry.show?.premiered);
      const baseScore = scoreSearchCandidate(query, [title, year], index);
      return {
        id: `tvmaze:${entry.show?.id}`,
        title,
        originalTitle: null,
        mediaType: "serial" as const,
        year,
        posterUrl: entry.show?.image?.medium ?? entry.show?.image?.original ?? null,
        source: "tvmaze" as const,
        matchScore: baseScore + Math.round((entry.score ?? 0) * 120) + 80,
      };
    })
    .filter((entry) => scoreSearchCandidate(query, [entry.title, entry.year]) > 0);
}

export async function searchExternalTitles(query: string, limit = 12): Promise<ExternalTitleCandidate[]> {
  if (!normalizeSearchText(query)) {
    return [];
  }

  const settled = await Promise.allSettled([
    Promise.resolve(searchAliasCatalog(query)),
    searchWikidataFranchiseTitles(query),
    searchImdbSuggestions(query),
    searchTmdb(query),
    searchTvMaze(query),
  ]);
  const candidates = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const unique = new Map<string, ExternalTitleCandidate>();

  for (const candidate of candidates.sort(compareSearchScores)) {
    const key = [
      candidate.mediaType,
      normalizeSearchText(candidate.title),
      candidate.source === "wikidata" ? "" : candidate.year ?? "",
    ].join(":");
    const existing = unique.get(key);
    if (!existing || candidate.matchScore > existing.matchScore) {
      unique.set(key, candidate);
    }
  }

  return [...unique.values()]
    .sort(compareSearchScores)
    .slice(0, limit);
}

export async function searchTmdbTitleCandidates(query: string, limit = 12): Promise<ExternalTitleCandidate[]> {
  if (!normalizeSearchText(query)) {
    return [];
  }

  return (await searchTmdb(query))
    .sort(compareSearchScores)
    .slice(0, limit);
}
