import { describe, expect, it } from "vitest";
import { buildTrendingScore } from "../trending-feed";
import type { ExploreItem, LibraryState, UserTasteProfile } from "../../lib/types";

const candidate: ExploreItem = {
  id: "cand-1",
  title: "The Matrix",
  slug: "the-matrix",
  importSlug: "the-matrix",
  provider: "bombuj",
  mediaType: "movie",
  detailUrl: "https://www.bombuj.si/online-film-the-matrix",
  genres: ["Sci-Fi"],
  audioBuckets: ["all", "dubbing"],
  languages: [],
  directors: [],
  actors: [],
  sectionKeys: ["newest"],
  inVault: false,
  availableNow: true,
};

const librarySnapshot: LibraryState = {
  shows: [
    {
      slug: "matrix-resurrections",
      title: "Matrix Resurrections",
      availableSeasons: [1],
      importedAt: 100,
      episodes: [],
      isFavorite: true,
    },
  ],
  query: "",
  settings: {
    autoplayNext: true,
    offlineSizeLimitMb: 1024,
    downloadEngine: "wasm",
    preferredMovieSource: "bombuj",
    preferredSeriesSource: "svetserialu",
    artworkSources: {
      tmdb: true,
      fanart: true,
      tvdb: true,
    },
  },
  offlineDownloads: {},
};

const tasteProfile: UserTasteProfile = {
  updatedAt: Date.now(),
  importedSlugs: ["matrix-resurrections"],
  favoriteSlugs: ["matrix-resurrections"],
  recentShowSlugs: ["matrix-resurrections"],
  recentEpisodeIds: [],
  providerAffinity: {
    bombuj: 3,
  },
  genreAffinity: {},
  networkAffinity: {},
  audioAffinity: {},
};

describe("trending scoring", () => {
  it("prioritizes favorites, recent affinity, source bias, and freshness", () => {
    const result = buildTrendingScore(candidate, librarySnapshot, tasteProfile);
    const withoutSourceBias = buildTrendingScore(
      { ...candidate, sectionKeys: [] },
      librarySnapshot,
      { ...tasteProfile, providerAffinity: {} },
    );

    expect(result.score).toBeGreaterThan(0);
    expect(result.reasons.map((reason) => reason.kind)).toEqual(
      expect.arrayContaining(["favorite-match", "recent-open", "import-match"]),
    );
    expect(result.score).toBeGreaterThan(withoutSourceBias.score);
  });

  it("penalizes items already in the vault", () => {
    const external = buildTrendingScore(candidate, librarySnapshot, tasteProfile);
    const alreadyImported = buildTrendingScore({ ...candidate, inVault: true }, librarySnapshot, tasteProfile);

    expect(alreadyImported.score).toBeLessThan(external.score);
  });
});
