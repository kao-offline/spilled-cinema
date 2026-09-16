import type { LibraryEpisode } from "./types";

export type SeasonGroup = [season: number, episodes: LibraryEpisode[]];

/** Episodes oldest-first, grouped into seasons oldest-first. Shared by the TV detail and TV player picker. */
export function groupEpisodesBySeason(episodes: LibraryEpisode[]): SeasonGroup[] {
  const sorted = [...episodes].sort(
    (left, right) =>
      left.seasonNumber - right.seasonNumber ||
      (left.episodeNumber ?? 0) - (right.episodeNumber ?? 0),
  );
  const map = new Map<number, LibraryEpisode[]>();
  for (const episode of sorted) {
    const list = map.get(episode.seasonNumber) ?? [];
    list.push(episode);
    map.set(episode.seasonNumber, list);
  }
  return Array.from(map.entries()).sort((left, right) => left[0] - right[0]);
}

/** 0-100 resume percent. 100 only when fully watched. */
export function episodeProgressPercent(episode: LibraryEpisode): number {
  if (episode.watched) return 100;
  const duration = episode.playbackDurationSeconds ?? episode.durationSeconds ?? 0;
  const position = episode.playbackPositionSeconds ?? 0;
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position) || position <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((position / duration) * 100)));
}

export function episodeCodeLabel(episode: LibraryEpisode): string {
  if (episode.episodeCode) return episode.episodeCode.toUpperCase();
  if (episode.episodeNumber != null) {
    return `S${episode.seasonNumber} E${episode.episodeNumber}`;
  }
  return `Season ${episode.seasonNumber}`;
}
