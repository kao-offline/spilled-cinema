import type { CastMember, ImportedShow, LibraryEpisode, PersonCredit } from "./types";
import type { ArtworkSourceSettings } from "./types";
import { requestRuntimeJson } from "./local-api";
import type { IntegrationId } from "./integrations";
import { readIntegrationUserKeys, readSvetSerialuCredentials } from "./integration-user-config";
import { readProviderRepositoryUrls } from "./provider-feed-storage";

export type ArtworkAsset = {
  url: string;
  kind: "poster" | "banner" | "logo" | "wlogo-banner";
  source: "current" | "tmdb" | "fanart" | "tvdb";
  label: string;
  language?: string | null;
  width?: number | null;
  score?: number | null;
  hasText?: boolean | null;
};

type ArtworkMediaType = "movie" | "tv";

export const HOMEPAGE_ARTWORK_VERSION = 6;

export type RemoteAvailability = "available" | "checking" | "unavailable" | "unknown" | "verifying";

export type VidkingAvailabilityItem = {
  importSlug: string;
  mediaType?: "movie" | "serial";
};

export type VidkingAvailabilityResult = {
  importSlug: string;
  mediaType: "movie" | "serial";
  availability: Exclude<RemoteAvailability, "checking">;
  detailUrl: string;
  checkedAt: number;
  reason?: string | null;
  verifying?: boolean;
};

const VIDKING_AVAILABILITY_CACHE_PREFIX = "spilled.vidking-availability.v1";
let searchRuntimeBackoffUntil = 0;
let warnedSearchRuntimeUnavailable = false;
const SEARCH_CACHE_TTL_MS = 45_000;
const SEARCH_CACHE_MAX = 100;
const searchCache = new Map<string, { expiresAt: number; results: Awaited<ReturnType<typeof requestRemoteSearch>> }>();
const searchInflight = new Map<string, Promise<Awaited<ReturnType<typeof requestRemoteSearch>>>>();

function parseYearHint(value: string | null | undefined) {
  const match = value?.match(/\b(19|20)\d{2}\b/);
  return match?.[0] ?? null;
}

function readArtworkApiKeys() {
  const keys = readIntegrationUserKeys();
  return {
    tmdbApiKey: keys.tmdb?.trim() || undefined,
    fanartApiKey: keys.fanart?.trim() || undefined,
    tvdbApiKey: keys.tvdb?.trim() || undefined,
  };
}

function inferArtworkMediaType(show: ImportedShow) {
  return show.mediaType === "movie" || (show.episodes.length === 1 && show.episodes[0]?.episodeCode === "movie")
    ? "movie"
    : "tv";
}

function shouldRepairArtworkIdentity(show: ImportedShow) {
  return show.episodes.length === 1 && show.mediaType !== "movie";
}

function alternateArtworkMediaType(mediaType: ArtworkMediaType): ArtworkMediaType {
  return mediaType === "movie" ? "tv" : "movie";
}

function buildArtworkRequestBody(
  show: ImportedShow,
  sources: ArtworkSourceSettings,
  mediaType: ArtworkMediaType,
  searchTitle?: string,
) {
  const title = searchTitle?.trim() || show.title;
  return {
    title,
    altTitle: show.altTitle ?? null,
    years: show.years ?? null,
    yearHint: parseYearHint(title) ?? parseYearHint(show.years),
    description: show.description ?? null,
    posterUrl: show.posterUrl ?? null,
    backdropUrl: show.artwork?.bannerUrl ?? show.artwork?.backdropUrl ?? show.backdropUrl ?? show.bannerUrl ?? null,
    bannerUrl: show.artwork?.bannerUrl ?? show.artwork?.backdropUrl ?? show.backdropUrl ?? show.bannerUrl ?? null,
    bannerWithLogoUrl: show.artwork?.bannerWithLogoUrl ?? show.homepageBannerUrl ?? null,
    clearLogoUrl: show.clearLogoUrl ?? null,
    externalIds: show.externalIds ?? null,
    mediaType,
    artworkSources: sources,
    artworkApiKeys: readArtworkApiKeys(),
  };
}

function externalArtworkAssetCount(assets: ArtworkAsset[]) {
  return assets.filter((asset) => asset.source !== "current").length;
}

function mergeArtworkAssets(left: ArtworkAsset[], right: ArtworkAsset[]) {
  const seen = new Set<string>();
  return [...left, ...right].filter((asset) => {
    const key = `${asset.kind}:${asset.url}`;
    if (!asset.url || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function artworkBundleScore(artwork: {
  posterUrl?: string | null;
  backdropUrl?: string | null;
  bannerUrl?: string | null;
  clearLogoUrl?: string | null;
  bannerWithLogoUrl?: string | null;
}, show: ImportedShow) {
  let score = 0;
  if (artwork.posterUrl && artwork.posterUrl !== show.posterUrl) score += 1;
  if (artwork.backdropUrl && artwork.backdropUrl !== show.backdropUrl) score += 1;
  if (artwork.bannerUrl && artwork.bannerUrl !== show.bannerUrl) score += 1;
  if (artwork.clearLogoUrl && artwork.clearLogoUrl !== show.clearLogoUrl) score += 1;
  if (artwork.bannerWithLogoUrl && artwork.bannerWithLogoUrl !== show.artwork?.bannerWithLogoUrl) score += 1;
  return score;
}

export async function importSvetSerialuShow(slug: string) {
  const response = await requestRuntimeJson<{
    show?: ImportedShow;
    error?: string;
  }>("/api/import-svetserialu", {
    method: "POST",
    body: {
      slug,
      svetserialuCredentials: readSvetSerialuCredentials(),
    },
  });
  if (!response.ok || !response.data?.show) {
    throw new Error(response.data?.error ?? "Failed to import show.");
  }
  return response.data.show;
}

export async function importBombujMovie(slug: string, mediaType?: "movie" | "serial") {
  const response = await requestRuntimeJson<{
    show?: ImportedShow;
    error?: string;
  }>("/api/import-bombuj", {
    method: "POST",
    body: { slug, mediaType },
  });
  if (!response.ok || !response.data?.show) {
    throw new Error(response.data?.error ?? "Failed to import movie from bombuj.si.");
  }
  return response.data.show;
}

export async function importProviderItem(
  moduleId: IntegrationId,
  slug: string,
  mediaType?: "movie" | "serial",
  artworkSources?: ArtworkSourceSettings,
) {
  const response = await requestRuntimeJson<{
    show?: ImportedShow;
    error?: string;
  }>("/api/provider-import", {
    method: "POST",
    body: {
      moduleId,
      slug,
      mediaType,
      repositoryUrls: readProviderRepositoryUrls(),
      svetserialuCredentials: moduleId === "svetserialu" ? readSvetSerialuCredentials() : undefined,
      artworkSources,
      artworkApiKeys: readArtworkApiKeys(),
    },
  });
  if (!response.ok || !response.data?.show) {
    throw new Error(response.data?.error ?? "Failed to import provider item.");
  }
  return response.data.show;
}

async function requestRemoteSearch(query: string) {
  const response = await requestRuntimeJson<{
    results?: {
      title: string;
      slug: string;
      platform: IntegrationId;
      posterUrl?: string | null;
      mediaType?: "movie" | "serial";
      year?: string | null;
      alternateTitles?: string[];
      description?: string | null;
      genres?: string[];
      csfdRating?: string | number | null;
      actors?: string[];
      directors?: string[];
      detailUrl?: string | null;
      availability?: RemoteAvailability;
      availabilityReason?: string | null;
      matchScore?: number;
      searchSignals?: {
        source?: "tmdb" | "imdb" | "tvmaze" | "wikidata" | "provider";
        popularity?: number | null;
        voteCount?: number | null;
        voteAverage?: number | null;
        releaseDate?: string | null;
        originalLanguage?: string | null;
      };
    }[];
    error?: string;
  }>("/api/search", {
    method: "POST",
    body: {
      query,
      svetserialuCredentials: readSvetSerialuCredentials(),
    },
  });

  if (!response.ok) {
    throw new Error(`Search failed with status ${response.status}`);
  }
  if (!response.data?.results) {
    throw new Error(response.data?.error ?? "Failed to search.");
  }
  return response.data.results;
}

export async function searchRemotes(query: string) {
  if (Date.now() < searchRuntimeBackoffUntil) {
    return [];
  }

  const cacheKey = query.toLowerCase().trim().replace(/\s+/g, " ");
  if (cacheKey.length < 2) return [];
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.results;
  const pending = searchInflight.get(cacheKey);
  if (pending) return pending;

  try {
    const request = requestRemoteSearch(query.trim())
      .then((results) => {
        searchCache.set(cacheKey, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, results });
        if (searchCache.size > SEARCH_CACHE_MAX) {
          const oldestKey = searchCache.keys().next().value as string | undefined;
          if (oldestKey) searchCache.delete(oldestKey);
        }
        return results;
      })
      .finally(() => searchInflight.delete(cacheKey));
    searchInflight.set(cacheKey, request);
    return await request;
  } catch (error) {
    // Return empty results on any error to gracefully degrade
    const message = error instanceof Error ? error.message : String(error);
    if (/No runtime or fetch server is available|ERR_CONNECTION_REFUSED|Failed to fetch/i.test(message)) {
      searchRuntimeBackoffUntil = Date.now() + 60_000;
      if (!warnedSearchRuntimeUnavailable) {
        console.warn("Search unavailable; backing off until a runtime or fetch server is available.");
        warnedSearchRuntimeUnavailable = true;
      }
      return [];
    }
    console.warn("Search failed:", message);
    return [];
  }
}

function vidkingAvailabilityCacheKey(item: VidkingAvailabilityItem) {
  return `${VIDKING_AVAILABILITY_CACHE_PREFIX}:${item.mediaType ?? "unknown"}:${item.importSlug}`;
}

function vidkingAvailabilityTtl(availability: VidkingAvailabilityResult["availability"]) {
  if (availability === "available") return 6 * 60 * 60 * 1000;
  if (availability === "unavailable") return 30 * 60 * 1000;
  if (availability === "verifying") return 5 * 60 * 1000;
  return 5 * 60 * 1000;
}

function readCachedVidkingAvailability(item: VidkingAvailabilityItem) {
  if (typeof localStorage === "undefined") {
    return null;
  }
  try {
    const raw = localStorage.getItem(vidkingAvailabilityCacheKey(item));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<VidkingAvailabilityResult>;
    if (
      typeof parsed.importSlug !== "string" ||
      (parsed.availability !== "available" &&
        parsed.availability !== "unavailable" &&
        parsed.availability !== "unknown" &&
        parsed.availability !== "verifying") ||
      typeof parsed.checkedAt !== "number"
    ) {
      return null;
    }
    if (Date.now() - parsed.checkedAt > vidkingAvailabilityTtl(parsed.availability)) {
      localStorage.removeItem(vidkingAvailabilityCacheKey(item));
      return null;
    }
    return parsed as VidkingAvailabilityResult;
  } catch {
    return null;
  }
}

function writeCachedVidkingAvailability(result: VidkingAvailabilityResult) {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(vidkingAvailabilityCacheKey(result), JSON.stringify(result));
  } catch {
    // Cache failure should not block search.
  }
}

export async function checkVidkingAvailability(items: VidkingAvailabilityItem[]) {
  const unique = new Map<string, VidkingAvailabilityItem>();
  for (const item of items) {
    const importSlug = item.importSlug.trim();
    if (!importSlug) continue;
    unique.set(`${item.mediaType ?? "unknown"}:${importSlug}`, { ...item, importSlug });
  }

  const cached: VidkingAvailabilityResult[] = [];
  const missing: VidkingAvailabilityItem[] = [];
  for (const item of unique.values()) {
    const hit = readCachedVidkingAvailability(item);
    if (hit) cached.push(hit);
    else missing.push(item);
  }

  if (missing.length === 0) {
    return cached;
  }

  const response = await requestRuntimeJson<{
    results?: VidkingAvailabilityResult[];
    error?: string;
  }>("/api/vidking/availability", {
    method: "POST",
    body: { items: missing },
  });

  const fresh = response.ok && response.data?.results ? response.data.results : [];
  for (const result of fresh) {
    writeCachedVidkingAvailability(result);
  }
  return [...cached, ...fresh];
}

export async function refreshArtworkForShow(
  show: ImportedShow,
  sources: ArtworkSourceSettings,
) {
  const requestRefresh = (mediaType: ArtworkMediaType) => requestRuntimeJson<{
    artwork?: {
      posterUrl?: string | null;
      backdropUrl?: string | null;
      bannerUrl?: string | null;
      clearLogoUrl?: string | null;
      bannerWithLogoUrl?: string | null;
    };
    error?: string;
  }>("/api/artwork/refresh", {
    method: "POST",
    body: {
      slug: show.slug,
      ...buildArtworkRequestBody(show, sources, mediaType),
    },
  });

  const primaryMediaType = inferArtworkMediaType(show);
  const response = await requestRefresh(primaryMediaType);
  if (!response.ok || !response.data?.artwork) {
    throw new Error(response.data?.error ?? `Failed to refresh artwork for ${show.title}.`);
  }

  if (shouldRepairArtworkIdentity(show)) {
    const alternateResponse = await requestRefresh(alternateArtworkMediaType(primaryMediaType));
    const alternateArtwork = alternateResponse.data?.artwork;
    if (alternateResponse.ok && alternateArtwork) {
      return artworkBundleScore(alternateArtwork, show) > artworkBundleScore(response.data.artwork, show)
        ? alternateArtwork
        : response.data.artwork;
    }
  }

  return response.data.artwork;
}

export async function fetchCastForShow(show: ImportedShow) {
  const response = await requestRuntimeJson<{
    actors?: CastMember[];
    error?: string;
  }>("/api/artwork/cast", {
    method: "POST",
    body: {
      title: show.title,
      altTitle: show.altTitle ?? null,
      yearHint: parseYearHint(show.title) ?? parseYearHint(show.slug) ?? parseYearHint(show.years),
      description: show.description ?? null,
      externalIds: show.externalIds ?? null,
      mediaType: inferArtworkMediaType(show),
      artworkApiKeys: readArtworkApiKeys(),
    },
  });

  if (!response.ok) {
    throw new Error(response.data?.error ?? `Failed to fetch cast for ${show.title}.`);
  }

  return response.data?.actors ?? [];
}

export type EnrichedTitleMetadata = {
  description?: string | null;
  year?: string | null;
  runtimeMinutes?: number | null;
  seasonCount?: number | null;
  episodeCount?: number | null;
  genres?: string[] | null;
  csfdRating?: string | number | null;
  episodeTitle?: string | null;
  episodeDescription?: string | null;
  episodeRuntimeMinutes?: number | null;
  episodeYear?: string | null;
};

export async function fetchTitleMetadataForShow(show: ImportedShow, episode?: LibraryEpisode | null): Promise<EnrichedTitleMetadata | null> {
  const response = await requestRuntimeJson<{
    metadata?: {
      description?: string | null;
      year?: string | null;
      runtimeMinutes?: number | null;
      seasonCount?: number | null;
      episodeCount?: number | null;
      genres?: string[];
      ratingPercent?: number | null;
      episodeTitle?: string | null;
      episodeDescription?: string | null;
      episodeRuntimeMinutes?: number | null;
      episodeYear?: string | null;
    } | null;
    error?: string;
  }>("/api/artwork/title-metadata", {
    method: "POST",
    body: {
      title: show.title,
      altTitle: show.altTitle ?? null,
      yearHint: parseYearHint(show.title) ?? parseYearHint(show.years),
      description: show.description ?? null,
      externalIds: show.externalIds ?? null,
      mediaType: inferArtworkMediaType(show),
      seasonNumber: episode?.seasonNumber ?? null,
      episodeNumber: episode?.episodeNumber ?? null,
      artworkApiKeys: readArtworkApiKeys(),
    },
  });

  if (!response.ok) throw new Error(response.data?.error ?? `Failed to fetch metadata for ${show.title}.`);
  const metadata = response.data?.metadata;
  if (!metadata) return null;
  return {
    ...metadata,
    csfdRating: metadata.ratingPercent,
  };
}

export async function fetchPersonCredits(name: string) {
  const response = await requestRuntimeJson<{
    credits?: PersonCredit[];
    error?: string;
  }>("/api/artwork/person-credits", {
    method: "POST",
    body: {
      name,
      artworkApiKeys: readArtworkApiKeys(),
    },
  });

  if (!response.ok) {
    throw new Error(response.data?.error ?? `Failed to fetch credits for ${name}.`);
  }

  return response.data?.credits ?? [];
}

export async function searchArtworkAssetsForShow(
  show: ImportedShow,
  sources: ArtworkSourceSettings,
  searchTitle?: string,
) {
  const requestAssets = (mediaType: ArtworkMediaType) => requestRuntimeJson<{
    assets?: ArtworkAsset[];
    error?: string;
  }>("/api/artwork/search", {
    method: "POST",
    body: buildArtworkRequestBody(show, sources, mediaType, searchTitle),
  });

  const primaryMediaType = inferArtworkMediaType(show);
  const response = await requestAssets(primaryMediaType);
  if (!response.ok || !response.data?.assets) {
    throw new Error(response.data?.error ?? `Failed to load artwork options for ${show.title}.`);
  }

  if (shouldRepairArtworkIdentity(show)) {
    const alternateResponse = await requestAssets(alternateArtworkMediaType(primaryMediaType));
    const alternateAssets = alternateResponse.data?.assets;
    const primaryExternalCount = externalArtworkAssetCount(response.data.assets);
    const alternateExternalCount = externalArtworkAssetCount(alternateAssets ?? []);
    if (alternateResponse.ok && alternateAssets && alternateExternalCount > primaryExternalCount) {
      return mergeArtworkAssets(alternateAssets, response.data.assets);
    }
  }

  return response.data.assets;
}

function artworkLanguageScore(asset: ArtworkAsset) {
  const language = asset.language?.trim().toLowerCase();
  if (!language) return 2;
  if (language === "en" || language === "eng") return 4;
  if (language === "cs" || language === "ces" || language === "sk" || language === "slk") return 3;
  return 1;
}

function sortHomepageArtworkAssets(assets: ArtworkAsset[]) {
  return [...assets].sort((left, right) => {
    const leftSourceScore = left.source === "current" ? 0 : 2;
    const rightSourceScore = right.source === "current" ? 0 : 2;
    if (leftSourceScore !== rightSourceScore) return rightSourceScore - leftSourceScore;
    const leftTextScore = left.hasText === true ? 2 : left.hasText === null ? 1 : 0;
    const rightTextScore = right.hasText === true ? 2 : right.hasText === null ? 1 : 0;
    if (leftTextScore !== rightTextScore) return rightTextScore - leftTextScore;
    const languageDelta = artworkLanguageScore(right) - artworkLanguageScore(left);
    if (languageDelta !== 0) return languageDelta;
    return (right.score ?? 0) - (left.score ?? 0);
  });
}

export async function fetchHomepageTextArtworkForShow(
  show: ImportedShow,
  sources: ArtworkSourceSettings,
) {
  const assets = await searchArtworkAssetsForShow(show, sources);
  const textAssets = sortHomepageArtworkAssets(
    assets.filter((asset) => asset.source !== "current" && asset.hasText !== false),
  );
  const posterUrl =
    textAssets.find((asset) => asset.kind === "poster" && asset.hasText === true)?.url ??
    textAssets.find((asset) => asset.kind === "poster")?.url ??
    null;
  const cleanBackdropUrl =
    assets.find((asset) => asset.kind === "banner" && asset.hasText !== true)?.url ??
    assets.find((asset) => asset.kind === "banner")?.url ??
    show.artwork?.bannerUrl ?? show.backdropUrl ??
    null;
  const sourceBannerUrl =
    textAssets.find((asset) => asset.kind === "wlogo-banner")?.url ??
    null;
  const bannerUrl = sourceBannerUrl ?? (
    cleanBackdropUrl && (show.artwork?.clearLogoUrl ?? show.clearLogoUrl)
      ? await composeHomepageBannerForShow({
          backdropUrl: cleanBackdropUrl,
          logoUrl: show.artwork?.clearLogoUrl ?? show.clearLogoUrl ?? null,
          title: show.title,
        }).catch(() => sourceBannerUrl)
      : sourceBannerUrl
  );

  return { posterUrl, bannerUrl };
}

async function composeHomepageBannerForShow(input: {
  backdropUrl: string;
  logoUrl?: string | null;
  title: string;
}) {
  const response = await requestRuntimeJson<{
    bannerUrl?: string | null;
    error?: string;
  }>("/api/artwork/homepage-banner", {
    method: "POST",
    body: input,
  });

  if (!response.ok || !response.data?.bannerUrl) {
    throw new Error(response.data?.error ?? "Failed to compose homepage banner.");
  }

  return response.data.bannerUrl;
}
