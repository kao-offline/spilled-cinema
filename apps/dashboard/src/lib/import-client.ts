import type { ImportedShow } from "./types";
import type { ArtworkSourceSettings } from "./types";
import { requestRuntimeJson } from "./local-api";
import type { IntegrationId } from "./integrations";
import { readIntegrationUserKeys, readSvetSerialuCredentials } from "./integration-user-config";
import { readProviderRepositoryUrls } from "./provider-feed-storage";

export type ArtworkAsset = {
  url: string;
  kind: "poster" | "backdrop" | "logo";
  source: "current" | "tmdb" | "fanart" | "tvdb";
  label: string;
  language?: string | null;
  width?: number | null;
  score?: number | null;
  hasText?: boolean | null;
};

type ArtworkMediaType = "movie" | "tv";

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
    backdropUrl: show.backdropUrl ?? null,
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
  clearLogoUrl?: string | null;
}, show: ImportedShow) {
  let score = 0;
  if (artwork.posterUrl && artwork.posterUrl !== show.posterUrl) score += 1;
  if (artwork.backdropUrl && artwork.backdropUrl !== show.backdropUrl) score += 1;
  if (artwork.clearLogoUrl && artwork.clearLogoUrl !== show.clearLogoUrl) score += 1;
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

export async function importProviderItem(moduleId: IntegrationId, slug: string, mediaType?: "movie" | "serial") {
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
    },
  });
  if (!response.ok || !response.data?.show) {
    throw new Error(response.data?.error ?? "Failed to import provider item.");
  }
  return response.data.show;
}

export async function searchRemotes(query: string) {
  try {
    const response = await requestRuntimeJson<{
      results?: {
        title: string;
        slug: string;
        platform: "svetserialu" | "bombuj" | "synova";
        posterUrl?: string | null;
        mediaType?: "movie" | "serial";
        year?: string | null;
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
  } catch (error) {
    // Return empty results on any error to gracefully degrade
    console.warn("Search failed:", error instanceof Error ? error.message : String(error));
    return [];
  }
}

export async function refreshArtworkForShow(
  show: ImportedShow,
  sources: ArtworkSourceSettings,
) {
  const requestRefresh = (mediaType: ArtworkMediaType) => requestRuntimeJson<{
    artwork?: {
      posterUrl?: string | null;
      backdropUrl?: string | null;
      clearLogoUrl?: string | null;
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
