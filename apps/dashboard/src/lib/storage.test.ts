import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readLibraryState, updateEpisodePlaybackProgress, upsertImportedShow } from "./storage";
import type { ImportedShow } from "./types";

function createStorageStub() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

function showFixture(overrides: Partial<ImportedShow>): ImportedShow {
  const provider = overrides.slug?.split("-")[0] ?? "vidking";
  const slug = overrides.slug ?? `${provider}-movie-1`;
  const playerAlias = `${provider}-player`;
  return {
    slug,
    title: "Example Movie",
    years: "2026",
    mediaType: "movie",
    externalIds: { tmdb: "1" },
    posterUrl: null,
    backdropUrl: null,
    clearLogoUrl: null,
    availableSeasons: [1],
    importedAt: 1,
    episodes: [{
      id: `${slug}:movie`,
      showSlug: slug,
      showTitle: "Example Movie",
      seasonNumber: 1,
      episodeNumber: null,
      episodeCode: "movie",
      episodeTitle: "Example Movie",
      episodeUrl: `https://${provider}.example/movie`,
      players: [{
        alias: playerAlias,
        provider,
        label: provider,
        sourcePageUrl: `https://${provider}.example/movie`,
        embedUrl: `https://${provider}.example/embed`,
      }],
      selectedPlayerAlias: playerAlias,
      importedAt: 1,
    }],
    ...overrides,
  };
}

describe("library storage imports", () => {
  beforeEach(() => {
    const localStorage = createStorageStub();
    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("window", { localStorage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("merges imports for the same title and keeps players from each provider", () => {
    upsertImportedShow(showFixture({ slug: "vidking-movie-1" }));
    upsertImportedShow(showFixture({
      slug: "cineby-movie-1",
      importedAt: 2,
      episodes: [{
        ...showFixture({ slug: "cineby-movie-1" }).episodes[0],
        importedAt: 2,
      }],
      providerMatches: [{
        identityId: "movie:example:2026",
        integrationId: "cineby",
        providerItemId: "movie/1/example-movie",
        confidenceScore: 1,
        resolvedCapabilities: ["search", "import", "players"],
      }],
    }));

    const state = readLibraryState();
    expect(state.shows).toHaveLength(1);
    expect(state.shows[0].slug).toBe("vidking-movie-1");
    expect(state.shows[0].episodes).toHaveLength(1);
    expect(state.shows[0].episodes[0].players.map((player) => player.provider)).toEqual(["vidking", "cineby"]);
    expect(state.shows[0].providerMatches?.map((match) => match.integrationId)).toEqual(["cineby"]);
  });

  it("deduplicates equivalent season episode codes across providers", () => {
    const firstEpisode = {
      ...showFixture({ slug: "vidking-tv-1", mediaType: "serial" }).episodes[0],
      id: "vidking-tv-1:s02e03",
      showSlug: "vidking-tv-1",
      showTitle: "Example Series",
      seasonNumber: 2,
      episodeNumber: 3,
      episodeCode: "S02E03",
      episodeTitle: "Example Series - S02E03 - Spymaster",
      players: [{
        alias: "vidking-player",
        provider: "vidking",
        label: "VidKing",
        sourcePageUrl: "https://vidking.example/tv/1/2/3",
        embedUrl: "https://vidking.example/embed/tv/1/2/3",
      }],
      selectedPlayerAlias: "vidking-player",
    };
    const secondEpisode = {
      ...firstEpisode,
      id: "svetserialu-tv-1:s2e3",
      showSlug: "svetserialu-tv-1",
      episodeCode: "S2E3",
      players: [{
        alias: "svetserialu-player",
        provider: "svetserialu",
        label: "SvetSerialu",
        sourcePageUrl: "https://svetserialu.example/the-agency/s2e3",
        embedUrl: "https://svetserialu.example/embed/the-agency/s2e3",
      }],
      selectedPlayerAlias: "svetserialu-player",
      importedAt: 2,
    };

    upsertImportedShow(showFixture({
      slug: "vidking-tv-1",
      title: "Example Series",
      years: "2024",
      mediaType: "serial",
      availableSeasons: [2],
      episodes: [firstEpisode],
    }));
    upsertImportedShow(showFixture({
      slug: "svetserialu-tv-1",
      title: "Example Series",
      years: "2024 -",
      mediaType: "serial",
      availableSeasons: [2],
      importedAt: 2,
      episodes: [secondEpisode],
    }));

    const episode = readLibraryState().shows[0].episodes[0];
    expect(readLibraryState().shows[0].episodes).toHaveLength(1);
    expect(episode.episodeCode).toBe("S2E3");
    expect(episode.players.map((player) => player.provider)).toEqual(["vidking", "svetserialu"]);
  });

  it("replaces stale Bombuj rows without merging reused positional aliases", () => {
    const oldShow = showFixture({ slug: "bombuj-avatar", title: "Avatar", years: "2009" });
    oldShow.episodes[0].players = [
      {
        alias: "bombuj-6",
        provider: "netu.tv",
        label: "NETU.TV",
        sourcePageUrl: "https://bombuj.si/online-film-avatar",
        embedUrl: "https://old.example/player",
        resolutionStatus: "failed",
        resolutionError: "Old provider failed.",
      },
      {
        alias: "vidking-primary",
        provider: "vidking",
        label: "VidKing",
        sourcePageUrl: "https://vidking.example/movie/19995",
        embedUrl: "https://vidking.example/embed/movie/19995",
        resolutionStatus: "unresolved",
      },
    ];
    oldShow.episodes[0].selectedPlayerAlias = "bombuj-6";

    const refreshedShow = showFixture({ slug: "bombuj-avatar", title: "Avatar", years: "2009" });
    refreshedShow.episodes[0].players = [{
      alias: "bombuj-6",
      provider: "vidsrc",
      label: "VIDSRC",
      sourcePageUrl: "https://bombuj.si/online-film-avatar",
      embedUrl: "https://vsembed.example/avatar",
      resolutionStatus: "unresolved",
    }];

    upsertImportedShow(oldShow);
    upsertImportedShow(refreshedShow);

    const players = readLibraryState().shows[0].episodes[0].players;
    expect(players).toHaveLength(2);
    expect(players.map((player) => player.provider)).toEqual(["vidking", "vidsrc"]);
    expect(players.some((player) => player.provider === "netu.tv")).toBe(false);
    expect(players.find((player) => player.provider === "vidsrc")?.alias).not.toBe("bombuj-6");
  });

  it("repairs duplicate legacy player aliases without dropping sources", () => {
    const show = showFixture({ slug: "legacy-aliases" });
    show.episodes[0].players = [
      { ...show.episodes[0].players[0], alias: "file", provider: "filemoon", embedUrl: "https://filemoon.example/one" },
      { ...show.episodes[0].players[0], alias: "file", provider: "vidmoly", embedUrl: "https://vidmoly.example/two" },
      { ...show.episodes[0].players[0], alias: "file", provider: "mixdrop", embedUrl: "https://mixdrop.example/three" },
    ];
    show.episodes[0].selectedPlayerAlias = "file";

    upsertImportedShow(show);

    const episode = readLibraryState().shows[0].episodes[0];
    expect(episode.players).toHaveLength(3);
    expect(new Set(episode.players.map((player) => player.alias)).size).toBe(3);
    expect(episode.players.map((player) => player.alias)).toEqual(["file", "file-vidmoly", "file-mixdrop"]);
    expect(episode.selectedPlayerAlias).toBe("file");
  });

  it("replaces stale failed resolution when the same Bombuj slot gets a fresh URL", () => {
    const oldShow = showFixture({ slug: "bombuj-avatar", title: "Avatar", years: "2009" });
    oldShow.episodes[0].players[0] = {
      ...oldShow.episodes[0].players[0],
      alias: "bombuj-2",
      provider: "byse.sx",
      embedUrl: "https://byse.example/old",
      resolutionStatus: "failed",
      resolutionError: "Expired source.",
    };
    const refreshedShow = showFixture({ slug: "bombuj-avatar", title: "Avatar", years: "2009" });
    refreshedShow.episodes[0].players[0] = {
      ...refreshedShow.episodes[0].players[0],
      alias: "bombuj-2",
      provider: "byse.sx",
      embedUrl: "https://byse.example/fresh",
      resolutionStatus: "unresolved",
    };

    upsertImportedShow(oldShow);
    upsertImportedShow(refreshedShow);

    const player = readLibraryState().shows[0].episodes[0].players[0];
    expect(player.embedUrl).toBe("https://byse.example/fresh");
    expect(player.resolutionStatus).toBe("unresolved");
    expect(player.resolutionError).toBeUndefined();
  });

  it("preserves existing playback progress when an import repairs metadata", () => {
    const first = showFixture({ slug: "vidking-movie-1" });
    first.episodes[0].playbackPositionSeconds = 42;
    first.episodes[0].playbackDurationSeconds = 120;
    upsertImportedShow(first);
    upsertImportedShow(showFixture({
      slug: "vidking-movie-1",
      posterUrl: "https://image.example/poster.jpg",
      episodes: [{
        ...showFixture({ slug: "vidking-movie-1" }).episodes[0],
        playbackPositionSeconds: undefined,
      }],
    }));

    const episode = readLibraryState().shows[0].episodes[0];
    expect(episode.playbackPositionSeconds).toBe(42);
    expect(episode.playbackDurationSeconds).toBe(120);
    expect(readLibraryState().shows[0].posterUrl).toBe("https://image.example/poster.jpg");
  });

  it("hydrates legacy fields into unified metadata and artwork", () => {
    upsertImportedShow(showFixture({
      slug: "vidking-movie-2",
      years: "2026 | CSFD 87%",
      description: "A clean description.",
      posterUrl: "https://image.example/poster.jpg",
      backdropUrl: "https://image.example/backdrop.jpg",
      bannerUrl: "https://image.example/banner.jpg",
      homepageBannerUrl: "https://image.example/banner-with-logo.webp",
      clearLogoUrl: "https://image.example/logo.png",
      actors: [{ name: "Actor One", role: "Lead", profileUrl: null }],
      directors: [{ name: "Director One", role: "Director", profileUrl: null }],
      metadata: {
        title: "Example Movie",
        year: 2026,
        years: "2026",
        mediaType: "movie",
        runtimeMinutes: 106,
        seasonCount: 1,
        episodeCount: 1,
        genres: ["Drama", "Thriller"],
        ratings: [],
        actors: [],
        directors: [],
        updatedAt: 1,
      },
    }));

    const show = readLibraryState().shows[0];
    expect(show.artwork).toMatchObject({
      posterUrl: "https://image.example/poster.jpg",
      backdropUrl: "https://image.example/backdrop.jpg",
      bannerUrl: "https://image.example/banner.jpg",
      clearLogoUrl: "https://image.example/logo.png",
      bannerWithLogoUrl: "https://image.example/banner-with-logo.webp",
    });
    expect(show.metadata).toMatchObject({
      runtimeMinutes: 106,
      seasonCount: 1,
      episodeCount: 1,
      genres: ["Drama", "Thriller"],
      actors: [{ name: "Actor One", role: "Lead", profileUrl: null }],
      directors: [{ name: "Director One", role: "Director", profileUrl: null }],
    });
    expect(show.metadata?.ratings).toContainEqual({ source: "csfd", value: 87, scale: 100, label: "87%" });
  });

  it("stores episode duration as first-class episode data", () => {
    const show = showFixture({ slug: "vidking-movie-3" });
    upsertImportedShow(show);
    updateEpisodePlaybackProgress(show.episodes[0].id, {
      currentTime: 5,
      duration: 7200,
    });

    const episode = readLibraryState().shows[0].episodes[0];
    expect(episode.durationSeconds).toBe(7200);
    expect(episode.playbackDurationSeconds).toBe(7200);
  });

  it("rewrites old local storage records into the normalized shape on read", () => {
    const legacyShow = {
      ...showFixture({
        slug: "legacy-movie",
        years: "2026 | CSFD 91%",
        homepageBannerUrl: "https://image.example/composed.webp",
      }),
      genres: ["Sci-Fi"],
    };
    localStorage.setItem("spilled-library.state.v1", JSON.stringify({
      shows: [legacyShow],
      settings: {},
      offlineDownloads: {},
      query: "",
    }));

    const state = readLibraryState();
    const persisted = JSON.parse(localStorage.getItem("spilled-library.state.v1") ?? "{}");
    expect(state.shows[0].metadata?.genres).toEqual(["Sci-Fi"]);
    expect(state.shows[0].metadata?.ratings).toContainEqual({ source: "csfd", value: 91, scale: 100, label: "91%" });
    expect(persisted.shows[0].metadata.genres).toEqual(["Sci-Fi"]);
    expect(persisted.shows[0].artwork.bannerWithLogoUrl).toBe("https://image.example/composed.webp");
  });
});
