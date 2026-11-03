import type { ImportedShow, LibraryArtworkSet } from "./types";

export const ARTWORK_REPAIR_VERSION = 1;

export function artworkIdentityKey(show: ImportedShow) {
  return JSON.stringify([show.slug, show.mediaType, show.title, show.years, show.externalIds?.tmdb, show.externalIds?.imdb, show.externalIds?.tvdb]);
}

export function needsArtworkRepair(show: ImportedShow) {
  return (show.artworkRepairVersion ?? 0) < ARTWORK_REPAIR_VERSION || show.artworkRepairIdentity !== artworkIdentityKey(show);
}

export function applyArtworkRepair(show: ImportedShow, fresh: LibraryArtworkSet, homepageVersion: number): ImportedShow {
  const posterUrl = fresh.posterUrl ?? null;
  const bannerUrl = fresh.bannerUrl ?? fresh.backdropUrl ?? null;
  const clearLogoUrl = fresh.clearLogoUrl ?? null;
  const bannerWithLogoUrl = fresh.bannerWithLogoUrl ?? null;
  return {
    ...show, posterUrl, bannerUrl, backdropUrl: bannerUrl, clearLogoUrl, bannerWithLogoUrl,
    homepagePosterUrl: posterUrl, homepageBannerUrl: bannerWithLogoUrl, homepageArtworkVersion: homepageVersion,
    artwork: { posterUrl, bannerUrl, backdropUrl: bannerUrl, clearLogoUrl, bannerWithLogoUrl },
    artworkRepairVersion: ARTWORK_REPAIR_VERSION, artworkRepairIdentity: artworkIdentityKey(show),
    // Legacy episode.posterUrl often contains the series poster, not an episode still.
    episodes: show.episodes.map((episode) => ({ ...episode, posterUrl: undefined })),
  };
}
