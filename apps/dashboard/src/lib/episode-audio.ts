import type { EpisodePlayer, LibraryEpisode } from "./types";
import { getCanonicalLanguageKey } from "./language";

export type EpisodeAudioAvailability = {
  subtitles: boolean;
  dubbing: boolean;
};

export function playerHasSubtitles(player: EpisodePlayer) {
  return Boolean(player.subtitlesUrl) || getCanonicalLanguageKey(player.language).includes("subs");
}

export function playerHasDubbing(player: EpisodePlayer) {
  const languageKey = getCanonicalLanguageKey(player.language);
  return languageKey === "cz-audio" || languageKey === "sk-audio" || /\b(?:dub|dubbed|dubbing|dabing)\b/i.test(`${player.language ?? ""} ${player.label}`);
}

export function getEpisodeAudioAvailability(episode: LibraryEpisode): EpisodeAudioAvailability {
  return {
    subtitles: episode.players.some(playerHasSubtitles),
    dubbing: episode.players.some(playerHasDubbing),
  };
}

export function countEpisodeAudioAvailability(episodes: LibraryEpisode[]) {
  return episodes.reduce(
    (counts, episode) => {
      const availability = getEpisodeAudioAvailability(episode);
      if (availability.subtitles) counts.subtitles += 1;
      if (availability.dubbing) counts.dubbing += 1;
      return counts;
    },
    { subtitles: 0, dubbing: 0 },
  );
}

export function countAddedEpisodeAudioOptions(before: LibraryEpisode[], after: LibraryEpisode[]) {
  const beforeById = new Map(before.map((episode) => [episode.id, getEpisodeAudioAvailability(episode)]));
  return after.reduce(
    (counts, episode) => {
      const previous = beforeById.get(episode.id) ?? { subtitles: false, dubbing: false };
      const current = getEpisodeAudioAvailability(episode);
      if (!previous.subtitles && current.subtitles) counts.subtitles += 1;
      if (!previous.dubbing && current.dubbing) counts.dubbing += 1;
      return counts;
    },
    { subtitles: 0, dubbing: 0 },
  );
}
