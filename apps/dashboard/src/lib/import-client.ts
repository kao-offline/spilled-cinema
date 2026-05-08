import type { ImportedShow } from "./types";
import type { ArtworkSourceSettings } from "./types";
import { requestRuntimeJson } from "./local-api";

export type ArtworkAsset = {
  url: string;
  kind: "poster" | "backdrop" | "logo";
  source: "tmdb" | "fanart" | "tvdb";
  label: string;
  language?: string | null;
  width?: number | null;
  score?: number | null;
  hasText?: boolean | null;
};

function parseYearHint(value: string | null | undefined) {
  const match = value?.match(/\b(19|20)\d{2}\b/);
  return match?.[0] ?? null;
}

export async function importSvetSerialuShow(slug: string) {
  const response = await requestRuntimeJson<{
    show?: ImportedShow;
    error?: string;
  }>("/api/import-svetserialu", {
    method: "POST",
    body: { slug },
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

export async function searchRemotes(query: string) {
  try {
    const response = await requestRuntimeJson<{
      results?: {
        title: string;
        slug: string;
        platform: "svetserialu" | "bombuj";
        posterUrl?: string | null;
        mediaType?: "movie" | "serial";
        year?: string | null;
      }[];
      error?: string;
    }>("/api/search", {
      method: "POST",
      body: { query },
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
  const response = await requestRuntimeJson<{
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
      title: show.title,
      altTitle: show.altTitle ?? null,
      years: show.years ?? null,
      yearHint: parseYearHint(show.years),
      description: show.description ?? null,
      posterUrl: show.posterUrl ?? null,
      backdropUrl: show.backdropUrl ?? null,
      clearLogoUrl: show.clearLogoUrl ?? null,
      mediaType: show.episodes.length === 1 && show.episodes[0]?.episodeCode === "movie" ? "movie" : "tv",
      artworkSources: sources,
    },
  });
  if (!response.ok || !response.data?.artwork) {
    throw new Error(response.data?.error ?? `Failed to refresh artwork for ${show.title}.`);
  }
  return response.data.artwork;
}

export async function searchArtworkAssetsForShow(
  show: ImportedShow,
  sources: ArtworkSourceSettings,
) {
  const response = await requestRuntimeJson<{
    assets?: ArtworkAsset[];
    error?: string;
  }>("/api/artwork/search", {
    method: "POST",
    body: {
      title: show.title,
      altTitle: show.altTitle ?? null,
      years: show.years ?? null,
      yearHint: parseYearHint(show.years),
      description: show.description ?? null,
      mediaType: show.episodes.length === 1 && show.episodes[0]?.episodeCode === "movie" ? "movie" : "tv",
      artworkSources: sources,
    },
  });
  if (!response.ok || !response.data?.assets) {
    throw new Error(response.data?.error ?? `Failed to load artwork options for ${show.title}.`);
  }
  return response.data.assets;
}
