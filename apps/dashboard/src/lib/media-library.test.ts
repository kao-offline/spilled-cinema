import { describe, expect, it } from "vitest";
import type { ImportedShow, LibraryEpisode } from "./types";
import {
  getOverlayBannerArtwork,
  getStandaloneBannerArtwork,
  getTitleDescription,
  getTitleMetadataParts,
  mergeTitleMetadata,
  needsTitleMetadataEnrichment,
  TITLE_METADATA_ENRICHMENT_VERSION,
  type TitleMetadataFallback,
} from "./media-library";

function makeShow(overrides: Partial<ImportedShow> = {}): ImportedShow {
  return {
    slug: "obsession",
    title: "Obsession",
    mediaType: "movie",
    availableSeasons: [],
    importedAt: 1,
    episodes: [],
    ...overrides,
  };
}

function labels(show: ImportedShow, fallback: TitleMetadataFallback | null, episode?: LibraryEpisode) {
  return getTitleMetadataParts(show, { fallback, episode }).map((part) => part.label);
}

describe("shared title presentation metadata", () => {
  it("fills a movie's missing rating, year, runtime, and genres", () => {
    expect(labels(makeShow(), {
      csfdRating: 98,
      year: "2026",
      runtimeMinutes: 108,
      genres: ["Horror", "Thriller"],
    })).toEqual(["98%", "2026", "1h 48min", "Horror, Thriller"]);
  });

  it("keeps a partially imported series classified as a series", () => {
    const show = makeShow({
      mediaType: "serial",
      availableSeasons: [],
      episodes: [],
    });

    expect(labels(show, { year: "2024", seasonCount: 3, genres: ["Drama"] }))
      .toEqual(["2024", "3 Seasons", "Drama"]);
  });

  it("uses episode-specific year and runtime in the player", () => {
    const episode: LibraryEpisode = {
      id: "obsession-s1e2",
      showSlug: "obsession",
      showTitle: "Obsession",
      seasonNumber: 1,
      episodeNumber: 2,
      episodeCode: "s01e02",
      episodeTitle: null,
      episodeUrl: "https://example.test/episode",
      players: [],
      selectedPlayerAlias: "",
      importedAt: 1,
    };

    expect(labels(makeShow({ mediaType: "serial", episodes: [episode] }), {
      year: "2024",
      episodeYear: "2025-03-01",
      episodeRuntimeMinutes: 47,
      genres: ["Mystery"],
    }, episode)).toEqual(["2025", "47min", "Mystery"]);
  });

  it("prefers a clean stored synopsis and otherwise uses the fetched synopsis", () => {
    expect(getTitleDescription(makeShow({ description: "CSFD rating: 91%\nA stored synopsis." }), {
      description: "A fetched synopsis.",
    })).toBe("A stored synopsis.");

    expect(getTitleDescription(makeShow(), { description: "A fetched synopsis." }))
      .toBe("A fetched synopsis.");
  });

  it("persists fetched genres and marks a complete movie as enriched", () => {
    const enriched = mergeTitleMetadata(makeShow({
      description: "A stored synopsis.",
      years: "2009 | CSFD 83%",
      episodes: [{
        id: "avatar-movie",
        showSlug: "avatar",
        showTitle: "Avatar",
        seasonNumber: 1,
        episodeNumber: 1,
        episodeCode: "movie",
        episodeTitle: "Avatar",
        episodeUrl: "https://example.test/avatar",
        players: [],
        selectedPlayerAlias: "",
        durationSeconds: 9_720,
        importedAt: 1,
      }],
    }), {
      year: "2009",
      runtimeMinutes: 162,
      genres: ["Science Fiction", "Action", "Adventure"],
      csfdRating: 76,
    });

    expect(enriched.metadata?.genres).toEqual(["Science Fiction", "Action", "Adventure"]);
    expect(enriched.metadata?.ratings[0]?.label).toBe("83%");
    expect(enriched.metadata?.enrichmentVersion).toBe(TITLE_METADATA_ENRICHMENT_VERSION);
    expect(needsTitleMetadataEnrichment(enriched)).toBe(false);
  });
});

describe("artwork roles", () => {
  it("keeps legacy clean backdrops away from baked-logo banner slots", () => {
    const show = makeShow({
      backdropUrl: "https://images.example/clean.jpg",
      bannerUrl: "https://images.example/legacy-wlogo.jpg",
      clearLogoUrl: "https://images.example/logo.png",
      homepageBannerUrl: "https://images.example/wlogo.jpg",
    });

    expect(getOverlayBannerArtwork(show)).toEqual({
      bannerUrl: "https://images.example/clean.jpg",
      logoUrl: "https://images.example/logo.png",
    });
    expect(getStandaloneBannerArtwork(show)).toBe("https://images.example/wlogo.jpg");
  });

  it("falls back to the clean banner when a WLogo banner is unavailable", () => {
    const show = makeShow({ artwork: { bannerUrl: "https://images.example/banner.jpg" } });
    expect(getStandaloneBannerArtwork(show)).toBe("https://images.example/banner.jpg");
  });
});
