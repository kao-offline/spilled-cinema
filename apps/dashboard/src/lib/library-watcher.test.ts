import { describe, expect, it, vi } from "vitest";
import { scanProviderFeeds } from "./library-watcher";
import type {
  ExploreItem,
  ImportedShow,
  LibraryEpisode,
  LibraryState,
  ProviderModuleManifest,
} from "./types";

function episode(showSlug: string, code: string, provider = "svetserialu"): LibraryEpisode {
  const match = code.match(/s(\d+)e(\d+)/i);
  const seasonNumber = Number(match?.[1] ?? 1);
  const episodeNumber = Number(match?.[2] ?? 1);
  return {
    id: `${showSlug}:${code}`,
    showSlug,
    showTitle: showSlug,
    seasonNumber,
    episodeNumber,
    episodeCode: code,
    episodeTitle: `Episode ${episodeNumber}`,
    episodeUrl: `https://provider.example/${showSlug}/${code}`,
    players: [{
      alias: `${provider}-${code}`,
      provider,
      label: provider,
      sourcePageUrl: `https://provider.example/${showSlug}/${code}`,
      embedUrl: `https://embed.example/${showSlug}/${code}`,
    }],
    selectedPlayerAlias: `${provider}-${code}`,
    importedAt: 1,
  };
}

function show(input: Partial<ImportedShow> & Pick<ImportedShow, "slug" | "title">): ImportedShow {
  return {
    availableSeasons: [1],
    importedAt: 1,
    episodes: [],
    ...input,
  };
}

function state(shows: ImportedShow[]): LibraryState {
  return {
    shows,
    query: "",
    offlineDownloads: {},
    settings: {
      autoplayNext: true,
      offlineSizeLimitMb: 2048,
      downloadEngine: "localffmpeg",
      preferredSeriesSource: "vidking",
      preferredMovieSource: "vidking",
      artworkSources: { tmdb: true, fanart: true, tvdb: true },
    },
  };
}

function moduleWithFeed(
  moduleId: "svetserialu" | "bombuj",
  feedId: string,
  kind: "new-episodes" | "latest-episodes" | "new-additions",
  itemGranularity: "episode" | "show" | "movie",
): ProviderModuleManifest {
  return {
    moduleId,
    providerId: moduleId,
    displayName: moduleId,
    version: 1,
    status: "active",
    capabilities: {
      import: true,
      player: true,
      search: true,
      download: true,
      feeds: [{
        moduleId,
        providerId: moduleId,
        feedId,
        title: feedId,
        description: "",
        kind,
        defaultEnabled: false,
        pageTitle: feedId,
        supportsSearch: true,
        supportsOpenSource: true,
        supportsImport: true,
        sortMode: "newest",
        itemGranularity,
      }],
    },
    publishedAt: 1,
    updatedAt: 1,
  };
}

function feedItem(input: Partial<ExploreItem> & Pick<ExploreItem, "id" | "title" | "slug" | "importSlug" | "provider" | "mediaType">): ExploreItem {
  return {
    detailUrl: "https://provider.example/item",
    genres: [],
    audioBuckets: ["all"],
    languages: [],
    directors: [],
    actors: [],
    sectionKeys: ["latestEpisodes"],
    inVault: false,
    availableNow: true,
    ...input,
  };
}

describe("library provider watcher", () => {
  it("awaits a new episode import and merges it without losing the existing episode", async () => {
    const existing = show({
      slug: "andor",
      title: "Andor",
      mediaType: "serial",
      episodes: [episode("andor", "s1e04")],
      providerMatches: [{
        identityId: "andor",
        integrationId: "svetserialu",
        providerItemId: "andor",
        confidenceScore: 1,
        resolvedCapabilities: ["import"],
      }],
    });
    const item = feedItem({
      id: "svet:andor:s1e05",
      title: "Andor",
      slug: "andor",
      importSlug: "andor",
      provider: "svetserialu",
      mediaType: "serial",
      episode: { seasonNumber: 1, episodeNumber: 5, episodeCode: "s1e05" },
    });
    const importItem = vi.fn(async () => show({
      ...existing,
      episodes: [episode("andor", "s1e04"), episode("andor", "s1e05")],
    }));
    const fetchFeed = vi.fn(async () => ({
      generatedAt: 1,
      stale: false,
      moduleId: "svetserialu",
      feedId: "new-episodes",
      items: [item],
      continueCursor: null,
    }));

    const result = await scanProviderFeeds(
      state([existing]),
      [moduleWithFeed("svetserialu", "new-episodes", "new-episodes", "episode")],
      { tmdb: true, fanart: true, tvdb: true },
      { fetchFeed, importItem, now: () => 100_000 },
    );

    expect(fetchFeed).toHaveBeenCalledWith(expect.objectContaining({ fresh: true }));
    expect(importItem).toHaveBeenCalledTimes(1);
    expect(result.state.shows[0].episodes.map((entry) => entry.episodeCode)).toEqual(["s1e04", "s1e05"]);
    expect(result.changedTitles).toEqual(["andor"]);
  });

  it("matches a movie by title and year and adds a newly available provider source without duplicating it", async () => {
    const existing = show({
      slug: "vidking-movie-693134",
      title: "Dune: Part Two",
      years: "2024",
      mediaType: "movie",
      episodes: [episode("vidking-movie-693134", "movie", "vidking")],
    });
    existing.episodes[0] = {
      ...existing.episodes[0],
      episodeNumber: null,
      episodeCode: "movie",
    };
    const item = feedItem({
      id: "bombuj:dune-part-two:movie",
      title: "Dune: Part Two",
      slug: "dune-part-two",
      importSlug: "dune-part-two",
      provider: "bombuj",
      mediaType: "movie",
      year: "2024",
    });
    const imported = show({
      slug: "bombuj-dune-part-two",
      title: "Dune: Part Two",
      years: "2024",
      mediaType: "movie",
      episodes: [{
        ...existing.episodes[0],
        id: "bombuj-dune-part-two:movie",
        showSlug: "bombuj-dune-part-two",
        players: [{
          alias: "bombuj-movie",
          provider: "bombuj",
          label: "Bombuj",
          sourcePageUrl: "https://bombuj.example/dune",
          embedUrl: "https://embed.example/dune-bombuj",
        }],
        selectedPlayerAlias: "bombuj-movie",
      }],
      providerMatches: [{
        identityId: "dune",
        integrationId: "bombuj",
        providerItemId: "dune-part-two",
        confidenceScore: 1,
        resolvedCapabilities: ["import", "players"],
      }],
    });

    const result = await scanProviderFeeds(
      state([existing]),
      [moduleWithFeed("bombuj", "latest-movies", "new-additions", "movie")],
      { tmdb: true, fanart: true, tvdb: true },
      {
        fetchFeed: async () => ({
          generatedAt: 1,
          stale: false,
          moduleId: "bombuj",
          feedId: "latest-movies",
          items: [item],
          continueCursor: null,
        }),
        importItem: async () => imported,
        now: () => 200_000,
      },
    );

    expect(result.state.shows).toHaveLength(1);
    expect(result.state.shows[0].slug).toBe("vidking-movie-693134");
    expect(result.state.shows[0].episodes[0].players.map((player) => player.provider)).toEqual(
      expect.arrayContaining(["vidking", "bombuj"]),
    );
    expect(result.state.shows[0].providerMatches?.some((match) => match.integrationId === "bombuj")).toBe(true);
  });

  it("does not reimport an episode that is already present", async () => {
    const existing = show({
      slug: "andor-existing",
      title: "Andor",
      mediaType: "serial",
      episodes: [episode("andor-existing", "s1e05")],
    });
    const importItem = vi.fn();

    const result = await scanProviderFeeds(
      state([existing]),
      [moduleWithFeed("svetserialu", "new-episodes", "new-episodes", "episode")],
      { tmdb: true, fanart: true, tvdb: true },
      {
        fetchFeed: async () => ({
          generatedAt: 1,
          stale: false,
          moduleId: "svetserialu",
          feedId: "new-episodes",
          items: [feedItem({
            id: "svet:andor:s1e05",
            title: "Andor",
            slug: "andor-existing",
            importSlug: "andor-existing",
            provider: "svetserialu",
            mediaType: "serial",
            episode: { seasonNumber: 1, episodeNumber: 5, episodeCode: "s1e05" },
          })],
          continueCursor: null,
        }),
        importItem,
        now: () => 300_000,
      },
    );

    expect(importItem).not.toHaveBeenCalled();
    expect(result.changedTitles).toEqual([]);
  });
});
