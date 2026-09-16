import { describe, expect, it } from "vitest";
import { episodeCodeLabel, episodeProgressPercent, groupEpisodesBySeason } from "../tv-episodes";
import type { LibraryEpisode } from "../types";

function episode(overrides: Partial<LibraryEpisode>): LibraryEpisode {
  return {
    id: overrides.id ?? "e",
    showSlug: "show",
    showTitle: "Show",
    seasonNumber: 1,
    episodeNumber: 1,
    episodeCode: null,
    episodeTitle: null,
    players: [],
    ...overrides,
  } as LibraryEpisode;
}

describe("tv episode helpers", () => {
  it("groups seasons oldest-first with episodes in order", () => {
    const groups = groupEpisodesBySeason([
      episode({ id: "s2e2", seasonNumber: 2, episodeNumber: 2 }),
      episode({ id: "s1e2", seasonNumber: 1, episodeNumber: 2 }),
      episode({ id: "s2e1", seasonNumber: 2, episodeNumber: 1 }),
      episode({ id: "s1e1", seasonNumber: 1, episodeNumber: 1 }),
    ]);
    expect(groups.map(([season]) => season)).toEqual([1, 2]);
    expect(groups[0][1].map((entry) => entry.id)).toEqual(["s1e1", "s1e2"]);
    expect(groups[1][1].map((entry) => entry.id)).toEqual(["s2e1", "s2e2"]);
  });

  it("reports resume progress, 100 only when watched", () => {
    expect(episodeProgressPercent(episode({}))).toBe(0);
    expect(episodeProgressPercent(episode({ playbackPositionSeconds: 600, durationSeconds: 3600 }))).toBe(17);
    expect(episodeProgressPercent(episode({ watched: true, playbackPositionSeconds: 10, durationSeconds: 3600 }))).toBe(100);
    expect(episodeProgressPercent(episode({ playbackPositionSeconds: 9999, durationSeconds: 3600 }))).toBe(100);
  });

  it("labels codes and season/episode numbers for 10-foot rows", () => {
    expect(episodeCodeLabel(episode({ episodeCode: "s1e2" }))).toBe("S1E2");
    expect(episodeCodeLabel(episode({ episodeCode: null, seasonNumber: 2, episodeNumber: 5 }))).toBe("S2 E5");
    expect(episodeCodeLabel(episode({ episodeCode: null, seasonNumber: 3, episodeNumber: null }))).toBe("Season 3");
  });
});
