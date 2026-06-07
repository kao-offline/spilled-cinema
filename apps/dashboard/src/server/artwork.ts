import { normalizeSearchText, scoreSearchCandidate } from "../lib/search-ranking.js";

type ArtworkBundle = {
  posterUrl?: string | null;
  backdropUrl?: string | null;
  clearLogoUrl?: string | null;
};

export type ArtworkAssetKind = "poster" | "backdrop" | "logo";
export type ArtworkAssetSource = "tmdb" | "fanart" | "tvdb" | "current";

export type ArtworkAsset = {
  url: string;
  kind: ArtworkAssetKind;
  source: ArtworkAssetSource;
  label: string;
  language?: string | null;
  width?: number | null;
  score?: number | null;
  hasText?: boolean | null;
};

export type PersonSearchSuggestion = {
  id: string;
  name: string;
  role: "actor" | "director" | "any";
  department?: string | null;
  knownFor: string[];
};

type ArtworkSourceSettings = {
  tmdb?: boolean;
  fanart?: boolean;
  tvdb?: boolean;
};

export type ArtworkApiKeys = {
  tmdbApiKey?: string;
  fanartApiKey?: string;
  tvdbApiKey?: string;
};

export type ArtworkExternalIds = {
  imdb?: string | number | null;
  tmdb?: string | number | null;
  tvdb?: string | number | null;
};

type TmdbImageConfig = {
  secure_base_url: string;
  poster_sizes: string[];
  backdrop_sizes: string[];
};

type TmdbSearchResult = {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  popularity?: number;
  vote_count?: number;
  known_for_department?: string;
  known_for?: Array<{
    title?: string;
    name?: string;
  }>;
};

type TmdbMovieCreditPerson = {
  name?: string;
  job?: string;
  known_for_department?: string;
  order?: number;
};

type TmdbMovieDetail = TmdbSearchResult & {
  genres?: Array<{ id?: number; name?: string }>;
  credits?: {
    cast?: TmdbMovieCreditPerson[];
    crew?: TmdbMovieCreditPerson[];
  };
};

type TmdbImageEntry = {
  file_path?: string | null;
  iso_639_1?: string | null;
  width?: number;
  height?: number;
};

type FanartEntry = {
  url?: string;
  lang?: string;
  likes?: string;
};

type FanartMoviePayload = {
  moviebanner?: FanartEntry[];
  moviethumb?: FanartEntry[];
  moviebackground?: FanartEntry[];
  movieposter?: FanartEntry[];
  hdmovielogo?: FanartEntry[];
  movielogo?: FanartEntry[];
};

type FanartTvPayload = {
  tvbanner?: FanartEntry[];
  showbackground?: FanartEntry[];
  tvthumb?: FanartEntry[];
  tvposter?: FanartEntry[];
  hdtvlogo?: FanartEntry[];
  clearlogo?: FanartEntry[];
};

type TvdbSearchResult = {
  id?: string | number;
  tvdb_id?: string | number;
  name?: string;
  aliases?: string[];
  overview?: string;
  image_url?: string | null;
  year?: string | null;
  primary_type?: string;
  type?: string;
};

type TvdbArtworkEntry = {
  image?: string | null;
  type?: number | null;
  includesText?: boolean | null;
  language?: string | null;
  score?: number | null;
  width?: number | null;
};

type TvdbExtendedRecord = {
  image?: string | null;
  artworks?: TvdbArtworkEntry[] | null;
};

type TmdbFindPayload = {
  movie_results?: TmdbSearchResult[];
  tv_results?: TmdbSearchResult[];
};

type TmdbExternalIdsPayload = {
  imdb_id?: string | null;
  tvdb_id?: number | null;
};

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TVDB_API_BASE = "https://api4.thetvdb.com/v4";
const DEFAULT_IMAGE_CONFIG: TmdbImageConfig = {
  secure_base_url: "https://image.tmdb.org/t/p/",
  poster_sizes: ["w342", "w500", "w780", "original"],
  backdrop_sizes: ["w780", "w1280", "original"],
};

let tmdbImageConfigPromise: Promise<TmdbImageConfig> | null = null;
let tvdbTokenPromise: Promise<string | null> | null = null;

function getTmdbReadToken() {
  return process.env.TMDB_API_READ_TOKEN?.trim().split(/\s+/)[0] || "";
}

function getTmdbApiKey(apiKeys?: ArtworkApiKeys) {
  return apiKeys?.tmdbApiKey?.trim() || process.env.TMDB_API_KEY?.trim() || "";
}

function getFanartApiKey(apiKeys?: ArtworkApiKeys) {
  return apiKeys?.fanartApiKey?.trim() || process.env.FANART_API_KEY?.trim() || "";
}

function getFanartClientKey() {
  return process.env.FANART_CLIENT_KEY?.trim() || "";
}

function getTvdbApiKey(apiKeys?: ArtworkApiKeys) {
  return apiKeys?.tvdbApiKey?.trim() || process.env.TVDB_API_KEY?.trim() || "";
}

function toAsciiSearchText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseYear(value: string | null | undefined) {
  const match = value?.match(/\b(19|20)\d{2}\b/);
  return match?.[0] ?? undefined;
}

function scoreYearHint(yearHint?: string, candidateYear?: string) {
  if (!yearHint || !candidateYear) {
    return 0;
  }

  if (yearHint === candidateYear) {
    return 240;
  }

  const yearDelta = Math.abs(Number.parseInt(yearHint, 10) - Number.parseInt(candidateYear, 10));
  if (!Number.isFinite(yearDelta)) {
    return 0;
  }

  if (yearDelta === 1) {
    return -120;
  }

  if (yearDelta === 2) {
    return -220;
  }

  return -360;
}

const ARTWORK_CONTEXT_STOP_WORDS = new Set([
  "about",
  "after",
  "against",
  "around",
  "based",
  "before",
  "being",
  "been",
  "during",
  "episode",
  "film",
  "find",
  "follows",
  "from",
  "group",
  "have",
  "into",
  "life",
  "lives",
  "movie",
  "must",
  "over",
  "season",
  "series",
  "show",
  "story",
  "than",
  "that",
  "their",
  "them",
  "there",
  "these",
  "they",
  "this",
  "those",
  "under",
  "video",
  "when",
  "where",
  "which",
  "while",
  "will",
  "with",
  "would",
  "years",
  "young",
]);

function extractArtworkContextKeywords(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  const tokens = toAsciiSearchText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length >= 4 && !ARTWORK_CONTEXT_STOP_WORDS.has(token));

  return Array.from(new Set(tokens)).slice(0, 12);
}

function scoreContextAgainstOverview(overview: string | null | undefined, description: string | null | undefined) {
  if (!overview || !description) {
    return 0;
  }

  const normalizedOverview = ` ${toAsciiSearchText(overview).toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const keywords = extractArtworkContextKeywords(description);
  if (keywords.length === 0) {
    return 0;
  }

  let score = 0;
  for (const keyword of keywords) {
    if (normalizedOverview.includes(` ${keyword} `)) {
      score += keyword.length >= 7 ? 48 : 34;
    } else if (normalizedOverview.includes(keyword)) {
      score += 14;
    }
  }

  return Math.min(score, 260);
}

function buildTmdbImageUrl(
  filePath: string | null | undefined,
  kind: "poster" | "backdrop",
  imageConfig: TmdbImageConfig,
) {
  if (!filePath) {
    return null;
  }

  const sizes = kind === "poster" ? imageConfig.poster_sizes : imageConfig.backdrop_sizes;
  const preferredSize =
    (kind === "poster" ? sizes.find((size) => size === "w500") : sizes.find((size) => size === "w1280")) ??
    sizes[sizes.length - 1] ??
    "original";

  return `${imageConfig.secure_base_url}${preferredSize}${filePath}`;
}

function buildTmdbOriginalImageUrl(filePath: string | null | undefined, imageConfig: TmdbImageConfig) {
  if (!filePath) {
    return null;
  }
  return `${imageConfig.secure_base_url}original${filePath}`;
}

function isSourceEnabled(sources: ArtworkSourceSettings | undefined, source: keyof ArtworkSourceSettings) {
  return sources?.[source] !== false;
}

async function fetchTmdbJson<T>(path: string, query?: Record<string, string | undefined>, apiKeys?: ArtworkApiKeys): Promise<T | null> {
  const token = getTmdbReadToken();
  const apiKey = getTmdbApiKey(apiKeys);
  if (!token && !apiKey) {
    return null;
  }

  const url = new URL(`${TMDB_API_BASE}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  if (!token && apiKey) {
    url.searchParams.set("api_key", apiKey);
  }

  let response = await fetch(url.toString(), {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: "application/json",
    },
  }).catch(() => null);

  if ((!response || !response.ok) && token && apiKey) {
    url.searchParams.set("api_key", apiKey);
    response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    }).catch(() => null);
  }

  if (!response?.ok) {
    return null;
  }

  return (await response.json()) as T;
}

async function getTmdbImageConfig(apiKeys?: ArtworkApiKeys) {
  if (apiKeys?.tmdbApiKey?.trim()) {
    const payload = await fetchTmdbJson<{ images?: TmdbImageConfig }>("/configuration", undefined, apiKeys);
    return payload?.images ?? DEFAULT_IMAGE_CONFIG;
  }

  tmdbImageConfigPromise ??= (async () => {
    const payload = await fetchTmdbJson<{ images?: TmdbImageConfig }>("/configuration");
    return payload?.images ?? DEFAULT_IMAGE_CONFIG;
  })();

  return tmdbImageConfigPromise;
}

function scoreTitleAgainstQueries(candidateTitles: string[], titles: string[], yearHint?: string, candidateYear?: string) {
  let bestScore = 0;

  for (const [queryIndex, query] of titles.entries()) {
    const queryText = (query ?? "").trim();
    if (!queryText) {
      continue;
    }

    const queryPenalty = queryIndex * 18;
    const score =
      scoreSearchCandidate(queryText, candidateTitles) +
      scoreYearHint(yearHint, candidateYear) -
      queryPenalty;
    bestScore = Math.max(bestScore, score);
  }

  return bestScore;
}

function getSearchTitleVariants(...values: Array<string | null | undefined>) {
  const variants = new Set<string>();
  for (const value of values) {
    const raw = (value ?? "").trim();
    if (!raw) continue;
    for (const variant of getArtworkTitleVariants(raw)) {
      variants.add(variant);
      const ascii = toAsciiSearchText(variant);
      if (ascii) {
        variants.add(ascii);
      }
    }
  }
  return Array.from(variants);
}

function stripArtworkNoise(value: string) {
  return value
    .replace(/\(\s*\)/g, " ")
    .replace(/\b(?:online|film|serial|sleduj|cz|sk|dabing|titulky)\b/gi, " ")
    .replace(/\b(19|20)\d{2}\s*(?:[-–]\s*(19|20)\d{2})?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getArtworkTitleVariants(value: string) {
  const cleaned = stripArtworkNoise(value);
  const variants = new Set<string>();
  if (cleaned) {
    variants.add(cleaned);
  }

  for (const separator of [":", " - ", " | "]) {
    if (!cleaned.includes(separator)) continue;
    const [left, ...rightParts] = cleaned.split(separator);
    const right = rightParts.join(separator).trim();
    if (left?.trim()) variants.add(left.trim());
    if (right) variants.add(right);
  }

  const tokens = normalizeSearchText(cleaned).split(" ").filter(Boolean);
  if (tokens.length >= 2 && tokens[0] === tokens[1]) {
    variants.add(tokens[0]);
  }

  return Array.from(variants).filter((variant) => normalizeSearchText(variant).length >= 2);
}

function isAmbiguousArtworkTitle(title: string, altTitle?: string | null) {
  const normalized = normalizeSearchText(title || altTitle || "");
  const compactLength = normalized.replace(/\s+/g, "").length;
  return compactLength <= 5 || /^\d+$/.test(normalized.replace(/\s+/g, ""));
}

function getEffectiveYearHint(title: string, altTitle?: string | null, yearHint?: string) {
  return yearHint ?? parseYear(title) ?? parseYear(altTitle);
}

type ArtworkLookupOptions = {
  mediaType: "movie" | "tv";
  title: string;
  altTitle?: string | null;
  yearHint?: string;
  description?: string | null;
  currentPosterUrl?: string | null;
  currentBackdropUrl?: string | null;
  currentClearLogoUrl?: string | null;
  externalIds?: ArtworkExternalIds;
  sources?: ArtworkSourceSettings;
  apiKeys?: ArtworkApiKeys;
};

const CANONICAL_ARTWORK_IDENTITIES: Array<{
  titles: string[];
  mediaType: "movie" | "tv";
  yearHint?: string;
  externalIds: ArtworkExternalIds;
}> = [
  {
    titles: ["apex"],
    mediaType: "movie",
    yearHint: "2026",
    externalIds: {
      tmdb: "1318447",
      tvdb: "358476",
    },
  },
];

function withCanonicalArtworkIdentity<T extends ArtworkLookupOptions>(options: T): T {
  const titleKeys = [options.title, options.altTitle ?? ""]
    .map(normalizeSearchText)
    .filter(Boolean);
  const canonical = CANONICAL_ARTWORK_IDENTITIES.find((identity) =>
    identity.titles.some((title) => titleKeys.includes(normalizeSearchText(title))),
  );

  if (!canonical) {
    return options;
  }

  return {
    ...options,
    mediaType: canonical.mediaType,
    yearHint: options.yearHint ?? canonical.yearHint,
    externalIds: {
      ...options.externalIds,
      ...canonical.externalIds,
    },
  };
}

function hasArtworkIdentitySignal(options: {
  title: string;
  altTitle?: string | null;
  yearHint?: string;
  description?: string | null;
  externalIds?: ArtworkExternalIds;
}) {
  return Boolean(
    getEffectiveYearHint(options.title, options.altTitle, options.yearHint) ||
      options.description?.trim() ||
      parseExternalNumericId(options.externalIds?.tmdb) ||
      parseExternalNumericId(options.externalIds?.tvdb) ||
      parseExternalStringId(options.externalIds?.imdb),
  );
}

function isUnsafeAmbiguousArtworkLookup(options: {
  title: string;
  altTitle?: string | null;
  yearHint?: string;
  description?: string | null;
  externalIds?: ArtworkExternalIds;
}) {
  return isAmbiguousArtworkTitle(options.title, options.altTitle) && !hasArtworkIdentitySignal(options);
}

function scoreTmdbCandidate(
  candidate: TmdbSearchResult,
  titles: string[],
  yearHint?: string,
  description?: string | null,
) {
  return scoreTitleAgainstQueries(
    [candidate.title ?? "", candidate.name ?? "", candidate.original_title ?? "", candidate.original_name ?? ""],
    titles,
    yearHint,
    parseYear(candidate.release_date ?? candidate.first_air_date),
  ) + scoreContextAgainstOverview(candidate.overview, description);
}

function getArtworkConfidenceThresholds(title: string, altTitle?: string | null) {
  const primary = normalizeSearchText(title || altTitle || "");
  const secondary = normalizeSearchText(altTitle || "");
  const tokenCount = primary.split(" ").filter(Boolean).length;
  const compactLength = primary.replace(/\s+/g, "").length;
  const hasDigits = /\d/.test(primary) || /\d/.test(secondary);
  const isShortOrAmbiguous = compactLength <= 8 || tokenCount <= 2 || hasDigits;

  return isShortOrAmbiguous
    ? { minimumScore: 980, minimumLead: 220 }
    : { minimumScore: 560, minimumLead: 90 };
}

async function searchTmdbBestMatch({
  mediaType,
  title,
  altTitle,
  yearHint,
  description,
  apiKeys,
}: {
  mediaType: "movie" | "tv";
  title: string;
  altTitle?: string | null;
  yearHint?: string;
  description?: string | null;
  apiKeys?: ArtworkApiKeys;
}) {
  const variants = getSearchTitleVariants(title, altTitle);
  const effectiveYearHint = getEffectiveYearHint(title, altTitle, yearHint);
  const rankedCandidates: Array<{ candidate: TmdbSearchResult; score: number }> = [];

  for (const variant of variants) {
    const payload = await fetchTmdbJson<{ results?: TmdbSearchResult[] }>(`/search/${mediaType}`, {
      query: variant,
      year: mediaType === "movie" ? effectiveYearHint : undefined,
      first_air_date_year: mediaType === "tv" ? effectiveYearHint : undefined,
      include_adult: "false",
    }, apiKeys);

    for (const [index, candidate] of (payload?.results ?? []).entries()) {
      let score = scoreTmdbCandidate(candidate, variants, effectiveYearHint, description);
      const candidateYear = parseYear(candidate.release_date ?? candidate.first_air_date);

      // TMDB site ordering is useful for localized titles where result payload titles are English-only.
      if (index === 0) score += 26;
      else if (index === 1) score += 12;
      if (effectiveYearHint && candidateYear === effectiveYearHint) {
        score += Math.max(0, 18 - index * 4);
      }

      rankedCandidates.push({ candidate, score });
    }
  }

  if (rankedCandidates.length === 0) {
    return null;
  }

  const ranked = rankedCandidates.sort((left, right) => right.score - left.score);

  const best = ranked[0];
  const runnerUp = ranked[1];
  const thresholds = getArtworkConfidenceThresholds(title, altTitle);
  if (!best) {
    return null;
  }
  if (isAmbiguousArtworkTitle(title, altTitle) && !effectiveYearHint && !description) {
    return null;
  }
  if (best.score < thresholds.minimumScore) {
    return null;
  }
  if (runnerUp && best.score - runnerUp.score < thresholds.minimumLead) {
    return null;
  }
  return best.candidate;
}

async function fetchTmdbImages(mediaType: "movie" | "tv", id: number, apiKeys?: ArtworkApiKeys) {
  return fetchTmdbJson<{
    backdrops?: TmdbImageEntry[];
    posters?: TmdbImageEntry[];
    logos?: TmdbImageEntry[];
  }>(`/${mediaType}/${id}/images`, undefined, apiKeys);
}

export async function fetchTmdbMovieMetadata(input: {
  title: string;
  altTitle?: string | null;
  yearHint?: string;
  description?: string | null;
}): Promise<{
  tmdbId: number;
  title: string;
  year: string | null;
  genres: string[];
  directors: string[];
  actors: string[];
} | null> {
  const match = await searchTmdbBestMatch({
    mediaType: "movie",
    title: input.title,
    altTitle: input.altTitle,
    yearHint: input.yearHint,
    description: input.description,
  });

  if (!match) {
    return null;
  }

  const detail = await fetchTmdbJson<TmdbMovieDetail>(`/movie/${match.id}`, {
    append_to_response: "credits",
  });

  if (!detail) {
    return null;
  }

  const directors = Array.from(
    new Set(
      (detail.credits?.crew ?? [])
        .filter((person) => person.job?.toLowerCase() === "director")
        .map((person) => person.name?.trim() ?? "")
        .filter(Boolean),
    ),
  ).slice(0, 5);

  const actors = Array.from(
    new Set(
      (detail.credits?.cast ?? [])
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
        .map((person) => person.name?.trim() ?? "")
        .filter(Boolean),
    ),
  ).slice(0, 8);

  return {
    tmdbId: detail.id,
    title: detail.title?.trim() || detail.original_title?.trim() || match.title?.trim() || input.title,
    year: parseYear(detail.release_date ?? match.release_date) ?? null,
    genres: Array.from(
      new Set((detail.genres ?? []).map((genre) => genre.name?.trim() ?? "").filter(Boolean)),
    ),
    directors,
    actors,
  };
}

export async function searchPeopleSuggestions(input: {
  query: string;
  role?: "actor" | "director" | "any";
  limit?: number;
}): Promise<PersonSearchSuggestion[]> {
  const query = input.query.trim();
  if (!query) {
    return [];
  }

  const payload = await fetchTmdbJson<{ results?: TmdbSearchResult[] }>("/search/person", {
    query,
    include_adult: "false",
  });

  const desiredRole = input.role ?? "any";
  const normalizedDesiredRole =
    desiredRole === "actor" ? "acting" : desiredRole === "director" ? "directing" : "";

  const suggestions = (payload?.results ?? [])
    .map((candidate) => {
      const department = (candidate.known_for_department ?? "").trim();
      const normalizedDepartment = department.toLowerCase();
      const knownFor = (candidate.known_for ?? [])
        .map((entry) => entry.title ?? entry.name ?? "")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .slice(0, 4);
      const role: PersonSearchSuggestion["role"] =
        normalizedDepartment === "acting"
          ? "actor"
          : normalizedDepartment === "directing"
            ? "director"
            : "any";

      let score =
        scoreSearchCandidate(query, [candidate.name ?? "", ...knownFor]) +
        (normalizedDepartment === normalizedDesiredRole ? 32 : desiredRole === "any" ? 0 : -8);

      if (knownFor.length > 0) {
        score += Math.min(knownFor.length * 4, 12);
      }

      return {
        id: `tmdb:${candidate.id}`,
        name: candidate.name?.trim() || "",
        role,
        department: department || null,
        knownFor,
        score,
      };
    })
    .filter((entry) => entry.name)
    .filter((entry) => desiredRole === "any" || entry.role === desiredRole || entry.department?.toLowerCase() === normalizedDesiredRole)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, input.limit ?? 8)
    .map(({ score: _score, ...entry }) => entry);

  return suggestions;
}

async function fetchFanartJson<T>(path: string, apiKeys?: ArtworkApiKeys): Promise<T | null> {
  const apiKey = getFanartApiKey(apiKeys);
  if (!apiKey) {
    return null;
  }

  const response = await fetch(`https://webservice.fanart.tv/v3${path}`, {
    headers: {
      "api-key": apiKey,
      ...(getFanartClientKey() ? { "client-key": getFanartClientKey() } : {}),
      Accept: "application/json",
    },
  }).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  return (await response.json()) as T;
}

async function getTvdbToken(apiKeys?: ArtworkApiKeys) {
  if (apiKeys?.tvdbApiKey?.trim()) {
    const response = await fetch(`${TVDB_API_BASE}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ apikey: apiKeys.tvdbApiKey.trim() }),
    }).catch(() => null);

    if (!response?.ok) {
      return null;
    }

    const payload = (await response.json()) as { data?: { token?: string } };
    return payload.data?.token ?? null;
  }

  tvdbTokenPromise ??= (async () => {
    const apiKey = getTvdbApiKey();
    if (!apiKey) {
      return null;
    }

    const response = await fetch(`${TVDB_API_BASE}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ apikey: apiKey }),
    }).catch(() => null);

    if (!response?.ok) {
      return null;
    }

    const payload = (await response.json()) as { data?: { token?: string } };
    return payload.data?.token ?? null;
  })();

  return tvdbTokenPromise;
}

async function fetchTvdbJson<T>(path: string, query?: Record<string, string | undefined>, apiKeys?: ArtworkApiKeys) {
  const token = await getTvdbToken(apiKeys);
  if (!token) {
    return null;
  }

  const url = new URL(`${TVDB_API_BASE}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  }).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  return (await response.json()) as T;
}

function pickPreferredImage(entries: TmdbImageEntry[] | undefined) {
  if (!entries || entries.length === 0) {
    return null;
  }

  return [...entries].sort((left, right) => {
    const leftLanguageScore = left.iso_639_1 === null ? 3 : left.iso_639_1 === "en" ? 2 : left.iso_639_1 === "cs" ? 1 : 0;
    const rightLanguageScore = right.iso_639_1 === null ? 3 : right.iso_639_1 === "en" ? 2 : right.iso_639_1 === "cs" ? 1 : 0;
    if (leftLanguageScore !== rightLanguageScore) {
      return rightLanguageScore - leftLanguageScore;
    }
    return (right.width ?? 0) - (left.width ?? 0);
  })[0];
}

function pickPreferredFanart(entries: FanartEntry[] | undefined) {
  if (!entries || entries.length === 0) {
    return null;
  }

  return [...entries].sort((left, right) => {
    const leftLanguageScore = left.lang === "" ? 3 : left.lang === "en" ? 2 : left.lang === "cs" ? 1 : 0;
    const rightLanguageScore = right.lang === "" ? 3 : right.lang === "en" ? 2 : right.lang === "cs" ? 1 : 0;
    if (leftLanguageScore !== rightLanguageScore) {
      return rightLanguageScore - leftLanguageScore;
    }
    return Number(right.likes ?? 0) - Number(left.likes ?? 0);
  })[0];
}

function sortFanartEntries(entries: FanartEntry[] | undefined) {
  if (!entries || entries.length === 0) {
    return [];
  }

  return [...entries].sort((left, right) => {
    const leftLanguageScore = left.lang === "" ? 3 : left.lang === "en" ? 2 : left.lang === "cs" ? 1 : 0;
    const rightLanguageScore = right.lang === "" ? 3 : right.lang === "en" ? 2 : right.lang === "cs" ? 1 : 0;
    if (leftLanguageScore !== rightLanguageScore) {
      return rightLanguageScore - leftLanguageScore;
    }
    return Number(right.likes ?? 0) - Number(left.likes ?? 0);
  });
}

function parseTvdbNumericId(candidate: TvdbSearchResult) {
  const raw = candidate.tvdb_id ?? candidate.id;
  if (typeof raw === "number") {
    return raw;
  }
  if (typeof raw === "string") {
    const match = raw.match(/(\d+)$/);
    return match ? Number.parseInt(match[1], 10) : Number.parseInt(raw, 10);
  }
  return Number.NaN;
}

function parseExternalNumericId(value: string | number | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const match = value.trim().match(/(\d+)$/);
  if (!match) {
    return null;
  }
  const id = Number.parseInt(match[1], 10);
  return Number.isFinite(id) ? id : null;
}

function parseExternalStringId(value: string | number | null | undefined) {
  if (typeof value === "number") {
    return String(value);
  }
  const text = value?.trim();
  return text || null;
}

async function fetchTmdbDetail(mediaType: "movie" | "tv", id: number, apiKeys?: ArtworkApiKeys) {
  return fetchTmdbJson<TmdbSearchResult>(`/${mediaType}/${id}`, undefined, apiKeys);
}

async function findTmdbByExternalId(options: {
  mediaType: "movie" | "tv";
  externalId: string | number | null | undefined;
  externalSource: "imdb_id" | "tvdb_id";
  apiKeys?: ArtworkApiKeys;
}) {
  const externalId = parseExternalStringId(options.externalId);
  if (!externalId) {
    return null;
  }
  const payload = await fetchTmdbJson<TmdbFindPayload>(`/find/${encodeURIComponent(externalId)}`, {
    external_source: options.externalSource,
  }, options.apiKeys);
  const results = options.mediaType === "movie" ? payload?.movie_results : payload?.tv_results;
  return results?.[0] ?? null;
}

async function resolveTmdbMatch(options: {
  mediaType: "movie" | "tv";
  title: string;
  altTitle?: string | null;
  yearHint?: string;
  description?: string | null;
  externalIds?: ArtworkExternalIds;
  apiKeys?: ArtworkApiKeys;
}) {
  const tmdbId = parseExternalNumericId(options.externalIds?.tmdb);
  if (tmdbId) {
    const detail = await fetchTmdbDetail(options.mediaType, tmdbId, options.apiKeys);
    if (detail?.id) {
      return detail;
    }
    return { id: tmdbId } satisfies TmdbSearchResult;
  }

  const tvdbMatch = options.mediaType === "tv"
    ? await findTmdbByExternalId({
        mediaType: options.mediaType,
        externalId: options.externalIds?.tvdb,
        externalSource: "tvdb_id",
        apiKeys: options.apiKeys,
      })
    : null;
  if (tvdbMatch) {
    return tvdbMatch;
  }

  const imdbMatch = await findTmdbByExternalId({
    mediaType: options.mediaType,
    externalId: options.externalIds?.imdb,
    externalSource: "imdb_id",
    apiKeys: options.apiKeys,
  });
  if (imdbMatch) {
    return imdbMatch;
  }

  return searchTmdbBestMatch({
    mediaType: options.mediaType,
    title: options.title,
    altTitle: options.altTitle,
    yearHint: options.yearHint,
    description: options.description,
    apiKeys: options.apiKeys,
  });
}

async function fetchTmdbExternalIds(mediaType: "movie" | "tv", tmdbId: number, apiKeys?: ArtworkApiKeys) {
  return fetchTmdbJson<TmdbExternalIdsPayload>(`/${mediaType}/${tmdbId}/external_ids`, undefined, apiKeys);
}

async function resolveTvdbId(options: {
  mediaType: "movie" | "tv";
  tmdbMatch?: TmdbSearchResult | null;
  externalIds?: ArtworkExternalIds;
  apiKeys?: ArtworkApiKeys;
}) {
  const directTvdbId = parseExternalNumericId(options.externalIds?.tvdb);
  if (directTvdbId) {
    return directTvdbId;
  }
  if (options.mediaType !== "tv" || !options.tmdbMatch?.id) {
    return null;
  }
  const externalIds = await fetchTmdbExternalIds(options.mediaType, options.tmdbMatch.id, options.apiKeys);
  return externalIds?.tvdb_id ?? null;
}

async function searchTvdbBestMatch({
  mediaType,
  title,
  altTitle,
  yearHint,
  description,
  apiKeys,
}: {
  mediaType: "movie" | "tv";
  title: string;
  altTitle?: string | null;
  yearHint?: string;
  description?: string | null;
  apiKeys?: ArtworkApiKeys;
}) {
  const variants = getSearchTitleVariants(title, altTitle);
  const effectiveYearHint = getEffectiveYearHint(title, altTitle, yearHint);
  const rankedCandidates: Array<{ candidate: TvdbSearchResult; score: number }> = [];

  for (const variant of variants) {
    const payload = await fetchTvdbJson<{ data?: TvdbSearchResult[] }>("/search", {
      query: variant,
      type: mediaType === "movie" ? "movie" : "series",
    }, apiKeys);

    const candidates = (payload?.data ?? []).filter((candidate) => Number.isFinite(parseTvdbNumericId(candidate)));
    for (const [index, candidate] of candidates.entries()) {
      let score = scoreTitleAgainstQueries(
        [candidate.name ?? "", ...(candidate.aliases ?? [])],
        variants,
        effectiveYearHint,
        parseYear(candidate.year),
      );
      score += scoreContextAgainstOverview(candidate.overview, description);

      if (index === 0) score += 24;
      else if (index === 1) score += 10;
      if (effectiveYearHint && parseYear(candidate.year) === effectiveYearHint) {
        score += Math.max(0, 16 - index * 4);
      }

      rankedCandidates.push({ candidate, score });
    }
  }

  if (rankedCandidates.length === 0) {
    return null;
  }

  const ranked = rankedCandidates.sort((left, right) => right.score - left.score);

  const best = ranked[0];
  const runnerUp = ranked[1];
  const thresholds = getArtworkConfidenceThresholds(title, altTitle);
  if (!best) {
    return null;
  }
  if (best.score < thresholds.minimumScore) {
    return null;
  }
  if (runnerUp && best.score - runnerUp.score < thresholds.minimumLead) {
    return null;
  }
  if (
    isAmbiguousArtworkTitle(title, altTitle) &&
    !effectiveYearHint &&
    !description
  ) {
    return null;
  }
  return best.candidate;
}

async function fetchTvdbExtended(mediaType: "movie" | "tv", id: number, apiKeys?: ArtworkApiKeys) {
  const path = mediaType === "movie" ? `/movies/${id}/extended` : `/series/${id}/extended`;
  const payload = await fetchTvdbJson<{ data?: TvdbExtendedRecord }>(path, undefined, apiKeys);
  return payload?.data ?? null;
}

function pickPreferredTvdbArtwork(entries: TvdbArtworkEntry[], matcher: (entry: TvdbArtworkEntry) => boolean) {
  const matches = entries.filter(matcher);
  if (matches.length === 0) {
    return null;
  }

  return [...matches].sort((left, right) => {
    const leftLanguageScore = left.language === null ? 3 : left.language === "eng" ? 2 : left.language === "ces" ? 1 : 0;
    const rightLanguageScore = right.language === null ? 3 : right.language === "eng" ? 2 : right.language === "ces" ? 1 : 0;
    if (leftLanguageScore !== rightLanguageScore) {
      return rightLanguageScore - leftLanguageScore;
    }
    return (right.score ?? 0) - (left.score ?? 0);
  })[0];
}

function sortTvdbArtwork(entries: TvdbArtworkEntry[], matcher: (entry: TvdbArtworkEntry) => boolean) {
  return [...entries.filter(matcher)].sort((left, right) => {
    const leftLanguageScore = left.language === null ? 3 : left.language === "eng" ? 2 : left.language === "ces" ? 1 : 0;
    const rightLanguageScore = right.language === null ? 3 : right.language === "eng" ? 2 : right.language === "ces" ? 1 : 0;
    if (leftLanguageScore !== rightLanguageScore) {
      return rightLanguageScore - leftLanguageScore;
    }
    return (right.score ?? 0) - (left.score ?? 0);
  });
}

async function fetchFanartBundle(options: {
  mediaType: "movie" | "tv";
  tmdbId?: number | null;
  tvdbId?: number | null;
  apiKeys?: ArtworkApiKeys;
}): Promise<ArtworkBundle> {
  if (options.mediaType === "movie") {
    if (!options.tmdbId) {
      return {};
    }

    const payload = await fetchFanartJson<FanartMoviePayload>(`/movies/${options.tmdbId}`, options.apiKeys);
    if (!payload) {
      return {};
    }

    const poster = pickPreferredFanart(payload.movieposter);
    const backdrop =
      pickPreferredFanart(payload.moviethumb) ??
      pickPreferredFanart(payload.moviebackground) ??
      pickPreferredFanart(payload.moviebanner);
    const clearLogo = pickPreferredFanart(payload.hdmovielogo) ?? pickPreferredFanart(payload.movielogo);

    return {
      posterUrl: poster?.url ?? null,
      backdropUrl: backdrop?.url ?? null,
      clearLogoUrl: clearLogo?.url ?? null,
    };
  }

  if (!options.tvdbId) {
    return {};
  }

  const payload = await fetchFanartJson<FanartTvPayload>(`/tv/${options.tvdbId}`, options.apiKeys);
  if (!payload) {
    return {};
  }

  const poster = pickPreferredFanart(payload.tvposter);
  const backdrop =
    pickPreferredFanart(payload.showbackground) ??
    pickPreferredFanart(payload.tvthumb) ??
    pickPreferredFanart(payload.tvbanner);
  const clearLogo = pickPreferredFanart(payload.hdtvlogo) ?? pickPreferredFanart(payload.clearlogo);

  return {
    posterUrl: poster?.url ?? null,
    backdropUrl: backdrop?.url ?? null,
    clearLogoUrl: clearLogo?.url ?? null,
  };
}

function pickTvdbBundle(mediaType: "movie" | "tv", extended: TvdbExtendedRecord | null): ArtworkBundle {
  const artworks = extended?.artworks ?? [];
  if (!extended && artworks.length === 0) {
    return {};
  }

  if (mediaType === "movie") {
    const poster = pickPreferredTvdbArtwork(artworks, (entry) => entry.type === 14 || entry.image?.includes("/posters/") === true);
    const backdrop = pickPreferredTvdbArtwork(
      artworks,
      (entry) => entry.type === 15 || entry.image?.includes("/backgrounds/") === true,
    );
    const clearLogo = pickPreferredTvdbArtwork(
      artworks,
      (entry) => entry.type === 25 || entry.image?.includes("/clearlogo/") === true,
    );

    return {
      posterUrl: poster?.image ?? extended?.image ?? null,
      backdropUrl: backdrop?.image ?? null,
      clearLogoUrl: clearLogo?.image ?? null,
    };
  }

  const poster = pickPreferredTvdbArtwork(artworks, (entry) => entry.type === 2 || entry.image?.includes("/posters/") === true);
  const backdrop = pickPreferredTvdbArtwork(
    artworks,
    (entry) => entry.type === 3 || entry.image?.includes("/fanart/") === true || entry.image?.includes("/backgrounds/") === true,
  );
  const clearLogo = pickPreferredTvdbArtwork(
    artworks,
    (entry) => entry.type === 23 || entry.image?.includes("/clearlogo/") === true,
  );

  return {
    posterUrl: poster?.image ?? extended?.image ?? null,
    backdropUrl: backdrop?.image ?? null,
    clearLogoUrl: clearLogo?.image ?? null,
  };
}

function dedupeArtworkAssets(assets: ArtworkAsset[]) {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    const key = `${asset.kind}:${asset.url}`;
    if (!asset.url || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function sortArtworkAssets(assets: ArtworkAsset[]) {
  return [...assets].sort((left, right) => {
    const leftLanguageScore = left.language === null || left.language === undefined || left.language === "" ? 3 : /^(en|eng)$/i.test(left.language) ? 2 : /^(cs|ces)$/i.test(left.language) ? 1 : 0;
    const rightLanguageScore = right.language === null || right.language === undefined || right.language === "" ? 3 : /^(en|eng)$/i.test(right.language) ? 2 : /^(cs|ces)$/i.test(right.language) ? 1 : 0;
    if (leftLanguageScore !== rightLanguageScore) {
      return rightLanguageScore - leftLanguageScore;
    }
    return (right.score ?? 0) - (left.score ?? 0);
  });
}

function buildCurrentArtworkAssets(options: {
  currentPosterUrl?: string | null;
  currentBackdropUrl?: string | null;
  currentClearLogoUrl?: string | null;
}) {
  const assets: ArtworkAsset[] = [];
  if (options.currentPosterUrl) {
    assets.push({
      url: options.currentPosterUrl,
      kind: "poster",
      source: "current",
      label: "Current Poster",
      language: null,
      score: 1,
      hasText: null,
    });
  }
  if (options.currentBackdropUrl) {
    assets.push({
      url: options.currentBackdropUrl,
      kind: "backdrop",
      source: "current",
      label: "Current Backdrop",
      language: null,
      score: 1,
      hasText: null,
    });
  }
  if (options.currentClearLogoUrl) {
    assets.push({
      url: options.currentClearLogoUrl,
      kind: "logo",
      source: "current",
      label: "Current Logo",
      language: null,
      score: 1,
      hasText: true,
    });
  }
  return dedupeArtworkAssets(assets);
}

export async function searchArtworkAssets(input: ArtworkLookupOptions) {
  const options = withCanonicalArtworkIdentity(input);
  if (isUnsafeAmbiguousArtworkLookup(options)) {
    return buildCurrentArtworkAssets(options);
  }

  const primaryAssets = await searchArtworkAssetsForMedia(options);
  const primaryExternalCount = countExternalArtworkAssets(primaryAssets);
  if (primaryExternalCount > 2) {
    return primaryAssets;
  }

  const alternateMediaType = options.mediaType === "movie" ? "tv" : "movie";
  const alternateAssets = await searchArtworkAssetsForMedia({
    ...options,
    mediaType: alternateMediaType,
  });
  const alternateExternalCount = countExternalArtworkAssets(alternateAssets);

  if (alternateExternalCount >= primaryExternalCount + 8) {
    return dedupeArtworkAssets([...alternateAssets, ...primaryAssets]);
  }

  return primaryAssets;
}

function countExternalArtworkAssets(assets: ArtworkAsset[]) {
  return assets.filter((asset) => asset.source !== "current").length;
}

async function searchArtworkAssetsForMedia(options: ArtworkLookupOptions) {
  const fallbackAssets = buildCurrentArtworkAssets(options);

  const hasAnyConfiguredProvider =
    (isSourceEnabled(options.sources, "tmdb") && Boolean(getTmdbReadToken())) ||
    (isSourceEnabled(options.sources, "tmdb") && Boolean(getTmdbApiKey(options.apiKeys))) ||
    (isSourceEnabled(options.sources, "fanart") && Boolean(getFanartApiKey(options.apiKeys))) ||
    (isSourceEnabled(options.sources, "tvdb") && Boolean(getTvdbApiKey(options.apiKeys)));

  if (!hasAnyConfiguredProvider) {
    return fallbackAssets;
  }

  const tmdbEnabled = isSourceEnabled(options.sources, "tmdb");
  const fanartEnabled = isSourceEnabled(options.sources, "fanart");
  const tvdbEnabled = isSourceEnabled(options.sources, "tvdb");

  const needsTmdb = tmdbEnabled || (fanartEnabled && options.mediaType === "movie");
  const needsTvdb = tvdbEnabled || (fanartEnabled && options.mediaType === "tv");
  const directTvdbId = parseExternalNumericId(options.externalIds?.tvdb);

  const [tmdbMatch, searchedTvdbMatch] = await Promise.all([
    needsTmdb
      ? resolveTmdbMatch({
          mediaType: options.mediaType,
          title: options.title,
          altTitle: options.altTitle,
          yearHint: options.yearHint,
          description: options.description,
          externalIds: options.externalIds,
          apiKeys: options.apiKeys,
        })
      : Promise.resolve(null),
    needsTvdb && !directTvdbId
      ? searchTvdbBestMatch({
          mediaType: options.mediaType,
          title: options.title,
          altTitle: options.altTitle,
          yearHint: options.yearHint,
          description: options.description,
          apiKeys: options.apiKeys,
        })
      : Promise.resolve(null),
  ]);
  const tvdbId = directTvdbId ?? (searchedTvdbMatch ? parseTvdbNumericId(searchedTvdbMatch) : null) ?? await resolveTvdbId({
    mediaType: options.mediaType,
    tmdbMatch,
    externalIds: options.externalIds,
    apiKeys: options.apiKeys,
  });

  const [tmdbImages, imageConfig, fanartMoviePayload, fanartTvPayload, tvdbExtended] = await Promise.all([
    tmdbEnabled && tmdbMatch ? fetchTmdbImages(options.mediaType, tmdbMatch.id, options.apiKeys) : Promise.resolve(null),
    tmdbEnabled && tmdbMatch ? getTmdbImageConfig(options.apiKeys) : Promise.resolve(DEFAULT_IMAGE_CONFIG),
    fanartEnabled && options.mediaType === "movie" && tmdbMatch ? fetchFanartJson<FanartMoviePayload>(`/movies/${tmdbMatch.id}`, options.apiKeys) : Promise.resolve(null),
    fanartEnabled && options.mediaType === "tv" && tvdbId ? fetchFanartJson<FanartTvPayload>(`/tv/${tvdbId}`, options.apiKeys) : Promise.resolve(null),
    tvdbEnabled && tvdbId ? fetchTvdbExtended(options.mediaType, tvdbId, options.apiKeys) : Promise.resolve(null),
  ]);

  const assets: ArtworkAsset[] = [];

  if (tmdbEnabled && tmdbImages) {
    const tmdbPosterAssets: ArtworkAsset[] = [];
    for (const poster of tmdbImages.posters ?? []) {
      const url = buildTmdbOriginalImageUrl(poster.file_path, imageConfig);
      if (!url) continue;
      tmdbPosterAssets.push({
        url,
        kind: "poster",
        source: "tmdb",
        label: "TMDB Poster HD",
        language: poster.iso_639_1 ?? null,
        width: poster.width ?? null,
        score: poster.width ?? 0,
        hasText: poster.iso_639_1 !== null,
      });
    }
    for (const entry of sortArtworkAssets(tmdbPosterAssets)) {
      assets.push(entry);
    }

    const tmdbBackdropAssets: ArtworkAsset[] = [];
    for (const backdrop of tmdbImages.backdrops ?? []) {
      const url = buildTmdbOriginalImageUrl(backdrop.file_path, imageConfig);
      if (!url) continue;
      tmdbBackdropAssets.push({
        url,
        kind: "backdrop",
        source: "tmdb",
        label: "TMDB Backdrop HD",
        language: backdrop.iso_639_1 ?? null,
        width: backdrop.width ?? null,
        score: backdrop.width ?? 0,
        hasText: backdrop.iso_639_1 !== null,
      });
    }
    for (const entry of sortArtworkAssets(tmdbBackdropAssets)) {
      assets.push(entry);
    }

    const tmdbLogoAssets: ArtworkAsset[] = [];
    for (const logo of tmdbImages.logos ?? []) {
      const url = logo.file_path ? `${imageConfig.secure_base_url}original${logo.file_path}` : null;
      if (!url) continue;
      tmdbLogoAssets.push({
        url,
        kind: "logo",
        source: "tmdb",
        label: "TMDB Logo",
        language: logo.iso_639_1 ?? null,
        width: logo.width ?? null,
        score: logo.width ?? 0,
        hasText: true,
      });
    }
    for (const entry of sortArtworkAssets(tmdbLogoAssets)) {
      assets.push(entry);
    }
  }

  if (fanartEnabled && fanartMoviePayload) {
    for (const entry of sortFanartEntries(fanartMoviePayload.movieposter)) {
      if (!entry.url) continue;
      assets.push({ url: entry.url, kind: "poster", source: "fanart", label: "Fanart Poster", language: entry.lang ?? null, score: Number(entry.likes ?? 0), hasText: entry.lang !== "" });
    }
    for (const entry of sortFanartEntries([...(fanartMoviePayload.moviethumb ?? []), ...(fanartMoviePayload.moviebackground ?? []), ...(fanartMoviePayload.moviebanner ?? [])])) {
      if (!entry.url) continue;
      assets.push({ url: entry.url, kind: "backdrop", source: "fanart", label: "Fanart Backdrop", language: entry.lang ?? null, score: Number(entry.likes ?? 0), hasText: entry.lang !== "" });
    }
    for (const entry of sortFanartEntries([...(fanartMoviePayload.hdmovielogo ?? []), ...(fanartMoviePayload.movielogo ?? [])])) {
      if (!entry.url) continue;
      assets.push({ url: entry.url, kind: "logo", source: "fanart", label: "Fanart HD Logo", language: entry.lang ?? null, score: Number(entry.likes ?? 0), hasText: true });
    }
  }

  if (fanartEnabled && fanartTvPayload) {
    for (const entry of sortFanartEntries(fanartTvPayload.tvposter)) {
      if (!entry.url) continue;
      assets.push({ url: entry.url, kind: "poster", source: "fanart", label: "Fanart Poster", language: entry.lang ?? null, score: Number(entry.likes ?? 0), hasText: entry.lang !== "" });
    }
    for (const entry of sortFanartEntries([...(fanartTvPayload.showbackground ?? []), ...(fanartTvPayload.tvthumb ?? []), ...(fanartTvPayload.tvbanner ?? [])])) {
      if (!entry.url) continue;
      assets.push({ url: entry.url, kind: "backdrop", source: "fanart", label: "Fanart Panel", language: entry.lang ?? null, score: Number(entry.likes ?? 0), hasText: entry.lang !== "" });
    }
    for (const entry of sortFanartEntries([...(fanartTvPayload.hdtvlogo ?? []), ...(fanartTvPayload.clearlogo ?? [])])) {
      if (!entry.url) continue;
      assets.push({ url: entry.url, kind: "logo", source: "fanart", label: "Fanart HD Logo", language: entry.lang ?? null, score: Number(entry.likes ?? 0), hasText: true });
    }
  }

  if (tvdbEnabled && tvdbExtended?.artworks) {
    for (const entry of sortTvdbArtwork(tvdbExtended.artworks, (art) => options.mediaType === "movie" ? art.type === 14 || art.image?.includes("/posters/") === true : art.type === 2 || art.image?.includes("/posters/") === true)) {
      if (!entry.image) continue;
      assets.push({ url: entry.image, kind: "poster", source: "tvdb", label: "TVDB Poster", language: entry.language ?? null, width: entry.width ?? null, score: entry.score ?? 0, hasText: entry.includesText ?? null });
    }
    for (const entry of sortTvdbArtwork(tvdbExtended.artworks, (art) => options.mediaType === "movie" ? art.type === 15 || art.image?.includes("/backgrounds/") === true : art.type === 3 || art.image?.includes("/fanart/") === true || art.image?.includes("/backgrounds/") === true)) {
      if (!entry.image) continue;
      assets.push({ url: entry.image, kind: "backdrop", source: "tvdb", label: "TVDB Panel", language: entry.language ?? null, width: entry.width ?? null, score: entry.score ?? 0, hasText: entry.includesText ?? null });
    }
    for (const entry of sortTvdbArtwork(tvdbExtended.artworks, (art) => options.mediaType === "movie" ? art.type === 25 || art.image?.includes("/clearlogo/") === true : art.type === 23 || art.image?.includes("/clearlogo/") === true)) {
      if (!entry.image) continue;
      assets.push({ url: entry.image, kind: "logo", source: "tvdb", label: "TVDB HD Logo", language: entry.language ?? null, width: entry.width ?? null, score: entry.score ?? 0, hasText: true });
    }
  }

  return dedupeArtworkAssets([...fallbackAssets, ...assets]);
}

export async function enrichArtwork(input: ArtworkLookupOptions): Promise<ArtworkBundle> {
  const options = withCanonicalArtworkIdentity(input);
  if (isUnsafeAmbiguousArtworkLookup(options)) {
    return {
      posterUrl: options.currentPosterUrl ?? null,
      backdropUrl: options.currentBackdropUrl ?? null,
      clearLogoUrl: options.currentClearLogoUrl ?? null,
    };
  }

  const tmdbEnabled = isSourceEnabled(options.sources, "tmdb");
  const fanartEnabled = isSourceEnabled(options.sources, "fanart");
  const tvdbEnabled = isSourceEnabled(options.sources, "tvdb");

  if (!tmdbEnabled && !fanartEnabled && !tvdbEnabled) {
    return {
      posterUrl: options.currentPosterUrl ?? null,
      backdropUrl: options.currentBackdropUrl ?? null,
      clearLogoUrl: options.currentClearLogoUrl ?? null,
    };
  }

  const needsTmdb = tmdbEnabled || (fanartEnabled && options.mediaType === "movie");
  const needsTvdb = tvdbEnabled || (fanartEnabled && options.mediaType === "tv");
  const directTvdbId = parseExternalNumericId(options.externalIds?.tvdb);

  const [tmdbMatch, searchedTvdbMatch] = await Promise.all([
    needsTmdb
      ? resolveTmdbMatch({
          mediaType: options.mediaType,
          title: options.title,
          altTitle: options.altTitle,
          yearHint: options.yearHint,
          description: options.description,
          externalIds: options.externalIds,
          apiKeys: options.apiKeys,
        })
      : Promise.resolve(null),
    needsTvdb && !directTvdbId
      ? searchTvdbBestMatch({
          mediaType: options.mediaType,
          title: options.title,
          altTitle: options.altTitle,
          yearHint: options.yearHint,
          description: options.description,
          apiKeys: options.apiKeys,
        })
      : Promise.resolve(null),
  ]);
  const tvdbId = directTvdbId ?? (searchedTvdbMatch ? parseTvdbNumericId(searchedTvdbMatch) : null) ?? await resolveTvdbId({
    mediaType: options.mediaType,
    tmdbMatch,
    externalIds: options.externalIds,
    apiKeys: options.apiKeys,
  });

  const [tmdbBundle, tvdbBundle, fanartBundle] = await Promise.all([
    tmdbEnabled && tmdbMatch
      ? (async () => {
          const [imageConfig, images] = await Promise.all([
            getTmdbImageConfig(options.apiKeys),
            fetchTmdbImages(options.mediaType, tmdbMatch.id, options.apiKeys),
          ]);
          const poster = pickPreferredImage(images?.posters);
          const backdrop = pickPreferredImage(images?.backdrops);
          const clearLogo = pickPreferredImage(images?.logos);

          return {
            posterUrl:
              buildTmdbImageUrl(tmdbMatch.poster_path ?? poster?.file_path, "poster", imageConfig) ??
              options.currentPosterUrl ??
              null,
            backdropUrl:
              buildTmdbImageUrl(backdrop?.file_path ?? tmdbMatch.backdrop_path, "backdrop", imageConfig) ??
              null,
            clearLogoUrl: clearLogo?.file_path
              ? `${imageConfig.secure_base_url}original${clearLogo.file_path}`
              : null,
          } satisfies ArtworkBundle;
        })()
      : Promise.resolve<ArtworkBundle>({}),
    tvdbEnabled && tvdbId
      ? fetchTvdbExtended(options.mediaType, tvdbId, options.apiKeys).then((extended) => pickTvdbBundle(options.mediaType, extended))
      : Promise.resolve<ArtworkBundle>({}),
    fanartEnabled
      ? fetchFanartBundle({
          mediaType: options.mediaType,
          tmdbId: tmdbMatch?.id ?? null,
          tvdbId,
          apiKeys: options.apiKeys,
        })
      : Promise.resolve<ArtworkBundle>({}),
  ]);

  return {
    posterUrl:
      tmdbBundle.posterUrl ??
      tvdbBundle.posterUrl ??
      fanartBundle.posterUrl ??
      options.currentPosterUrl ??
      null,
    backdropUrl:
      tmdbBundle.backdropUrl ??
      tvdbBundle.backdropUrl ??
      fanartBundle.backdropUrl ??
      options.currentBackdropUrl ??
      null,
    clearLogoUrl:
      fanartBundle.clearLogoUrl ??
      tvdbBundle.clearLogoUrl ??
      tmdbBundle.clearLogoUrl ??
      options.currentClearLogoUrl ??
      null,
  };
}
