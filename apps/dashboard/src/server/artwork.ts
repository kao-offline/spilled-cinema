import { normalizeSearchText, scoreSearchCandidate } from "../lib/search-ranking.js";
import { searchExternalTitles } from "./external-title-search.js";
import { Buffer } from "node:buffer";

type ArtworkBundle = {
  posterUrl?: string | null;
  backdropUrl?: string | null;
  bannerUrl?: string | null;
  clearLogoUrl?: string | null;
  bannerWithLogoUrl?: string | null;
};

export type ArtworkAssetKind = "poster" | "banner" | "logo" | "wlogo-banner";
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

function hasArtworkLanguage(language: string | null | undefined) {
  const normalized = language?.trim().toLowerCase();
  return Boolean(normalized && normalized !== "00" && normalized !== "und" && normalized !== "unknown");
}

export function classifyWideArtworkKind(
  hasText: boolean | null | undefined,
  language: string | null | undefined,
): Extract<ArtworkAssetKind, "banner" | "wlogo-banner"> {
  return hasText === true || hasArtworkLanguage(language) ? "wlogo-banner" : "banner";
}

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
  vote_average?: number;
  known_for_department?: string;
  known_for?: Array<{
    title?: string;
    name?: string;
  }>;
};

type TmdbPersonCredit = TmdbSearchResult & {
  media_type?: "movie" | "tv" | "person";
  character?: string;
  episode_count?: number;
  vote_count?: number;
  popularity?: number;
};

type TmdbMovieCreditPerson = {
  name?: string;
  character?: string;
  profile_path?: string | null;
  job?: string;
  known_for_department?: string;
  order?: number;
};

type TmdbMovieDetail = TmdbSearchResult & {
  runtime?: number | null;
  episode_run_time?: number[];
  number_of_seasons?: number;
  number_of_episodes?: number;
  genres?: Array<{ id?: number; name?: string }>;
  credits?: {
    cast?: TmdbMovieCreditPerson[];
    crew?: TmdbMovieCreditPerson[];
  };
};

export type ArtworkTitleMetadata = {
  title: string;
  description: string | null;
  year: string | null;
  runtimeMinutes: number | null;
  seasonCount: number | null;
  episodeCount: number | null;
  genres: string[];
  ratingPercent: number | null;
  episodeTitle: string | null;
  episodeDescription: string | null;
  episodeRuntimeMinutes: number | null;
  episodeYear: string | null;
};

type TmdbTvAggregateCreditPerson = {
  name?: string;
  profile_path?: string | null;
  roles?: Array<{ character?: string; episode_count?: number }>;
  order?: number;
  total_episode_count?: number;
};

export type ArtworkCastMember = {
  name: string;
  role?: string | null;
  profileUrl?: string | null;
};

export type ArtworkPersonCredit = {
  id: string;
  tmdbId: number;
  title: string;
  mediaType: "movie" | "serial";
  role?: string | null;
  year?: string | null;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  description?: string | null;
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
const HOMEPAGE_BANNER_WIDTH = 1280;
const HOMEPAGE_BANNER_HEIGHT = 560;

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

function escapeSvgText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function fetchArtworkImageBuffer(url: string) {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Artwork image URL must use HTTP or HTTPS.");
  }

  const response = await fetch(url, {
    headers: {
      Accept: "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8",
      "User-Agent": "SpilledCinema/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch artwork image (${response.status}).`);
  }

  const contentLength = Number.parseInt(response.headers.get("content-length") || "", 10);
  if (Number.isFinite(contentLength) && contentLength > 12 * 1024 * 1024) {
    throw new Error("Artwork image is too large.");
  }

  return Buffer.from(await response.arrayBuffer());
}

function buildHomepageTitleSvg(title: string) {
  const safeTitle = escapeSvgText(title.trim() || "Untitled");
  return Buffer.from(`
    <svg width="${HOMEPAGE_BANNER_WIDTH}" height="${HOMEPAGE_BANNER_HEIGHT}" viewBox="0 0 ${HOMEPAGE_BANNER_WIDTH} ${HOMEPAGE_BANNER_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <text x="92" y="430" fill="#fff" font-family="Arial Black, Impact, sans-serif" font-size="78" font-weight="900" letter-spacing="0" paint-order="stroke" stroke="#000" stroke-width="10" stroke-linejoin="round">${safeTitle}</text>
    </svg>
  `);
}

function buildHomepageGradientSvg() {
  return Buffer.from(`
    <svg width="${HOMEPAGE_BANNER_WIDTH}" height="${HOMEPAGE_BANNER_HEIGHT}" viewBox="0 0 ${HOMEPAGE_BANNER_WIDTH} ${HOMEPAGE_BANNER_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="left" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stop-color="#000" stop-opacity="0.78"/>
          <stop offset="0.38" stop-color="#000" stop-opacity="0.34"/>
          <stop offset="0.74" stop-color="#000" stop-opacity="0.05"/>
          <stop offset="1" stop-color="#000" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="bottom" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="#000" stop-opacity="0"/>
          <stop offset="1" stop-color="#000" stop-opacity="0.34"/>
        </linearGradient>
      </defs>
      <rect width="1280" height="560" fill="url(#left)"/>
      <rect width="1280" height="560" fill="url(#bottom)"/>
    </svg>
  `);
}

export async function composeHomepageBanner(input: {
  backdropUrl: string;
  logoUrl?: string | null;
  title: string;
}) {
  const sharp = (await import("sharp")).default;
  const backdrop = await fetchArtworkImageBuffer(input.backdropUrl);
  const composites: Array<{ input: Buffer; left?: number; top?: number }> = [
    { input: buildHomepageGradientSvg() },
  ];

  if (input.logoUrl) {
    try {
      const logo = await fetchArtworkImageBuffer(input.logoUrl);
      const resizedLogo = await sharp(logo, { animated: false })
        .resize({
          width: 440,
          height: 150,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();
      composites.push({ input: resizedLogo, left: 92, top: 354 });
    } catch {
      composites.push({ input: buildHomepageTitleSvg(input.title) });
    }
  } else {
    composites.push({ input: buildHomepageTitleSvg(input.title) });
  }

  const output = await sharp(backdrop, { animated: false })
    .resize(HOMEPAGE_BANNER_WIDTH, HOMEPAGE_BANNER_HEIGHT, { fit: "cover", position: "center" })
    .composite(composites)
    .webp({ quality: 82 })
    .toBuffer();

  return `data:image/webp;base64,${output.toString("base64")}`;
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
  currentBannerUrl?: string | null;
  currentBannerWithLogoUrl?: string | null;
  currentClearLogoUrl?: string | null;
  externalIds?: ArtworkExternalIds;
  sources?: ArtworkSourceSettings;
  apiKeys?: ArtworkApiKeys;
  allowAmbiguousSearch?: boolean;
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
  allowAmbiguousSearch,
}: {
  mediaType: "movie" | "tv";
  title: string;
  altTitle?: string | null;
  yearHint?: string;
  description?: string | null;
  apiKeys?: ArtworkApiKeys;
  allowAmbiguousSearch?: boolean;
}) {
  const variants = getSearchTitleVariants(title, altTitle);
  const effectiveYearHint = getEffectiveYearHint(title, altTitle, yearHint);
  const rankedCandidates: Array<{ candidate: TmdbSearchResult; score: number }> = [];

  for (const [variantIndex, variant] of variants.entries()) {
    const payload = await fetchTmdbJson<{ results?: TmdbSearchResult[] }>(`/search/${mediaType}`, {
      query: variant,
      year: mediaType === "movie" ? effectiveYearHint : undefined,
      first_air_date_year: mediaType === "tv" ? effectiveYearHint : undefined,
      include_adult: "false",
      language: "cs-CZ",
    }, apiKeys);

    for (const [index, candidate] of (payload?.results ?? []).entries()) {
      let score = scoreTmdbCandidate(candidate, variants, effectiveYearHint, description);
      const candidateYear = parseYear(candidate.release_date ?? candidate.first_air_date);

      // TMDB site ordering is useful for localized titles where result payload titles are English-only.
      if (index === 0) score += 26;
      else if (index === 1) score += 12;
      if (effectiveYearHint && candidateYear === effectiveYearHint) {
        score += Math.max(0, 18 - index * 4);
        if (variantIndex === 0 && index === 0) {
          // TMDB searches localized and alternate titles, while its result payload can
          // still return only the original/English title. Trust the first exact-year
          // hit for the full query so titles such as "Počátek" resolve to Inception.
          score += 1_250;
        }
      }

      rankedCandidates.push({ candidate, score });
    }
  }

  if (rankedCandidates.length === 0) {
    return null;
  }

  const bestById = new Map<number, { candidate: TmdbSearchResult; score: number }>();
  for (const rankedCandidate of rankedCandidates) {
    const id = rankedCandidate.candidate.id;
    if (!id) continue;
    const existing = bestById.get(id);
    if (!existing || rankedCandidate.score > existing.score) {
      bestById.set(id, rankedCandidate);
    }
  }
  const ranked = Array.from(bestById.values()).sort((left, right) => right.score - left.score);

  const best = ranked[0];
  const runnerUp = ranked[1];
  const thresholds = getArtworkConfidenceThresholds(title, altTitle);
  if (!best) {
    return null;
  }
  if (!allowAmbiguousSearch && isAmbiguousArtworkTitle(title, altTitle) && !effectiveYearHint && !description) {
    return null;
  }
  if (best.score < thresholds.minimumScore) {
    return null;
  }
  if (!allowAmbiguousSearch && runnerUp && best.score - runnerUp.score < thresholds.minimumLead) {
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

export async function fetchTmdbTitleMetadata(input: {
  mediaType: "movie" | "tv";
  title: string;
  altTitle?: string | null;
  yearHint?: string;
  description?: string | null;
  externalIds?: ArtworkExternalIds;
  apiKeys?: ArtworkApiKeys;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
}): Promise<ArtworkTitleMetadata | null> {
  let match = await resolveTmdbMatch({
    mediaType: input.mediaType,
    title: input.title,
    altTitle: input.altTitle,
    yearHint: input.yearHint,
    description: input.description,
    externalIds: input.externalIds,
    apiKeys: input.apiKeys,
  });
  const expectedYear = parseYear(input.yearHint);
  const matchedYear = parseYear(match?.release_date ?? match?.first_air_date);
  if (!match?.id || (expectedYear && matchedYear && expectedYear !== matchedYear)) {
    const canonicalCandidate = (await searchExternalTitles(input.title, 20)).find((candidate) =>
      candidate.mediaType === (input.mediaType === "movie" ? "movie" : "serial")
      && (!expectedYear || candidate.year === expectedYear),
    );
    const canonicalId = canonicalCandidate?.id.match(/tmdb:(?:movie|tv):(\d+)$/)?.[1];
    if (canonicalId) {
      match = { id: Number.parseInt(canonicalId, 10) };
    } else {
      const imdbId = canonicalCandidate?.id.match(/^imdb:(tt\d+)$/)?.[1];
      if (imdbId) {
        match = await findTmdbByExternalId({
          mediaType: input.mediaType,
          externalId: imdbId,
          externalSource: "imdb_id",
          apiKeys: input.apiKeys,
        });
      }
    }
  }
  if (!match?.id) return null;

  const detail = await fetchTmdbJson<TmdbMovieDetail>(`/${input.mediaType}/${match.id}`, undefined, input.apiKeys);
  if (!detail) return null;
  const runtime = input.mediaType === "movie" ? detail.runtime : detail.episode_run_time?.find((value) => value > 0);
  const yearSource = input.mediaType === "movie" ? detail.release_date : detail.first_air_date;
  const ratingPercent = typeof detail.vote_average === "number" && Number.isFinite(detail.vote_average) && detail.vote_average > 0
    ? Math.round(detail.vote_average * 10)
    : null;

  const episode = input.mediaType === "tv" && input.seasonNumber && input.episodeNumber
    ? await fetchTmdbJson<{
        name?: string;
        overview?: string;
        runtime?: number | null;
        air_date?: string;
      }>(`/tv/${match.id}/season/${input.seasonNumber}/episode/${input.episodeNumber}`, undefined, input.apiKeys)
    : null;

  return {
    title: detail.title?.trim() || detail.name?.trim() || input.title,
    description: detail.overview?.trim() || null,
    year: parseYear(yearSource) ?? null,
    runtimeMinutes: typeof runtime === "number" && Number.isFinite(runtime) && runtime > 0 ? Math.round(runtime) : null,
    seasonCount: typeof detail.number_of_seasons === "number" && detail.number_of_seasons > 0 ? detail.number_of_seasons : null,
    episodeCount: typeof detail.number_of_episodes === "number" && detail.number_of_episodes > 0 ? detail.number_of_episodes : null,
    genres: Array.from(new Set((detail.genres ?? []).map((genre) => genre.name?.trim() ?? "").filter(Boolean))),
    ratingPercent,
    episodeTitle: episode?.name?.trim() || null,
    episodeDescription: episode?.overview?.trim() || null,
    episodeRuntimeMinutes: typeof episode?.runtime === "number" && episode.runtime > 0 ? Math.round(episode.runtime) : null,
    episodeYear: parseYear(episode?.air_date) ?? null,
  };
}

export type ArtworkEpisodePreview = {
  episodeNumber: number;
  title: string | null;
  description: string | null;
  runtimeMinutes: number | null;
  airDate: string | null;
  stillUrl: string | null;
};

async function fetchTvmazeEpisodePreviews(input: { title: string; yearHint?: string; externalIds?: ArtworkExternalIds; seasonNumber: number }): Promise<ArtworkEpisodePreview[]> {
  type TvmazeShow = { id?: number; name?: string; premiered?: string | null };
  type TvmazeEpisode = { season?: number; number?: number; name?: string; summary?: string | null; runtime?: number | null; airdate?: string | null; image?: { medium?: string | null; original?: string | null } | null };
  const fetchJson = async <T,>(url: string): Promise<T | null> => {
    const response = await fetch(url, { headers: { Accept: "application/json" } }).catch(() => null);
    return response?.ok ? response.json() as Promise<T> : null;
  };
  let show: TvmazeShow | null = null;
  if (input.externalIds?.imdb) show = await fetchJson<TvmazeShow>(`https://api.tvmaze.com/lookup/shows?imdb=${encodeURIComponent(input.externalIds.imdb)}`);
  if (!show?.id && input.externalIds?.tvdb) show = await fetchJson<TvmazeShow>(`https://api.tvmaze.com/lookup/shows?thetvdb=${encodeURIComponent(input.externalIds.tvdb)}`);
  if (!show?.id) {
    const matches = await fetchJson<Array<{ show?: TvmazeShow }>>(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(input.title)}`) ?? [];
    const wantedYear = input.yearHint?.match(/\b(19|20)\d{2}\b/)?.[0];
    show = matches.map((entry) => entry.show).find((candidate) => candidate?.name?.localeCompare(input.title, undefined, { sensitivity: "base" }) === 0 && (!wantedYear || candidate.premiered?.startsWith(wantedYear))) ?? matches[0]?.show ?? null;
  }
  if (!show?.id) return [];
  const episodes = await fetchJson<TvmazeEpisode[]>(`https://api.tvmaze.com/shows/${show.id}/episodes`) ?? [];
  return episodes.flatMap((episode) => episode.season === input.seasonNumber && typeof episode.number === "number" ? [{
    episodeNumber: episode.number,
    title: episode.name?.trim() || null,
    description: episode.summary?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || null,
    runtimeMinutes: typeof episode.runtime === "number" && episode.runtime > 0 ? episode.runtime : null,
    airDate: episode.airdate?.trim() || null,
    stillUrl: episode.image?.original ?? episode.image?.medium ?? null,
  }] : []);
}

export async function fetchTmdbSeasonEpisodePreviews(input: {
  title: string;
  altTitle?: string | null;
  yearHint?: string;
  description?: string | null;
  externalIds?: ArtworkExternalIds;
  seasonNumber: number;
  apiKeys?: ArtworkApiKeys;
}): Promise<ArtworkEpisodePreview[]> {
  const match = await resolveTmdbMatch({
    mediaType: "tv",
    title: input.title,
    altTitle: input.altTitle,
    yearHint: input.yearHint,
    description: input.description,
    externalIds: input.externalIds,
    apiKeys: input.apiKeys,
  });
  const tvmazePreviewsPromise = fetchTvmazeEpisodePreviews(input);
  if (!match?.id) return tvmazePreviewsPromise;

  const season = await fetchTmdbJson<{
    episodes?: Array<{
      episode_number?: number;
      name?: string;
      overview?: string;
      runtime?: number | null;
      air_date?: string | null;
      still_path?: string | null;
    }>;
  }>(`/tv/${match.id}/season/${input.seasonNumber}`, undefined, input.apiKeys);

  const tmdbPreviews = (season?.episodes ?? []).flatMap((episode) => {
    if (typeof episode.episode_number !== "number") return [];
    return [{
      episodeNumber: episode.episode_number,
      title: episode.name?.trim() || null,
      description: episode.overview?.trim() || null,
      runtimeMinutes: typeof episode.runtime === "number" && episode.runtime > 0 ? Math.round(episode.runtime) : null,
      airDate: episode.air_date?.trim() || null,
      stillUrl: episode.still_path ? `https://image.tmdb.org/t/p/w780${episode.still_path}` : null,
    }];
  });
  const tvmazeByEpisode = new Map((await tvmazePreviewsPromise).map((episode) => [episode.episodeNumber, episode]));
  const merged = tmdbPreviews.map((episode) => {
    const fallback = tvmazeByEpisode.get(episode.episodeNumber);
    tvmazeByEpisode.delete(episode.episodeNumber);
    return { ...fallback, ...episode, title: episode.title ?? fallback?.title ?? null, description: episode.description ?? fallback?.description ?? null, runtimeMinutes: episode.runtimeMinutes ?? fallback?.runtimeMinutes ?? null, airDate: episode.airDate ?? fallback?.airDate ?? null, stillUrl: episode.stillUrl ?? fallback?.stillUrl ?? null };
  });
  return [...merged, ...tvmazeByEpisode.values()].sort((a, b) => a.episodeNumber - b.episodeNumber);
}

function tmdbProfileUrl(path: string | null | undefined) {
  return path ? `https://image.tmdb.org/t/p/w185${path}` : null;
}

function tmdbPosterUrl(path: string | null | undefined) {
  return path ? `https://image.tmdb.org/t/p/w342${path}` : null;
}

function tmdbBackdropUrl(path: string | null | undefined) {
  return path ? `https://image.tmdb.org/t/p/w780${path}` : null;
}

export async function fetchTmdbCast(input: {
  mediaType: "movie" | "tv";
  title: string;
  altTitle?: string | null;
  yearHint?: string;
  description?: string | null;
  externalIds?: ArtworkExternalIds;
  apiKeys?: ArtworkApiKeys;
  limit?: number;
}): Promise<ArtworkCastMember[]> {
  const match = await resolveTmdbMatch({
    mediaType: input.mediaType,
    title: input.title,
    altTitle: input.altTitle,
    yearHint: input.yearHint,
    description: input.description,
    externalIds: input.externalIds,
    apiKeys: input.apiKeys,
    allowAmbiguousSearch: true,
  });

  if (!match?.id) {
    return [];
  }

  const limit = Math.max(1, Math.min(input.limit ?? 12, 24));
  if (input.mediaType === "tv") {
    const payload = await fetchTmdbJson<{ cast?: TmdbTvAggregateCreditPerson[] }>(`/tv/${match.id}/aggregate_credits`, undefined, input.apiKeys);
    return Array.from(
      new Map(
        (payload?.cast ?? [])
          .sort((left, right) => {
            const leftEpisodes = left.total_episode_count ?? left.roles?.reduce((sum, role) => sum + (role.episode_count ?? 0), 0) ?? 0;
            const rightEpisodes = right.total_episode_count ?? right.roles?.reduce((sum, role) => sum + (role.episode_count ?? 0), 0) ?? 0;
            if (leftEpisodes !== rightEpisodes) return rightEpisodes - leftEpisodes;
            return (left.order ?? 0) - (right.order ?? 0);
          })
          .map((person) => {
            const name = person.name?.trim() ?? "";
            const role = person.roles?.find((entry) => entry.character?.trim())?.character?.trim() ?? null;
            return [name, { name, role, profileUrl: tmdbProfileUrl(person.profile_path) } satisfies ArtworkCastMember] as const;
          })
          .filter(([name]) => Boolean(name)),
      ).values(),
    ).slice(0, limit);
  }

  const payload = await fetchTmdbJson<{ cast?: TmdbMovieCreditPerson[] }>(`/movie/${match.id}/credits`, undefined, input.apiKeys);
  return Array.from(
    new Map(
      (payload?.cast ?? [])
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
        .map((person) => {
          const name = person.name?.trim() ?? "";
          const role = person.character?.trim() ?? null;
          return [name, { name, role, profileUrl: tmdbProfileUrl(person.profile_path) } satisfies ArtworkCastMember] as const;
        })
        .filter(([name]) => Boolean(name)),
    ).values(),
  ).slice(0, limit);
}

export async function fetchTmdbPersonCredits(input: {
  name: string;
  apiKeys?: ArtworkApiKeys;
  limit?: number;
}): Promise<ArtworkPersonCredit[]> {
  const query = input.name.trim();
  if (!query) {
    return [];
  }

  const personPayload = await fetchTmdbJson<{ results?: TmdbSearchResult[] }>("/search/person", {
    query,
    include_adult: "false",
  }, input.apiKeys);

  const person = (personPayload?.results ?? [])
    .map((candidate) => ({
      candidate,
      score: scoreSearchCandidate(query, [candidate.name ?? "", ...(candidate.known_for ?? []).map((entry) => entry.title ?? entry.name ?? "")]) +
        (normalizeSearchText(candidate.name ?? "") === normalizeSearchText(query) ? 80 : 0) +
        (candidate.known_for_department?.toLowerCase() === "acting" ? 24 : 0) +
        Math.min(candidate.popularity ?? 0, 40),
    }))
    .sort((left, right) => right.score - left.score)[0]?.candidate;

  if (!person?.id) {
    return [];
  }

  const creditsPayload = await fetchTmdbJson<{ cast?: TmdbPersonCredit[] }>(`/person/${person.id}/combined_credits`, undefined, input.apiKeys);
  const limit = Math.max(1, Math.min(input.limit ?? 120, 200));

  return Array.from(
    new Map(
      (creditsPayload?.cast ?? [])
        .filter((credit) => credit.media_type === "movie" || credit.media_type === "tv")
        .map((credit) => {
          const mediaType: ArtworkPersonCredit["mediaType"] = credit.media_type === "tv" ? "serial" : "movie";
          const title = (credit.title ?? credit.name ?? credit.original_title ?? credit.original_name ?? "").trim();
          const year = parseYear(credit.release_date ?? credit.first_air_date);
          const item: ArtworkPersonCredit = {
            id: `tmdb:${mediaType}:${credit.id}`,
            tmdbId: credit.id,
            title,
            mediaType,
            role: credit.character?.trim() || null,
            year: year ? String(year) : null,
            posterUrl: tmdbPosterUrl(credit.poster_path),
            backdropUrl: tmdbBackdropUrl(credit.backdrop_path),
            description: credit.overview?.trim() || null,
          };
          return [`${mediaType}:${credit.id}`, item] as const;
        })
        .filter(([, item]) => Boolean(item.title)),
    ).values(),
  )
    .sort((left, right) => {
      const leftYear = Number.parseInt(left.year ?? "", 10) || 0;
      const rightYear = Number.parseInt(right.year ?? "", 10) || 0;
      if (leftYear !== rightYear) return rightYear - leftYear;
      return left.title.localeCompare(right.title);
    })
    .slice(0, limit);
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
  allowAmbiguousSearch?: boolean;
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
    allowAmbiguousSearch: options.allowAmbiguousSearch,
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
  allowAmbiguousSearch,
}: {
  mediaType: "movie" | "tv";
  title: string;
  altTitle?: string | null;
  yearHint?: string;
  description?: string | null;
  apiKeys?: ArtworkApiKeys;
  allowAmbiguousSearch?: boolean;
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
  if (!allowAmbiguousSearch && runnerUp && best.score - runnerUp.score < thresholds.minimumLead) {
    return null;
  }
  if (
    !allowAmbiguousSearch &&
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
    const wideEntries = [...(payload.moviethumb ?? []), ...(payload.moviebackground ?? [])];
    const banner = pickPreferredFanart(payload.moviebanner);
    const backdrop = pickPreferredFanart(wideEntries.filter((entry) => !hasArtworkLanguage(entry.lang)))
      ?? pickPreferredFanart(wideEntries);
    const wLogoBanner = pickPreferredFanart(wideEntries.filter((entry) => hasArtworkLanguage(entry.lang))) ?? banner;
    const clearLogo = pickPreferredFanart(payload.hdmovielogo) ?? pickPreferredFanart(payload.movielogo);

    return {
      posterUrl: poster?.url ?? null,
      backdropUrl: backdrop?.url ?? null,
      bannerUrl: banner?.url ?? null,
      bannerWithLogoUrl: wLogoBanner?.url ?? null,
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
  const wideEntries = [...(payload.showbackground ?? []), ...(payload.tvthumb ?? [])];
  const banner = pickPreferredFanart(payload.tvbanner);
  const backdrop = pickPreferredFanart(wideEntries.filter((entry) => !hasArtworkLanguage(entry.lang)))
    ?? pickPreferredFanart(wideEntries);
  const wLogoBanner = pickPreferredFanart(wideEntries.filter((entry) => hasArtworkLanguage(entry.lang))) ?? banner;
  const clearLogo = pickPreferredFanart(payload.hdtvlogo) ?? pickPreferredFanart(payload.clearlogo);

  return {
    posterUrl: poster?.url ?? null,
    backdropUrl: backdrop?.url ?? null,
    bannerUrl: banner?.url ?? null,
    bannerWithLogoUrl: wLogoBanner?.url ?? null,
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
    const banner = pickPreferredTvdbArtwork(
      artworks,
      (entry) => entry.image?.includes("/banners/") === true,
    );
    const backdrop = pickPreferredTvdbArtwork(
      artworks,
      (entry) => (entry.type === 15 || entry.image?.includes("/backgrounds/") === true)
        && classifyWideArtworkKind(entry.includesText, entry.language) === "banner",
    );
    const wLogoBackdrop = pickPreferredTvdbArtwork(
      artworks,
      (entry) => (entry.type === 15 || entry.image?.includes("/backgrounds/") === true)
        && classifyWideArtworkKind(entry.includesText, entry.language) === "wlogo-banner",
    );
    const clearLogo = pickPreferredTvdbArtwork(
      artworks,
      (entry) => entry.type === 25 || entry.image?.includes("/clearlogo/") === true,
    );

    return {
      posterUrl: poster?.image ?? extended?.image ?? null,
      backdropUrl: backdrop?.image ?? null,
      bannerUrl: banner?.image ?? null,
      bannerWithLogoUrl: wLogoBackdrop?.image ?? banner?.image ?? null,
      clearLogoUrl: clearLogo?.image ?? null,
    };
  }

  const poster = pickPreferredTvdbArtwork(artworks, (entry) => entry.type === 2 || entry.image?.includes("/posters/") === true);
  const banner = pickPreferredTvdbArtwork(
    artworks,
    (entry) => entry.image?.includes("/banners/") === true,
  );
  const backdrop = pickPreferredTvdbArtwork(
    artworks,
    (entry) => (entry.type === 3 || entry.image?.includes("/fanart/") === true || entry.image?.includes("/backgrounds/") === true)
      && classifyWideArtworkKind(entry.includesText, entry.language) === "banner",
  );
  const wLogoBackdrop = pickPreferredTvdbArtwork(
    artworks,
    (entry) => (entry.type === 3 || entry.image?.includes("/fanart/") === true || entry.image?.includes("/backgrounds/") === true)
      && classifyWideArtworkKind(entry.includesText, entry.language) === "wlogo-banner",
  );
  const clearLogo = pickPreferredTvdbArtwork(
    artworks,
    (entry) => entry.type === 23 || entry.image?.includes("/clearlogo/") === true,
  );

  return {
    posterUrl: poster?.image ?? extended?.image ?? null,
    backdropUrl: backdrop?.image ?? null,
    bannerUrl: banner?.image ?? null,
    bannerWithLogoUrl: wLogoBackdrop?.image ?? banner?.image ?? null,
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

export const MAX_ARTWORK_ASSETS_PER_GROUP = 36;

export function limitArtworkAssets(
  assets: ArtworkAsset[],
  limitPerKindAndSource = MAX_ARTWORK_ASSETS_PER_GROUP,
) {
  const counts = new Map<string, number>();
  return dedupeArtworkAssets(assets).filter((asset) => {
    if (asset.source === "current") return true;
    const key = `${asset.kind}:${asset.source}`;
    const count = counts.get(key) ?? 0;
    if (count >= limitPerKindAndSource) return false;
    counts.set(key, count + 1);
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
  currentBannerUrl?: string | null;
  currentBannerWithLogoUrl?: string | null;
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
      kind: "banner",
      source: "current",
      label: "Current Banner",
      language: null,
      score: 1,
      hasText: null,
    });
  }
  if (options.currentBannerUrl) {
    assets.push({
      url: options.currentBannerUrl,
      kind: "banner",
      source: "current",
      label: "Current Banner",
      language: null,
      score: 1,
      hasText: false,
    });
  }
  if (options.currentBannerWithLogoUrl) {
    assets.push({
      url: options.currentBannerWithLogoUrl,
      kind: "wlogo-banner",
      source: "current",
      label: "Current WLogo Banner",
      language: null,
      score: 1,
      hasText: true,
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
  const options = withCanonicalArtworkIdentity({
    ...input,
    allowAmbiguousSearch: true,
  });

  const primaryAssets = await searchArtworkAssetsForMedia(options);
  const primaryExternalCount = countExternalArtworkAssets(primaryAssets);
  if (primaryExternalCount > 2) {
    return limitArtworkAssets(primaryAssets);
  }

  const alternateMediaType = options.mediaType === "movie" ? "tv" : "movie";
  const alternateAssets = await searchArtworkAssetsForMedia({
    ...options,
    mediaType: alternateMediaType,
  });
  const alternateExternalCount = countExternalArtworkAssets(alternateAssets);

  if (alternateExternalCount >= primaryExternalCount + 8) {
    return limitArtworkAssets([...alternateAssets, ...primaryAssets]);
  }

  return limitArtworkAssets(primaryAssets);
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
          allowAmbiguousSearch: options.allowAmbiguousSearch,
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
          allowAmbiguousSearch: options.allowAmbiguousSearch,
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
      const kind = classifyWideArtworkKind(undefined, backdrop.iso_639_1);
      tmdbBackdropAssets.push({
        url,
        kind,
        source: "tmdb",
        label: kind === "wlogo-banner" ? "TMDB WLogo Banner" : "TMDB Banner HD",
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
    for (const entry of sortFanartEntries([...(fanartMoviePayload.moviethumb ?? []), ...(fanartMoviePayload.moviebackground ?? [])])) {
      if (!entry.url) continue;
      const kind = classifyWideArtworkKind(undefined, entry.lang);
      assets.push({ url: entry.url, kind, source: "fanart", label: kind === "wlogo-banner" ? "Fanart WLogo Banner" : "Fanart Banner HD", language: entry.lang ?? null, score: Number(entry.likes ?? 0), hasText: kind === "wlogo-banner" });
    }
    for (const entry of sortFanartEntries(fanartMoviePayload.moviebanner)) {
      if (!entry.url) continue;
      assets.push({ url: entry.url, kind: "wlogo-banner", source: "fanart", label: "Fanart WLogo Banner", language: entry.lang ?? null, score: Number(entry.likes ?? 0), hasText: true });
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
    for (const entry of sortFanartEntries([...(fanartTvPayload.showbackground ?? []), ...(fanartTvPayload.tvthumb ?? [])])) {
      if (!entry.url) continue;
      const kind = classifyWideArtworkKind(undefined, entry.lang);
      assets.push({ url: entry.url, kind, source: "fanart", label: kind === "wlogo-banner" ? "Fanart WLogo Banner" : "Fanart Banner HD", language: entry.lang ?? null, score: Number(entry.likes ?? 0), hasText: kind === "wlogo-banner" });
    }
    for (const entry of sortFanartEntries(fanartTvPayload.tvbanner)) {
      if (!entry.url) continue;
      assets.push({ url: entry.url, kind: "wlogo-banner", source: "fanart", label: "Fanart WLogo Banner", language: entry.lang ?? null, score: Number(entry.likes ?? 0), hasText: true });
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
      const kind = classifyWideArtworkKind(entry.includesText, entry.language);
      assets.push({ url: entry.image, kind, source: "tvdb", label: kind === "wlogo-banner" ? "TVDB WLogo Banner" : "TVDB Banner HD", language: entry.language ?? null, width: entry.width ?? null, score: entry.score ?? 0, hasText: kind === "wlogo-banner" });
    }
    for (const entry of sortTvdbArtwork(tvdbExtended.artworks, (art) => art.image?.includes("/banners/") === true)) {
      if (!entry.image) continue;
      assets.push({ url: entry.image, kind: "wlogo-banner", source: "tvdb", label: "TVDB WLogo Banner", language: entry.language ?? null, width: entry.width ?? null, score: entry.score ?? 0, hasText: true });
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
      bannerUrl: options.currentBannerUrl ?? options.currentBackdropUrl ?? null,
      clearLogoUrl: options.currentClearLogoUrl ?? null,
      bannerWithLogoUrl: options.currentBannerWithLogoUrl ?? null,
    };
  }

  const tmdbEnabled = isSourceEnabled(options.sources, "tmdb");
  const fanartEnabled = isSourceEnabled(options.sources, "fanart");
  const tvdbEnabled = isSourceEnabled(options.sources, "tvdb");

  if (!tmdbEnabled && !fanartEnabled && !tvdbEnabled) {
    return {
      posterUrl: options.currentPosterUrl ?? null,
      backdropUrl: options.currentBackdropUrl ?? null,
      bannerUrl: options.currentBannerUrl ?? options.currentBackdropUrl ?? null,
      clearLogoUrl: options.currentClearLogoUrl ?? null,
      bannerWithLogoUrl: options.currentBannerWithLogoUrl ?? null,
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
          const wLogoBackdrop = pickPreferredImage(images?.backdrops?.filter((entry) => hasArtworkLanguage(entry.iso_639_1)));
          const clearLogo = pickPreferredImage(images?.logos);

          return {
            posterUrl:
              buildTmdbImageUrl(tmdbMatch.poster_path ?? poster?.file_path, "poster", imageConfig) ??
              options.currentPosterUrl ??
              null,
            backdropUrl:
              buildTmdbImageUrl(backdrop?.file_path ?? tmdbMatch.backdrop_path, "backdrop", imageConfig) ??
              null,
            bannerUrl: null,
            bannerWithLogoUrl: wLogoBackdrop?.file_path
              ? `${imageConfig.secure_base_url}original${wLogoBackdrop.file_path}`
              : null,
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
      options.currentBannerUrl ??
      null,
    bannerUrl:
      tmdbBundle.backdropUrl ??
      tvdbBundle.backdropUrl ??
      fanartBundle.backdropUrl ??
      options.currentBannerUrl ??
      options.currentBackdropUrl ??
      null,
    clearLogoUrl:
      fanartBundle.clearLogoUrl ??
      tvdbBundle.clearLogoUrl ??
      tmdbBundle.clearLogoUrl ??
      options.currentClearLogoUrl ??
      null,
    bannerWithLogoUrl:
      tmdbBundle.bannerWithLogoUrl ??
      fanartBundle.bannerWithLogoUrl ??
      tvdbBundle.bannerWithLogoUrl ??
      fanartBundle.bannerUrl ??
      tvdbBundle.bannerUrl ??
      options.currentBannerWithLogoUrl ??
      null,
  };
}
