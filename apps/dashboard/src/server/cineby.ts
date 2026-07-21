import type { CastMember, EpisodePlayer, ExploreItem, ImportedShow, LibraryEpisode } from "../lib/types";
import {
  compareSearchScores,
  keepHighConfidenceSearchResults,
  scoreSearchCandidate,
} from "../lib/search-ranking";

const BASE_URL = "https://www.cineby.at";
const API_BASE_URL = "https://db.videasy.to/3";

const MOVIE_GENRES: Record<number, string> = {
  28: "Action",
  12: "Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  14: "Fantasy",
  36: "History",
  27: "Horror",
  10402: "Music",
  9648: "Mystery",
  10749: "Romance",
  878: "Science Fiction",
  10770: "TV Movie",
  53: "Thriller",
  10752: "War",
  37: "Western",
};

const TV_GENRES: Record<number, string> = {
  10759: "Action & Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  10762: "Kids",
  9648: "Mystery",
  10763: "News",
  10764: "Reality",
  10765: "Sci-Fi & Fantasy",
  10766: "Soap",
  10767: "Talk",
  10768: "War & Politics",
  37: "Western",
};

type CinebyMedia = {
  id?: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  poster?: string | null;
  image?: string | null;
  background?: string | null;
  media_type?: "movie" | "tv" | string;
  release_date?: string;
  first_air_date?: string;
  original_language?: string;
  genre_ids?: number[];
  genres?: Array<{ id?: number; name?: string }>;
  seasons?: Array<{ season_number?: number }>;
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
};

async function fetchCinebyJson<T>(path: string): Promise<T> {
  const response = await fetch(path.startsWith("http") ? path : `${API_BASE_URL}${path}`, {
    redirect: "follow",
    headers: {
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`Cineby request failed: ${response.status} ${response.statusText}`);
  }
  return await response.json() as T;
}

async function fetchCinebyText(url: string): Promise<string> {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`Cineby player request failed: ${response.status} ${response.statusText}`);
  }
  return await response.text();
}

function normalizeText(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugify(value: string) {
  return normalizeText(value).replace(/\s+/g, "-").replace(/^-+|-+$/g, "") || "title";
}

function titleFromValue(value: CinebyMedia) {
  return value.title || value.name || value.original_title || value.original_name || "";
}

function mediaTypeFromValue(value: CinebyMedia) {
  return value.media_type === "tv" || (!value.title && Boolean(value.name)) ? "serial" as const : "movie" as const;
}

function yearFromValue(value: CinebyMedia) {
  return (value.release_date || value.first_air_date || "").match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
}

function tmdbImage(path: string | null | undefined, size = "w342") {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

function tmdbCast(details: CinebyMedia): CastMember[] {
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

function fallbackCinebyPlayerUrl(parsed: { routeType: "movie" | "tv"; tmdbId: string }, details: CinebyMedia) {
  const imdbId = details.imdb_id ?? details.external_ids?.imdb_id ?? null;
  if (parsed.routeType === "movie" && imdbId) {
    return `https://www.2embed.cc/embed/${encodeURIComponent(imdbId)}`;
  }
  return `https://www.2embed.skin/embed/${parsed.routeType}/${encodeURIComponent(parsed.tmdbId)}`;
}

async function cinebyPlayerUrl(parsed: { routeType: "movie" | "tv"; tmdbId: string }, details: CinebyMedia) {
  const fallbackUrl = fallbackCinebyPlayerUrl(parsed, details);
  try {
    const html = await fetchCinebyText(`https://www.2embed.skin/embed/${parsed.routeType}/${encodeURIComponent(parsed.tmdbId)}`);
    const swishId = html.match(/streamsrcs\.2embed\.cc\/swish\?id=([^&"'\\)]+)/i)?.[1];
    if (swishId) {
      return `https://lookmovie2.skin/e/${encodeURIComponent(swishId)}`;
    }
  } catch {
    // Fall back to the wrapper player when the resolver page is unavailable.
  }
  return fallbackUrl;
}

function detailPathFromValue(value: CinebyMedia) {
  const mediaType = mediaTypeFromValue(value);
  const routeType = mediaType === "serial" ? "tv" : "movie";
  return `/${routeType}/${value.id}/${slugify(titleFromValue(value))}`;
}

function normalizeImportSlug(value: string, mediaType?: "movie" | "serial") {
  const raw = value.trim();
  try {
    const url = new URL(raw, BASE_URL);
    const parts = url.pathname.split("/").filter(Boolean);
    const routeIndex = parts.findIndex((part) => part === "movie" || part === "tv");
    if (routeIndex >= 0 && parts[routeIndex + 1]) {
      return parts.slice(routeIndex, routeIndex + 3).join("/");
    }
  } catch {
    // Plain slugs are parsed below.
  }
  const trimmed = raw.replace(/^\/+|\/+$/g, "");
  if (/^(movie|tv)\/\d+/i.test(trimmed)) return trimmed;
  if (/^\d+$/.test(trimmed)) return `${mediaType === "serial" ? "tv" : "movie"}/${trimmed}`;
  return trimmed;
}

function parseImportSlug(value: string, mediaType?: "movie" | "serial") {
  const normalized = normalizeImportSlug(value, mediaType);
  const match = normalized.match(/^(movie|tv)\/(\d+)(?:\/([^/?#]+))?/i);
  if (!match) {
    throw new Error("Provide a valid Cineby movie or TV slug.");
  }
  return {
    routeType: match[1].toLowerCase() as "movie" | "tv",
    tmdbId: match[2],
    titleSlug: match[3] ?? "",
  };
}

function isExploreItem(value: ExploreItem | null): value is ExploreItem {
  return value !== null;
}

function createCinebyItem(value: CinebyMedia, sectionKey: "popular" | "newest" | "topOverall", index: number, query?: string): ExploreItem | null {
  const title = titleFromValue(value);
  if (!value.id || !title) {
    return null;
  }
  const mediaType = mediaTypeFromValue(value);
  const detailPath = detailPathFromValue(value);
  const year = yearFromValue(value);
  const genreSource = value.genre_ids ?? value.genres?.map((genre) => genre.id).filter((id): id is number => Number.isFinite(id)) ?? [];
  const genres = genreSource.map((id) => (mediaType === "serial" ? TV_GENRES[id] : MOVIE_GENRES[id])).filter(Boolean);
  return {
    id: `cineby:${mediaType}:${value.id}:${sectionKey}`,
    title,
    slug: detailPath.replace(/^\/+/, ""),
    importSlug: detailPath.replace(/^\/+/, ""),
    provider: "cineby" as const,
    mediaType,
    detailUrl: `${BASE_URL}${detailPath}`,
    posterUrl: value.poster ?? tmdbImage(value.poster_path, "w342"),
    backdropUrl: value.image ?? value.background ?? tmdbImage(value.backdrop_path, "w780"),
    year,
    yearLabel: year,
    description: value.overview ?? null,
    genres,
    audioBuckets: ["all"],
    languages: value.original_language ? [value.original_language] : [],
    network: null,
    directors: [],
    actors: [],
    sectionKeys: [sectionKey],
    inVault: false,
    availableNow: true,
    matchScore: query ? scoreSearchCandidate(query, [title, value.original_title, value.name, value.original_name, year], index) : undefined,
    discoveryScore: Math.max(0, 1000 - index),
    recommendationReasons: [],
  } satisfies ExploreItem;
}

async function fetchCinebyDetails(slug: string, mediaType?: "movie" | "serial") {
  const parsed = parseImportSlug(slug, mediaType);
  const details = await fetchCinebyJson<CinebyMedia>(`/${parsed.routeType}/${parsed.tmdbId}?append_to_response=external_ids,credits`);
  const title = titleFromValue(details) || parsed.titleSlug.replace(/-/g, " ") || "Cineby title";
  const path = `/${parsed.routeType}/${parsed.tmdbId}/${parsed.titleSlug || slugify(title)}`;
  return { parsed, details, title, path };
}

export async function searchCineby(query: string) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return [];
  }
  const payload = await fetchCinebyJson<{ results?: CinebyMedia[] }>(
    `/search/multi?query=${encodeURIComponent(normalizedQuery)}&page=1&language=en-US`,
  );
  return keepHighConfidenceSearchResults(
    (payload.results ?? [])
      .filter((item) => item.media_type === "movie" || item.media_type === "tv")
      .map((item, index) => createCinebyItem(item, "popular", index, normalizedQuery))
      .filter(isExploreItem)
      .filter((item) => (item.matchScore ?? 0) > 0)
      .sort(compareSearchScores),
  ).slice(0, 12);
}

export async function loadCinebyFeed(feedId: string, args: { cursor?: string | null; limit?: number }) {
  if (feedId !== "default" && feedId !== "trending") {
    throw new Error(`Unsupported Cineby feed "${feedId}".`);
  }
  const limit = Math.max(1, args.limit ?? 24);
  const page = Math.max(1, Number.parseInt(String(args.cursor ?? "1"), 10) || 1);
  const payload = await fetchCinebyJson<{ results?: CinebyMedia[]; total_pages?: number }>(
    `/trending/all/day?language=en-US&page=${page}`,
  );
  const items = (payload.results ?? [])
    .filter((item) => item.media_type === "movie" || item.media_type === "tv")
    .map((item, index) => createCinebyItem(item, "popular", index))
    .filter(isExploreItem)
    .slice(0, limit);

  return {
    generatedAt: Date.now(),
    stale: false,
    moduleId: "cineby",
    feedId,
    items,
    continueCursor: items.length >= limit && page < (payload.total_pages ?? page) ? String(page + 1) : null,
  };
}

export async function fetchCinebyTitle(slug: string, mediaType?: "movie" | "serial"): Promise<ImportedShow> {
  const { parsed, details, title, path } = await fetchCinebyDetails(slug, mediaType);
  const importedAt = Date.now();
  const isMovie = parsed.routeType === "movie";
  const showSlug = `cineby-${parsed.routeType}-${parsed.tmdbId}`;
  const detailUrl = `${BASE_URL}${path}`;
  const playerUrl = await cinebyPlayerUrl(parsed, details);
  const player: EpisodePlayer = {
    alias: "cineby-player",
    provider: "cineby",
    label: "Cineby Player",
    sourcePageUrl: detailUrl,
    embedUrl: playerUrl,
  };
  const episode: LibraryEpisode = {
    id: `${showSlug}:s1e1`,
    showSlug,
    showTitle: title,
    posterUrl: tmdbImage(details.poster_path, "w342") ?? undefined,
    seasonNumber: 1,
    episodeNumber: isMovie ? null : 1,
    episodeCode: isMovie ? "movie" : "s1e1",
    episodeTitle: isMovie ? title : null,
    episodeUrl: detailUrl,
    players: [player],
    selectedPlayerAlias: player.alias,
    importedAt,
  };
  const seasons = isMovie
    ? [1]
    : (details.seasons ?? [])
      .map((season) => season.season_number)
      .filter((season): season is number => typeof season === "number" && Number.isFinite(season) && season > 0);

  return {
    slug: showSlug,
    title,
    altTitle: details.original_title ?? details.original_name ?? null,
    description: details.overview ?? null,
    years: yearFromValue(details),
    mediaType: isMovie ? "movie" : "serial",
    externalIds: {
      imdb: details.imdb_id ?? details.external_ids?.imdb_id ?? undefined,
      tmdb: parsed.tmdbId,
    },
    posterUrl: tmdbImage(details.poster_path, "w342"),
    backdropUrl: tmdbImage(details.backdrop_path, "w780"),
    clearLogoUrl: null,
    actors: tmdbCast(details),
    availableSeasons: seasons.length > 0 ? seasons : [1],
    importedAt,
    episodes: [episode],
  };
}
