import type { CastMember, EpisodePlayer, ExploreItem, ImportedShow, LibraryEpisode } from "../lib/types";
import {
  compareSearchScores,
  keepHighConfidenceSearchResults,
  scoreSearchCandidate,
} from "../lib/search-ranking";
import { searchTmdbTitleCandidates } from "./external-title-search";
import { enrichArtwork } from "./artwork";

const BASE_URL = "https://www.vidking.net";
const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const VIDKING_AVAILABILITY_TIMEOUT_MS = 700;
const VIDKING_AVAILABILITY_CACHE_MAX = 1000;

type VidkingMediaType = "movie" | "tv";
export type VidkingAvailability = "available" | "unavailable" | "unknown" | "verifying";

export type VidkingAvailabilityResult = {
  importSlug: string;
  mediaType: "movie" | "serial";
  availability: VidkingAvailability;
  detailUrl: string;
  checkedAt: number;
  reason?: string | null;
  verifying?: boolean;
};

type TmdbDetails = {
  id?: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string | null;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  imdb_id?: string | null;
  external_ids?: {
    imdb_id?: string | null;
  };
  credits?: {
    cast?: Array<{
      name?: string;
      character?: string;
      profile_path?: string | null;
      order?: number;
    }>;
  };
  seasons?: Array<{
    season_number?: number;
    episode_count?: number;
    name?: string;
  }>;
};

type TmdbSeasonDetails = {
  season_number?: number;
  episodes?: Array<{
    episode_number?: number;
    name?: string;
    overview?: string;
    still_path?: string | null;
  }>;
};

const availabilityCache = new Map<string, { expiresAt: number; result: VidkingAvailabilityResult }>();

function getTmdbReadToken() {
  return process.env.TMDB_API_READ_TOKEN?.trim() || "";
}

async function fetchTmdbJson<T>(path: string): Promise<T> {
  const token = getTmdbReadToken();
  if (!token) {
    throw new Error("TMDB_API_READ_TOKEN is required for VidKing imports.");
  }

  const response = await fetch(`${TMDB_API_BASE}${path}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`TMDB request failed: ${response.status} ${response.statusText}`);
  }

  return await response.json() as T;
}

function tmdbImage(path: string | null | undefined, size: "w342" | "w780" | "original" = "w342") {
  return path ? `${TMDB_IMAGE_BASE}/${size}${path}` : null;
}

function tmdbCast(details: TmdbDetails): CastMember[] {
  return Array.from(
    new Map(
      (details.credits?.cast ?? [])
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
        .map((person) => {
          const name = person.name?.trim() ?? "";
          return [name, {
            name,
            role: person.character?.trim() || null,
            profileUrl: tmdbImage(person.profile_path, "w342"),
          } satisfies CastMember] as const;
        })
        .filter(([name]) => Boolean(name)),
    ).values(),
  ).slice(0, 12);
}

function parseYear(value: string | null | undefined) {
  return value?.match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "title";
}

function normalizeImportSlug(value: string, mediaType?: "movie" | "serial") {
  const raw = value.trim();

  try {
    const url = new URL(raw);
    const parts = url.pathname.split("/").filter(Boolean);
    const embedIndex = parts.findIndex((part) => part === "embed");
    if (embedIndex >= 0 && (parts[embedIndex + 1] === "movie" || parts[embedIndex + 1] === "tv")) {
      return parts.slice(embedIndex + 1, embedIndex + 5).join("/");
    }
  } catch {
    // Plain slugs are parsed below.
  }

  const trimmed = raw.replace(/^\/+|\/+$/g, "");
  if (/^(movie|tv)\/\d+/i.test(trimmed)) {
    return trimmed;
  }
  if (/^\d+$/.test(trimmed)) {
    return `${mediaType === "serial" ? "tv" : "movie"}/${trimmed}`;
  }
  return trimmed;
}

function parseImportSlug(value: string, mediaType?: "movie" | "serial") {
  const normalized = normalizeImportSlug(value, mediaType);
  const match = normalized.match(/^(movie|tv)\/(\d+)(?:\/(\d+)\/(\d+))?/i);
  if (!match) {
    throw new Error("Provide a valid VidKing slug like movie/550 or tv/1399.");
  }

  return {
    mediaType: match[1].toLowerCase() as VidkingMediaType,
    tmdbId: match[2],
    seasonNumber: match[3] ? Number.parseInt(match[3], 10) : null,
    episodeNumber: match[4] ? Number.parseInt(match[4], 10) : null,
  };
}

function buildEmbedUrl(input: {
  mediaType: VidkingMediaType;
  tmdbId: string;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
}) {
  if (input.mediaType === "movie") {
    return `${BASE_URL}/embed/movie/${encodeURIComponent(input.tmdbId)}`;
  }
  return `${BASE_URL}/embed/tv/${encodeURIComponent(input.tmdbId)}/${input.seasonNumber ?? 1}/${input.episodeNumber ?? 1}`;
}

function availabilityTtl(status: VidkingAvailability) {
  if (status === "available") return 6 * 60 * 60 * 1000;
  if (status === "unavailable") return 30 * 60 * 1000;
  return 5 * 60 * 1000;
}

function getAvailabilityCache(key: string) {
  const cached = availabilityCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    availabilityCache.delete(key);
    return null;
  }
  return cached.result;
}

function setAvailabilityCache(key: string, result: VidkingAvailabilityResult) {
  availabilityCache.set(key, {
    expiresAt: Date.now() + availabilityTtl(result.availability),
    result,
  });
  if (availabilityCache.size > VIDKING_AVAILABILITY_CACHE_MAX) {
    const oldestKey = availabilityCache.keys().next().value as string | undefined;
    if (oldestKey) availabilityCache.delete(oldestKey);
  }
}

async function fetchWithTimeout(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VIDKING_AVAILABILITY_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        ...init.headers,
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

function classifyVidkingHtml(html: string) {
  const lower = html.toLowerCase();
  if (/\b(?:not found|unavailable|no sources|removed|video not found|media unavailable)\b/.test(lower)) {
    return { availability: "unavailable" as const, reason: "VidKing reported no playable source." };
  }
  if (
    /\b(?:just a moment|checking your browser|verif(?:ying|ication|y)|security check|cf-chl-|__cf_chl|captcha|challenge|access denied|maintenance)\b/.test(lower)
  ) {
    return {
      availability: "verifying" as const,
      reason: "VidKing is running a verification check right now. Try again in a few minutes.",
      verifying: true,
    };
  }
  if (/(?:iframe|video|player|embed|stream|hls|m3u8|__next|vidking)/i.test(html)) {
    return { availability: "available" as const, reason: null };
  }
  return { availability: "unknown" as const, reason: "VidKing response was ambiguous." };
}

function buildPlayer(input: {
  mediaType: VidkingMediaType;
  tmdbId: string;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  detailUrl: string;
}): EpisodePlayer {
  return {
    alias: "vidking-player",
    provider: "vidking",
    label: "VidKing",
    sourcePageUrl: input.detailUrl,
    embedUrl: buildEmbedUrl(input),
    resolutionStatus: "unresolved",
  };
}

function createSearchItem(candidate: Awaited<ReturnType<typeof searchTmdbTitleCandidates>>[number], index: number): ExploreItem | null {
  const tmdbMatch = candidate.id.match(/^tmdb:(movie|tv):(\d+)$/i);
  if (!tmdbMatch) {
    return null;
  }
  const mediaType = tmdbMatch[1] === "tv" ? "serial" : "movie";
  const routeType = mediaType === "serial" ? "tv" : "movie";
  const tmdbId = tmdbMatch[2];
  const importSlug = `${routeType}/${tmdbId}`;
  const detailUrl = mediaType === "serial"
    ? `${BASE_URL}/embed/tv/${tmdbId}/1/1`
    : `${BASE_URL}/embed/movie/${tmdbId}`;
  return {
    id: `vidking:search:${importSlug}`,
    title: candidate.title,
    slug: importSlug,
    importSlug,
    provider: "vidking",
    mediaType,
    detailUrl,
    posterUrl: candidate.posterUrl ?? null,
    backdropUrl: null,
    year: candidate.year ?? null,
    yearLabel: candidate.year ?? null,
    alternateTitles: [candidate.originalTitle].filter((title): title is string => Boolean(title && title !== candidate.title)),
    description: null,
    genres: [],
    audioBuckets: ["all"],
    languages: [],
    network: null,
    directors: [],
    actors: [],
    sectionKeys: [],
    inVault: false,
    availableNow: true,
    availability: "checking",
    availabilityReason: "Checking VidKing availability.",
    matchScore: Math.max(candidate.matchScore, scoreSearchCandidate(candidate.title, [candidate.title, candidate.year], index)),
    searchSignals: {
      source: "tmdb",
      popularity: candidate.popularity ?? null,
      voteCount: candidate.voteCount ?? null,
      voteAverage: candidate.voteAverage ?? null,
      releaseDate: candidate.releaseDate ?? null,
      originalLanguage: candidate.originalLanguage ?? null,
    },
    recommendationReasons: [],
  };
}

export async function checkVidkingAvailability(input: {
  importSlug: string;
  mediaType?: "movie" | "serial";
}): Promise<VidkingAvailabilityResult> {
  const parsed = parseImportSlug(input.importSlug, input.mediaType);
  const importSlug = `${parsed.mediaType}/${parsed.tmdbId}`;
  const mediaType: "movie" | "serial" = parsed.mediaType === "tv" ? "serial" : "movie";
  const detailUrl = buildEmbedUrl(parsed);
  const cacheKey = `${mediaType}:${importSlug}`;
  const cached = getAvailabilityCache(cacheKey);
  if (cached) {
    return cached;
  }

  const checkedAt = Date.now();
  const baseResult: Pick<VidkingAvailabilityResult, "importSlug" | "mediaType" | "detailUrl" | "checkedAt"> = {
    importSlug,
    mediaType,
    detailUrl,
    checkedAt,
  };

  try {
    const head = await fetchWithTimeout(detailUrl, { method: "HEAD", redirect: "follow" }).catch(() => null);
    if (head && (head.status === 404 || head.status === 410)) {
      const result = { ...baseResult, availability: "unavailable" as const, reason: `VidKing returned ${head.status}.` };
      setAvailabilityCache(cacheKey, result);
      return result;
    }
    if (head?.ok) {
      const contentType = head.headers.get("content-type") || "";
      if (!/text\/html|application\/xhtml\+xml|^$/i.test(contentType)) {
        const result = { ...baseResult, availability: "available" as const, reason: null };
        setAvailabilityCache(cacheKey, result);
        return result;
      }
    }

    const response = await fetchWithTimeout(detailUrl, { method: "GET", redirect: "follow" });
    if (response.status === 404 || response.status === 410) {
      const result = { ...baseResult, availability: "unavailable" as const, reason: `VidKing returned ${response.status}.` };
      setAvailabilityCache(cacheKey, result);
      return result;
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        const result = {
          ...baseResult,
          availability: "verifying" as const,
          reason: "VidKing is running a verification check right now. Try again in a few minutes.",
          verifying: true,
        };
        setAvailabilityCache(cacheKey, result);
        return result;
      }
      const result = { ...baseResult, availability: "unknown" as const, reason: `VidKing returned ${response.status}.` };
      setAvailabilityCache(cacheKey, result);
      return result;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      const result = { ...baseResult, availability: "available" as const, reason: null };
      setAvailabilityCache(cacheKey, result);
      return result;
    }

    const classification = classifyVidkingHtml(await response.text());
    const result = { ...baseResult, ...classification };
    setAvailabilityCache(cacheKey, result);
    return result;
  } catch (error) {
    const result = {
      ...baseResult,
      availability: "unknown" as const,
      reason: error instanceof Error && error.name === "AbortError" ? "VidKing availability check timed out." : "VidKing availability check failed.",
    };
    setAvailabilityCache(cacheKey, result);
    return result;
  }
}

export async function checkVidkingAvailabilityBatch(
  items: Array<{ importSlug: string; mediaType?: "movie" | "serial" }>,
  concurrency = 6,
) {
  const results: VidkingAvailabilityResult[] = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (!item) continue;
      results[index] = await checkVidkingAvailability(item);
    }
  });
  await Promise.all(workers);
  return results.filter(Boolean);
}

export async function searchVidking(query: string) {
  const candidates = await searchTmdbTitleCandidates(query, 16);
  return keepHighConfidenceSearchResults(
    candidates
      .map(createSearchItem)
      .filter((item): item is ExploreItem => item !== null)
      .sort(compareSearchScores),
  ).slice(0, 12);
}

async function buildTvEpisodes(input: {
  parsed: ReturnType<typeof parseImportSlug>;
  details: TmdbDetails;
  title: string;
  showSlug: string;
  importedAt: number;
}) {
  const regularSeasons = (input.details.seasons ?? [])
    .map((season) => season.season_number)
    .filter((season): season is number => typeof season === "number" && Number.isFinite(season) && season > 0);
  const seasonNumbers = input.parsed.seasonNumber ? [input.parsed.seasonNumber] : regularSeasons;
  const seasons = seasonNumbers.length > 0 ? seasonNumbers : [1];
  const episodes: LibraryEpisode[] = [];

  for (const seasonNumber of seasons) {
    const seasonDetails = await fetchTmdbJson<TmdbSeasonDetails>(
      `/tv/${input.parsed.tmdbId}/season/${seasonNumber}?language=en-US`,
    );
    const seasonEpisodes = (seasonDetails.episodes ?? [])
      .filter((episode) => {
        if (input.parsed.episodeNumber) {
          return episode.episode_number === input.parsed.episodeNumber;
        }
        return typeof episode.episode_number === "number" && Number.isFinite(episode.episode_number);
      });

    for (const episode of seasonEpisodes) {
      const episodeNumber = episode.episode_number ?? 1;
      const episodeCode = `s${seasonNumber}e${episodeNumber}`;
      const detailUrl = `${BASE_URL}/embed/tv/${input.parsed.tmdbId}/${seasonNumber}/${episodeNumber}`;
      const player = buildPlayer({
        mediaType: "tv",
        tmdbId: input.parsed.tmdbId,
        seasonNumber,
        episodeNumber,
        detailUrl,
      });
      episodes.push({
        id: `${input.showSlug}:${episodeCode}`,
        showSlug: input.showSlug,
        showTitle: input.title,
        posterUrl: tmdbImage(input.details.poster_path, "w342") ?? undefined,
        seasonNumber,
        episodeNumber,
        episodeCode,
        episodeTitle: episode.name ? `${input.title} - ${episodeCode.toUpperCase()} - ${episode.name}` : `${input.title} - ${episodeCode.toUpperCase()}`,
        episodeUrl: detailUrl,
        players: [player],
        selectedPlayerAlias: player.alias,
        importedAt: input.importedAt,
      });
    }
  }

  return episodes;
}

export async function fetchVidkingTitle(slug: string, mediaType?: "movie" | "serial"): Promise<ImportedShow> {
  const parsed = parseImportSlug(slug, mediaType);
  const details = await fetchTmdbJson<TmdbDetails>(
    `/${parsed.mediaType}/${parsed.tmdbId}?append_to_response=external_ids,credits&language=en-US`,
  );
  const importedAt = Date.now();
  const isMovie = parsed.mediaType === "movie";
  const title = details.title ?? details.name ?? `TMDB ${parsed.tmdbId}`;
  const showSlug = `vidking-${parsed.mediaType}-${parsed.tmdbId}`;
  const detailUrl = buildEmbedUrl(parsed);

  const episodes = isMovie
    ? (() => {
      const player = buildPlayer({ mediaType: "movie", tmdbId: parsed.tmdbId, detailUrl });
      return [{
        id: `${showSlug}:movie`,
        showSlug,
        showTitle: title,
        posterUrl: tmdbImage(details.poster_path, "w342") ?? undefined,
        seasonNumber: 1,
        episodeNumber: null,
        episodeCode: "movie",
        episodeTitle: title,
        episodeUrl: detailUrl,
        players: [player],
        selectedPlayerAlias: player.alias,
        importedAt,
      } satisfies LibraryEpisode];
    })()
    : await buildTvEpisodes({ parsed, details, title, showSlug, importedAt });

  if (episodes.length === 0) {
    throw new Error(`No VidKing episodes could be built for ${title}.`);
  }

  const artwork = await enrichArtwork({
    mediaType: isMovie ? "movie" : "tv",
    title,
    altTitle: details.original_title ?? details.original_name ?? null,
    yearHint: parseYear(details.release_date ?? details.first_air_date) ?? undefined,
    description: details.overview ?? null,
    currentPosterUrl: tmdbImage(details.poster_path, "w342"),
  });

  return {
    slug: showSlug,
    title,
    altTitle: details.original_title ?? details.original_name ?? null,
    description: details.overview ?? null,
    years: parseYear(details.release_date ?? details.first_air_date),
    mediaType: isMovie ? "movie" : "serial",
    externalIds: {
      imdb: details.imdb_id ?? details.external_ids?.imdb_id ?? undefined,
      tmdb: parsed.tmdbId,
    },
    posterUrl: artwork.posterUrl ?? tmdbImage(details.poster_path, "w342"),
    backdropUrl: artwork.backdropUrl ?? tmdbImage(details.backdrop_path, "w780"),
    bannerUrl: artwork.bannerUrl ?? null,
    bannerWithLogoUrl: artwork.bannerWithLogoUrl ?? null,
    clearLogoUrl: artwork.clearLogoUrl ?? null,
    actors: tmdbCast(details),
    availableSeasons: [...new Set(episodes.map((episode) => episode.seasonNumber))].sort((a, b) => a - b),
    importedAt,
    episodes,
  };
}

export function parseVidkingDirectInput(value: string, mediaType?: "movie" | "serial") {
  const parsed = parseImportSlug(value, mediaType);
  return `${parsed.mediaType}/${parsed.tmdbId}`;
}

void slugify;
