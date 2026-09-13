import type { ImportedShow, LibraryEpisode } from "./types";

const DEFAULT_NEW_EPISODE_WINDOW_MS = 45 * 24 * 60 * 60 * 1000;

export type NewEpisodeItem = {
  kind: "new-episode";
  show: ImportedShow;
  episode: LibraryEpisode;
  addedAt: number;
  hasWatchHistory: boolean;
  lastInteractionAt: number;
};

export type ContinueWatchingItem = {
  kind: "next-episode" | "resume-film";
  show: ImportedShow;
  episode: LibraryEpisode;
  resumeAtSeconds: number;
  progressPercent: number;
  updatedAt: number;
};

export const PLAYBACK_PROVIDER_COLORS = {
  bombuj: "#facc15",
  svetserialu: "#38bdf8",
  vidking: "#ef4444",
  spillshare: "#ffffff",
} as const;

export function getPlaybackProgressColor(episode: LibraryEpisode) {
  const selectedPlayer = episode.players.find((player) => player.alias === episode.selectedPlayerAlias) ?? episode.players[0];
  const signature = [selectedPlayer?.provider, selectedPlayer?.label, selectedPlayer?.alias, selectedPlayer?.embedUrl, episode.episodeUrl]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (signature.includes("bombuj")) return PLAYBACK_PROVIDER_COLORS.bombuj;
  if (signature.includes("svetserial")) return PLAYBACK_PROVIDER_COLORS.svetserialu;
  if (signature.includes("vidking")) return PLAYBACK_PROVIDER_COLORS.vidking;
  if (/spillshare|spillsave|\blocal\b/.test(signature)) return PLAYBACK_PROVIDER_COLORS.spillshare;
  return "rgba(255,255,255,.78)";
}

function isMovie(show: ImportedShow) {
  return show.mediaType === "movie"
    || show.episodes.some((episode) => episode.episodeCode === "movie")
    || (show.mediaType !== "serial" && show.episodes.length === 1);
}

function episodeOrder(left: LibraryEpisode, right: LibraryEpisode) {
  return left.seasonNumber - right.seasonNumber
    || (left.episodeNumber ?? 0) - (right.episodeNumber ?? 0)
    || left.importedAt - right.importedAt;
}

function playbackDuration(episode: LibraryEpisode) {
  const value = episode.playbackDurationSeconds ?? episode.durationSeconds ?? 0;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function playbackPosition(episode: LibraryEpisode) {
  const value = episode.playbackPositionSeconds ?? 0;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function progressPercent(episode: LibraryEpisode) {
  const duration = playbackDuration(episode);
  if (duration <= 0) return playbackPosition(episode) > 0 ? 1 : 0;
  return Math.max(0, Math.min(100, Math.round((playbackPosition(episode) / duration) * 100)));
}

function isCompleted(episode: LibraryEpisode) {
  if (episode.watched) return true;
  const duration = playbackDuration(episode);
  return duration > 0 && playbackPosition(episode) >= Math.max(30, duration * 0.9);
}

export function buildNewEpisodeItems(
  shows: ImportedShow[],
  options: { now?: number; maxAgeMs?: number; limit?: number } = {},
): NewEpisodeItem[] {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_NEW_EPISODE_WINDOW_MS;
  const limit = options.limit ?? 16;

  return shows
    .filter((show) => !isMovie(show))
    .map((show): NewEpisodeItem | null => {
      const ordered = [...show.episodes].sort(episodeOrder);
      const interacted = ordered.filter((episode) => episode.watched || playbackPosition(episode) > 0);
      const completed = ordered.filter(isCompleted);
      const lastCompleted = completed.at(-1);
      const candidate = lastCompleted
        ? ordered.slice(ordered.indexOf(lastCompleted) + 1).find((episode) => !isCompleted(episode))
        : ordered.find((episode) => !isCompleted(episode));
      if (!candidate) return null;
      const addedAt = candidate.importedAt || show.importedAt;
      if (addedAt <= 0 || addedAt > now + 5 * 60_000 || now - addedAt > maxAgeMs) return null;
      return {
        kind: "new-episode",
        show,
        episode: candidate,
        addedAt,
        hasWatchHistory: interacted.length > 0,
        lastInteractionAt: interacted.reduce((latest, episode) => Math.max(latest, episode.playbackUpdatedAt ?? 0), 0),
      };
    })
    .filter((item): item is NewEpisodeItem => Boolean(item))
    .sort((left, right) => Number(right.hasWatchHistory) - Number(left.hasWatchHistory)
      || right.lastInteractionAt - left.lastInteractionAt
      || right.addedAt - left.addedAt)
    .slice(0, Math.max(0, limit));
}

export function buildContinueWatchingItems(shows: ImportedShow[], limit = 12): ContinueWatchingItem[] {
  const items: ContinueWatchingItem[] = [];

  for (const show of shows) {
    const ordered = [...show.episodes].sort(episodeOrder);
    if (ordered.length === 0) continue;

    if (isMovie(show)) {
      const movie = ordered[0];
      const position = playbackPosition(movie);
      if (position <= 0 || isCompleted(movie)) continue;
      items.push({
        kind: "resume-film",
        show,
        episode: movie,
        resumeAtSeconds: position,
        progressPercent: progressPercent(movie),
        updatedAt: movie.playbackUpdatedAt ?? show.importedAt,
      });
      continue;
    }

    const interacted = ordered
      .map((episode, index) => ({ episode, index }))
      .filter(({ episode }) => Boolean(episode.watched) || playbackPosition(episode) > 0)
      .sort((left, right) => (right.episode.playbackUpdatedAt ?? 0) - (left.episode.playbackUpdatedAt ?? 0) || right.index - left.index)[0];
    if (!interacted) continue;

    const currentIsPartial = !isCompleted(interacted.episode) && playbackPosition(interacted.episode) > 0;
    const nextEpisode = currentIsPartial
      ? interacted.episode
      : ordered.slice(interacted.index + 1).find((episode) => !isCompleted(episode));
    if (!nextEpisode) continue;

    items.push({
      kind: "next-episode",
      show,
      episode: nextEpisode,
      resumeAtSeconds: playbackPosition(nextEpisode),
      progressPercent: progressPercent(nextEpisode),
      updatedAt: Math.max(
        interacted.episode.playbackUpdatedAt ?? 0,
        nextEpisode.playbackUpdatedAt ?? 0,
        show.importedAt,
      ),
    });
  }

  return items
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, Math.max(0, limit));
}
