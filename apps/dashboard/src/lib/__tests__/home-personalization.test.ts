import { describe, expect, it } from "vitest";
import { buildContinueWatchingItems, buildNewEpisodeItems, getPlaybackProgressColor, PLAYBACK_PROVIDER_COLORS } from "../home-personalization";
import type { ImportedShow, LibraryEpisode } from "../types";

function episode(id: string, number: number | null, input: Partial<LibraryEpisode> = {}): LibraryEpisode {
  return {
    id,
    showSlug: "show",
    showTitle: "Show",
    seasonNumber: 1,
    episodeNumber: number,
    episodeCode: number === null ? "movie" : `s01e${String(number).padStart(2, "0")}`,
    episodeTitle: number === null ? "Movie" : `Episode ${number}`,
    episodeUrl: `https://example.com/${id}`,
    players: [],
    selectedPlayerAlias: "none",
    importedAt: 1_000 + (number ?? 0),
    ...input,
  };
}

function show(episodes: LibraryEpisode[], input: Partial<ImportedShow> = {}): ImportedShow {
  return {
    slug: "show",
    title: "Show",
    mediaType: "serial",
    availableSeasons: [1],
    importedAt: 1_000,
    episodes,
    ...input,
  };
}

describe("home personalization", () => {
  it("uses the selected playback provider color for watch progress", () => {
    const providers = [
      ["bombuj", PLAYBACK_PROVIDER_COLORS.bombuj],
      ["svetserialu", PLAYBACK_PROVIDER_COLORS.svetserialu],
      ["vidking", PLAYBACK_PROVIDER_COLORS.vidking],
      ["spillshare", PLAYBACK_PROVIDER_COLORS.spillshare],
    ] as const;

    for (const [provider, color] of providers) {
      const item = episode(provider, 1, {
        selectedPlayerAlias: `${provider}-player`,
        players: [{
          alias: `${provider}-player`,
          provider,
          label: provider,
          sourcePageUrl: `https://${provider}.example/title`,
          embedUrl: `https://${provider}.example/player`,
        }],
      });
      expect(getPlaybackProgressColor(item)).toBe(color);
    }
  });

  it("lists only the next unwatched episode after the last completed episode", () => {
    const items = buildNewEpisodeItems([show([
      episode("e1", 1, { importedAt: 9_000, watched: true, playbackUpdatedAt: 9_800 }),
      episode("e2", 2, { importedAt: 9_500 }),
      episode("e3", 3, { importedAt: 9_700 }),
    ])], { now: 10_000, maxAgeMs: 2_000 });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ hasWatchHistory: true, episode: { id: "e2" } });
  });

  it("prioritizes followed series and places never-started series further back", () => {
    const followed = show([
      episode("followed-e1", 1, { watched: true, playbackUpdatedAt: 9_500 }),
      episode("followed-e2", 2, { importedAt: 9_100 }),
    ], { slug: "followed", title: "Followed" });
    const untouched = show([
      episode("untouched-e1", 1, { importedAt: 9_900 }),
      episode("untouched-e2", 2, { importedAt: 9_950 }),
    ], { slug: "untouched", title: "Untouched" });
    const items = buildNewEpisodeItems([untouched, followed], { now: 10_000, maxAgeMs: 2_000 });

    expect(items.map((item) => item.episode.id)).toEqual(["followed-e2", "untouched-e1"]);
    expect(new Set(items.map((item) => item.show.slug)).size).toBe(items.length);
  });

  it("omits stale episodes and movie entries from the new-episode rail", () => {
    expect(buildNewEpisodeItems([
      show([episode("old", 1, { importedAt: 100 })]),
      show([episode("movie", null, { importedAt: 9_900 })], { slug: "movie", mediaType: "movie" }),
    ], { now: 10_000, maxAgeMs: 1_000 })).toEqual([]);
  });

  it("ignores implausible future timestamps", () => {
    expect(buildNewEpisodeItems([show([episode("future", 1, { importedAt: 500_000 })])], { now: 10_000 })).toEqual([]);
  });

  it("resumes a partially watched film at its stored position", () => {
    const movie = episode("movie", null, {
      playbackPositionSeconds: 1_200,
      playbackDurationSeconds: 7_200,
      playbackUpdatedAt: 20_000,
    });
    const [item] = buildContinueWatchingItems([show([movie], { mediaType: "movie" })]);

    expect(item.kind).toBe("resume-film");
    expect(item.resumeAtSeconds).toBe(1_200);
    expect(item.progressPercent).toBe(17);
  });

  it("selects the next unwatched episode after the latest completed episode", () => {
    const items = buildContinueWatchingItems([show([
      episode("e1", 1, { watched: true, playbackUpdatedAt: 10_000 }),
      episode("e2", 2),
      episode("e3", 3),
    ])]);

    expect(items[0]?.kind).toBe("next-episode");
    expect(items[0]?.episode.id).toBe("e2");
  });

  it("keeps a partially watched series episode and removes completed series", () => {
    const partial = show([
      episode("e1", 1, { playbackPositionSeconds: 300, playbackDurationSeconds: 1_800, playbackUpdatedAt: 20_000 }),
      episode("e2", 2),
    ]);
    expect(buildContinueWatchingItems([partial])[0]?.episode.id).toBe("e1");

    const completed = show([
      episode("done", 1, { watched: true, playbackUpdatedAt: 30_000 }),
    ], { slug: "done" });
    expect(buildContinueWatchingItems([completed])).toEqual([]);
  });
});
