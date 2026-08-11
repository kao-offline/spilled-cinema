import { describe, expect, it } from "vitest";
import type { EpisodePlayer, LibraryEpisode } from "../types";
import { countAddedEpisodeAudioOptions, countEpisodeAudioAvailability, getEpisodeAudioAvailability } from "../episode-audio";

function player(language: string, subtitlesUrl?: string): EpisodePlayer {
  return {
    alias: language,
    provider: "test",
    label: language,
    language,
    sourcePageUrl: "https://example.com/source",
    embedUrl: "https://example.com/embed",
    subtitlesUrl,
  };
}

function episode(players: EpisodePlayer[]): LibraryEpisode {
  return {
    id: "episode-1",
    showSlug: "show",
    showTitle: "Show",
    seasonNumber: 1,
    episodeNumber: 1,
    episodeCode: "s01e01",
    episodeTitle: "Pilot",
    episodeUrl: "https://example.com/episode",
    players,
    selectedPlayerAlias: players[0]?.alias ?? "none",
    importedAt: 1,
  };
}

describe("episode audio availability", () => {
  it("detects subtitle URLs and dubbed Czech audio independently", () => {
    expect(getEpisodeAudioAvailability(episode([
      player("English audio", "https://example.com/cs.vtt"),
      player("Czech audio"),
    ]))).toEqual({ subtitles: true, dubbing: true });
  });

  it("counts episodes with each playback option", () => {
    expect(countEpisodeAudioAvailability([
      episode([player("English audio + Czech subtitles")]),
      { ...episode([player("CZ dabing")]), id: "episode-2" },
    ])).toEqual({ subtitles: 1, dubbing: 1 });
  });

  it("counts newly added options even when another episode already had them", () => {
    const first = episode([player("English audio + Czech subtitles")]);
    const second = { ...episode([player("English audio")]), id: "episode-2" };
    expect(countAddedEpisodeAudioOptions(
      [first, second],
      [first, { ...second, players: [player("Czech audio", "https://example.com/cs.vtt")] }],
    )).toEqual({ subtitles: 1, dubbing: 1 });
  });
});
