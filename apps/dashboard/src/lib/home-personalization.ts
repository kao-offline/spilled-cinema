import type { ImportedShow, LibraryEpisode } from "./types";

const DEFAULT_NEW_EPISODE_WINDOW_MS = 45 * 24 * 60 * 60 * 1000;
export const MINIMUM_MEANINGFUL_PLAYBACK_SECONDS = 60;

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

export type RecommendedWatchItem = {
  kind: "recommended-watch";
  reason: "recently-finished" | "deep-progress" | "in-progress" | "new-series";
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

function playbackUpdatedAt(episode: LibraryEpisode, show: ImportedShow) {
  return episode.playbackUpdatedAt ?? episode.importedAt ?? show.importedAt;
}

/**
 * Produces one story-safe recommendation per title. Tiny accidental starts are
 * ignored, and a series can never skip over the episode the viewer was
 * actually watching just because a newer episode has been imported.
 */
export function buildRecommendedWatchItems(
  shows: ImportedShow[],
  options: { now?: number; maxNewSeriesAgeMs?: number; limit?: number } = {},
): RecommendedWatchItem[] {
  const now = options.now ?? Date.now();
  const maxNewSeriesAgeMs = options.maxNewSeriesAgeMs ?? DEFAULT_NEW_EPISODE_WINDOW_MS;
  const limit = options.limit ?? 16;
  const recommendations: Array<RecommendedWatchItem & { priority: number }> = [];

  for (const show of shows) {
    const ordered = [...show.episodes].sort(episodeOrder);
    if (ordered.length === 0) continue;

    if (isMovie(show)) {
      const movie = ordered[0];
      const position = playbackPosition(movie);
      if (position < MINIMUM_MEANINGFUL_PLAYBACK_SECONDS || isCompleted(movie)) continue;
      const progress = progressPercent(movie);
      recommendations.push({
        kind: "recommended-watch",
        reason: progress >= 50 ? "deep-progress" : "in-progress",
        show,
        episode: movie,
        resumeAtSeconds: position,
        progressPercent: progress,
        updatedAt: playbackUpdatedAt(movie, show),
        priority: progress >= 50 ? 1 : 2,
      });
      continue;
    }

    const latestMeaningful = ordered
      .map((episode, index) => ({ episode, index }))
      .filter(({ episode }) => isCompleted(episode) || playbackPosition(episode) >= MINIMUM_MEANINGFUL_PLAYBACK_SECONDS)
      .sort((left, right) => playbackUpdatedAt(right.episode, show) - playbackUpdatedAt(left.episode, show) || right.index - left.index)[0];

    if (latestMeaningful) {
      const partial = !isCompleted(latestMeaningful.episode);
      const candidate = partial
        ? latestMeaningful.episode
        : ordered.slice(latestMeaningful.index + 1).find((episode) => !isCompleted(episode));
      if (!candidate) continue;

      const progress = progressPercent(candidate);
      const completedLast = !partial;
      recommendations.push({
        kind: "recommended-watch",
        reason: completedLast ? "recently-finished" : progress >= 50 ? "deep-progress" : "in-progress",
        show,
        episode: candidate,
        resumeAtSeconds: playbackPosition(candidate) >= MINIMUM_MEANINGFUL_PLAYBACK_SECONDS ? playbackPosition(candidate) : 0,
        progressPercent: playbackPosition(candidate) >= MINIMUM_MEANINGFUL_PLAYBACK_SECONDS ? progress : 0,
        updatedAt: playbackUpdatedAt(latestMeaningful.episode, show),
        priority: completedLast ? 0 : progress >= 50 ? 1 : 2,
      });
      continue;
    }

    const firstEpisode = ordered.find((episode) => !isCompleted(episode));
    if (!firstEpisode) continue;
    const addedAt = firstEpisode.importedAt || show.importedAt;
    if (addedAt <= 0 || addedAt > now + 5 * 60_000 || now - addedAt > maxNewSeriesAgeMs) continue;
    recommendations.push({
      kind: "recommended-watch",
      reason: "new-series",
      show,
      episode: firstEpisode,
      resumeAtSeconds: 0,
      progressPercent: 0,
      updatedAt: addedAt,
      priority: 3,
    });
  }

  return recommendations
    .sort((left, right) => left.priority - right.priority || right.updatedAt - left.updatedAt)
    .slice(0, Math.max(0, limit))
    .map(({ priority: _priority, ...item }) => item);
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
