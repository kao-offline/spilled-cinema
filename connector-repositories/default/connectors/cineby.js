const BASE_URL = "https://www.cineby.at";
const API_BASE_URL = "https://db.videasy.to/3";

const MOVIE_GENRES = {
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

const TV_GENRES = {
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

function getFetch(context) {
  return context?.fetch ?? fetch;
}

async function fetchJson(path, context) {
  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;
  const response = await getFetch(context)(url, {
    redirect: "follow",
    headers: {
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`Cineby request failed: ${response.status} ${response.statusText} for ${url}`);
  }
  return await response.json();
}

async function fetchText(url, context) {
  const response = await getFetch(context)(url, {
    redirect: "follow",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`Cineby player request failed: ${response.status} ${response.statusText} for ${url}`);
  }
  return await response.text();
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugify(value) {
  return normalizeText(value).replace(/\s+/g, "-").replace(/^-+|-+$/g, "") || "title";
}

function mediaTypeFromValue(value) {
  return value?.media_type === "tv" || value?.mediaType === "tv" || value?.name ? "serial" : "movie";
}

function apiMediaType(mediaType) {
  return mediaType === "serial" || mediaType === "series" || mediaType === "tv" ? "tv" : "movie";
}

function titleFromValue(value) {
  return value?.title || value?.name || value?.original_title || value?.original_name || "";
}

function releaseDateFromValue(value) {
  return value?.release_date || value?.first_air_date || "";
}

function yearFromValue(value) {
  return releaseDateFromValue(value).match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
}

function tmdbImage(path, size = "w342") {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

function fallbackCinebyPlayerUrl(parsed, details) {
  const imdbId = details?.imdb_id || details?.external_ids?.imdb_id || null;
  if (parsed.routeType === "movie" && imdbId) {
    return `https://www.2embed.cc/embed/${encodeURIComponent(imdbId)}`;
  }
  return `https://www.2embed.skin/embed/${parsed.routeType}/${encodeURIComponent(parsed.tmdbId)}`;
}

async function cinebyPlayerUrl(parsed, details, context) {
  const fallbackUrl = fallbackCinebyPlayerUrl(parsed, details);
  try {
    const html = await fetchText(`https://www.2embed.skin/embed/${parsed.routeType}/${encodeURIComponent(parsed.tmdbId)}`, context);
    const swishId = html.match(/streamsrcs\.2embed\.cc\/swish\?id=([^&"'\\)]+)/i)?.[1];
    if (swishId) {
      return `https://lookmovie2.skin/e/${encodeURIComponent(swishId)}`;
    }
  } catch {
    // Fall back to the wrapper player when the resolver page is unavailable.
  }
  return fallbackUrl;
}

function cinebyPathFromValue(value) {
  const mediaType = mediaTypeFromValue(value);
  const routeType = mediaType === "serial" ? "tv" : "movie";
  const title = titleFromValue(value);
  return `/${routeType}/${value.id}/${slugify(title)}`;
}

function normalizeImportSlug(value, mediaType) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw, BASE_URL);
    const parts = url.pathname.split("/").filter(Boolean);
    const typeIndex = parts.findIndex((part) => part === "movie" || part === "tv");
    if (typeIndex >= 0 && parts[typeIndex + 1]) {
      return `${parts[typeIndex]}/${parts[typeIndex + 1]}/${parts[typeIndex + 2] || ""}`.replace(/\/+$/, "");
    }
  } catch {
    // Fall through to path parsing.
  }
  const trimmed = raw.replace(/^\/+|\/+$/g, "");
  if (/^(movie|tv)\/\d+/i.test(trimmed)) return trimmed;
  if (/^\d+$/.test(trimmed)) return `${apiMediaType(mediaType)}/${trimmed}`;
  return trimmed;
}

function parseImportSlug(slug, mediaType) {
  const normalized = normalizeImportSlug(slug, mediaType);
  const match = normalized?.match(/^(movie|tv)\/(\d+)(?:\/([^/?#]+))?/i);
  if (!match) {
    throw new Error("Provide a valid Cineby movie or TV slug.");
  }
  return {
    routeType: match[1].toLowerCase(),
    tmdbId: match[2],
    titleSlug: match[3] || "",
  };
}

function scoreSearchCandidate(query, fields, index = 0) {
  const q = normalizeText(query);
  if (!q) return 0;
  const tokens = q.split(/\s+/).filter(Boolean);
  const haystack = fields.map(normalizeText).join(" ");
  if (!haystack) return 0;
  let score = Math.max(0, 100 - index);
  if (haystack === q) score += 500;
  if (haystack.includes(q)) score += 220;
  for (const token of tokens) {
    if (haystack.includes(token)) score += 80;
  }
  return tokens.some((token) => haystack.includes(token)) ? score : 0;
}

function createItem(value, sectionKey = "popular", index = 0, query = "") {
  const title = titleFromValue(value);
  if (!value?.id || !title) return null;
  const mediaType = mediaTypeFromValue(value);
  const detailPath = cinebyPathFromValue(value);
  const genres = (value.genre_ids || value.genres || [])
    .map((genre) => typeof genre === "object" ? genre.name : (mediaType === "serial" ? TV_GENRES[genre] : MOVIE_GENRES[genre]))
    .filter(Boolean);
  const year = yearFromValue(value);
  return {
    id: `cineby:${mediaType}:${value.id}:${sectionKey}`,
    title,
    slug: detailPath.replace(/^\/+/, ""),
    importSlug: detailPath.replace(/^\/+/, ""),
    provider: "cineby",
    mediaType,
    detailUrl: `${BASE_URL}${detailPath}`,
    posterUrl: value.poster || tmdbImage(value.poster_path, "w342"),
    backdropUrl: value.image || value.background || tmdbImage(value.backdrop_path, "w780"),
    year,
    yearLabel: year,
    description: value.overview || null,
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
  };
}

function candidateFromItem(item) {
  const year = item.year?.match(/\b(19|20)\d{2}\b/)?.[0];
  return {
    integrationId: "cineby",
    providerItemId: item.importSlug || item.slug,
    mediaType: item.mediaType === "movie" ? "movie" : "series",
    title: item.title,
    year: year ? Number.parseInt(year, 10) : undefined,
    sourceUrl: item.detailUrl,
    posterUrl: item.posterUrl,
    externalIds: {
      tmdb: item.slug.match(/\b\d+\b/)?.[0],
    },
    confidenceHints: {
      normalizedTitle: normalizeText(item.title),
      releaseDate: item.year ?? undefined,
    },
  };
}

function titleFromImportSlug(importSlug) {
  return importSlug
    .split("/")
    .pop()
    ?.replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim() || "Cineby title";
}

async function fetchDetails(slug, mediaType, context) {
  const parsed = parseImportSlug(slug, mediaType);
  const details = await fetchJson(`/${parsed.routeType}/${parsed.tmdbId}?append_to_response=external_ids,credits`, context);
  const title = titleFromValue(details) || titleFromImportSlug(slug);
  const path = `/${parsed.routeType}/${parsed.tmdbId}/${parsed.titleSlug || slugify(title)}`;
  return { parsed, details, title, path };
}

export async function getFeed({ feedId = "default", cursor = "1", limit = 24 }, context) {
  if (feedId !== "default" && feedId !== "trending") {
    throw new Error(`Unsupported Cineby feed "${feedId}".`);
  }
  const page = Math.max(1, Number.parseInt(String(cursor ?? "1"), 10) || 1);
  const payload = await fetchJson(`/trending/all/day?language=en-US&page=${page}`, context);
  const items = (payload.results || [])
    .filter((item) => item.media_type === "movie" || item.media_type === "tv")
    .map((item, index) => createItem(item, "popular", index))
    .filter(Boolean)
    .slice(0, Math.max(1, limit));
  return {
    generatedAt: Date.now(),
    stale: false,
    moduleId: "cineby",
    feedId,
    items,
    continueCursor: items.length >= limit && page < (payload.total_pages || page) ? String(page + 1) : null,
  };
}

export async function search({ query, limit = 12 }, context) {
  const q = String(query || "").trim();
  if (!q) return [];
  const payload = await fetchJson(`/search/multi?query=${encodeURIComponent(q)}&page=1&language=en-US`, context);
  return (payload.results || [])
    .filter((item) => item.media_type === "movie" || item.media_type === "tv")
    .map((item, index) => createItem(item, "popular", index, q))
    .filter((item) => item && (item.matchScore ?? 0) > 0)
    .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))
    .slice(0, Math.max(1, limit));
}

export async function importItem({ slug, mediaType }, context) {
  const { parsed, details, title, path } = await fetchDetails(slug, mediaType, context);
  const importedAt = Date.now();
  const showSlug = `cineby-${parsed.routeType}-${parsed.tmdbId}`;
  const year = yearFromValue(details);
  const isMovie = parsed.routeType === "movie";
  const seasons = isMovie
    ? [1]
    : (details.seasons || [])
      .map((season) => season.season_number)
      .filter((season) => Number.isFinite(season) && season > 0);
  const detailUrl = `${BASE_URL}${path}`;
  const playerUrl = await cinebyPlayerUrl(parsed, details, context);
  const episode = {
    id: `${showSlug}:s1e1`,
    showSlug,
    showTitle: title,
    posterUrl: tmdbImage(details.poster_path, "w342") ?? undefined,
    seasonNumber: 1,
    episodeNumber: isMovie ? null : 1,
    episodeCode: isMovie ? "movie" : "s1e1",
    episodeTitle: isMovie ? title : null,
    episodeUrl: detailUrl,
    players: [{
      alias: "cineby-player",
      provider: "cineby",
      label: "Cineby Player",
      sourcePageUrl: detailUrl,
      embedUrl: playerUrl,
    }],
    selectedPlayerAlias: "cineby-player",
    importedAt,
  };

  return {
    slug: showSlug,
    title,
    altTitle: details.original_title || details.original_name || null,
    description: details.overview || null,
    years: year,
    mediaType: isMovie ? "movie" : "serial",
    externalIds: {
      imdb: details.imdb_id || details.external_ids?.imdb_id || undefined,
      tmdb: String(parsed.tmdbId),
    },
    posterUrl: tmdbImage(details.poster_path, "w342"),
    backdropUrl: tmdbImage(details.backdrop_path, "w780"),
    clearLogoUrl: null,
    availableSeasons: seasons.length ? seasons : [1],
    importedAt,
    episodes: [episode],
  };
}

export const integration = {
  apiVersion: 2,
  search: async ({ query, limit }, context) => (await search({ query, limit }, context)).map(candidateFromItem),
  getFeed: async ({ feedId, cursor, limit }, context) => await getFeed({ feedId, cursor, limit }, context),
  importFallback: async ({ slug, mediaType }, context) => await importItem({ slug, mediaType }, context),
  resolvePlayers: async ({ providerMatch }, context) => {
    if (!providerMatch?.providerItemId) return [];
    const { parsed, details, path } = await fetchDetails(providerMatch.providerItemId, undefined, context);
    return [{
      integrationId: "cineby",
      label: "Cineby Player",
      url: await cinebyPlayerUrl(parsed, details, context),
      type: "embed",
      sourcePageUrl: `${BASE_URL}${path}`,
    }];
  },
};
