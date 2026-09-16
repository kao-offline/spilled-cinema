import type { ExploreItem, ImportedShow } from "./types";
import { getShowArtwork, getShowMetadata } from "./media-library";

export type HomepageRailKind = "banner" | "poster";

export type HomepageRailItem =
  | {
      kind: "local";
      id: string;
      title: string;
      subtitle: string;
      posterUrl?: string | null;
      backdropUrl?: string | null;
      bannerUrl?: string | null;
      homepagePosterUrl?: string | null;
      homepageBannerUrl?: string | null;
      bannerWithLogoUrl?: string | null;
      homepageArtworkVersion?: number | null;
      showSlug: string;
      downloadedCount: number;
    }
  | {
      kind: "remote";
      id: string;
      title: string;
      subtitle: string;
      posterUrl?: string | null;
      backdropUrl?: string | null;
      bannerUrl?: string | null;
      provider: string;
      importSlug: string;
      mediaType: "movie" | "serial";
      inVault?: boolean;
      importStatus?: "importing" | "added" | "already" | "busy" | "error";
    };

export type HomepageRail = {
  id: string;
  title: string;
  kind: HomepageRailKind;
  items: HomepageRailItem[];
};

function isMovie(show: ImportedShow) {
  return show.mediaType === "movie" || show.episodes.length <= 1;
}

function showSubtitle(show: ImportedShow) {
  const metadata = getShowMetadata(show);
  return [isMovie(show) ? "Movie" : "TV Show", metadata?.years ?? show.years, metadata?.episodeCount && metadata.episodeCount > 1 ? `${metadata.episodeCount} episodes` : null]
    .filter(Boolean)
    .join("  |  ");
}

function localRailItem(show: ImportedShow, downloadedCountByShow: Record<string, number>): HomepageRailItem {
  const artwork = getShowArtwork(show);
  return {
    kind: "local",
    id: `local:${show.slug}`,
    title: show.title,
    subtitle: showSubtitle(show),
    posterUrl: artwork.posterUrl ?? null,
    backdropUrl: artwork.backdropUrl ?? null,
    bannerUrl: artwork.bannerUrl ?? null,
    homepagePosterUrl: show.homepagePosterUrl ?? null,
    homepageBannerUrl: artwork.bannerWithLogoUrl ?? show.homepageBannerUrl ?? null,
    bannerWithLogoUrl: artwork.bannerWithLogoUrl ?? null,
    homepageArtworkVersion: show.homepageArtworkVersion ?? null,
    showSlug: show.slug,
    downloadedCount: downloadedCountByShow[show.slug] ?? 0,
  };
}

function remoteRailItem(item: ExploreItem): HomepageRailItem {
  return {
    kind: "remote",
    id: `remote:${item.provider}:${item.id}`,
    title: item.title,
    subtitle: [item.mediaType === "serial" ? "TV Show" : "Movie", item.yearLabel ?? item.year, item.provider].filter(Boolean).join("  |  "),
    posterUrl: item.posterUrl ?? null,
    backdropUrl: item.backdropUrl ?? null,
    bannerUrl: (item as ExploreItem & { bannerUrl?: string | null }).bannerUrl ?? null,
    provider: item.provider,
    importSlug: item.importSlug,
    mediaType: item.mediaType,
    inVault: item.inVault,
  };
}

export function buildHomepageRails(input: {
  shows: ImportedShow[];
  downloadedCountByShow: Record<string, number>;
  trendingItems: ExploreItem[];
  /** Keep the desktop homepage compact; TV mode may request the full library. */
  libraryLimit?: number;
}) {
  const libraryLimit = input.libraryLimit ?? 18;
  const withBackdrops = input.shows.filter((show) => {
    const artwork = getShowArtwork(show);
    return Boolean(artwork.bannerWithLogoUrl ?? show.homepageBannerUrl ?? artwork.backdropUrl ?? artwork.bannerUrl);
  }).slice(0, libraryLimit);
  const library = input.shows.slice(0, libraryLimit);
  const downloaded = input.shows.filter((show) => (input.downloadedCountByShow[show.slug] ?? 0) > 0).slice(0, 12);
  const trending = input.trendingItems.slice(0, 18);

  const rails: HomepageRail[] = [];

  if (withBackdrops.length > 0) {
    rails.push({
      id: "library-banners",
      title: "From your library",
      kind: "banner",
      items: withBackdrops.map((show) => localRailItem(show, input.downloadedCountByShow)),
    });
  }

  if (library.length > 0) {
    rails.push({
      id: "library-posters",
      title: "Saved titles",
      kind: "poster",
      items: library.map((show) => localRailItem(show, input.downloadedCountByShow)),
    });
  }

  if (downloaded.length > 0) {
    rails.push({
      id: "downloaded",
      title: "Downloaded",
      kind: "banner",
      items: downloaded.map((show) => localRailItem(show, input.downloadedCountByShow)),
    });
  }

  if (trending.length > 0) {
    rails.push({
      id: "trending-banners",
      title: "Trending now",
      kind: "banner",
      items: trending.filter((item) => item.backdropUrl).slice(0, 12).map(remoteRailItem),
    });
    rails.push({
      id: "trending-posters",
      title: "Discover more",
      kind: "poster",
      items: trending.map(remoteRailItem),
    });
  }

  return rails.filter((rail) => rail.items.length > 0);
}
