import type { PlaybackProgressRecord } from "../../../../packages/storage/src/playback-progress";
import type { ImportedShow, LibraryEpisode, LibraryState } from "./types";
import { readPrivateNodeConnection, type PrivateNodeConnection } from "./private-node-client";
import { scheduleEpisodeRefresh } from "./episode-refresh";

const UPDATE_EVENT = "spilled:playback-progress";
function scope(connection: PrivateNodeConnection) {
  return JSON.stringify([connection.nodeUrl, connection.accountId, connection.profileId]);
}
function queueKey(connection: PrivateNodeConnection) { return `spilled.playback-pending.v1:${scope(connection)}`; }
function readQueue(connection: PrivateNodeConnection): Record<string, PlaybackProgressRecord> {
  try { return JSON.parse(localStorage.getItem(queueKey(connection)) ?? "{}"); } catch { return {}; }
}

export function playbackIdentity(show: ImportedShow, episode: LibraryEpisode) {
  const type = show.mediaType === "movie" || episode.episodeCode === "movie" ? "movie" : "serial";
  const title = show.externalIds?.tmdb ? `tmdb:${show.externalIds.tmdb}` : show.externalIds?.imdb ? `imdb:${show.externalIds.imdb}` : `slug:${show.slug}`;
  return `${type}:${title}:${episode.seasonNumber}:${episode.episodeNumber ?? episode.episodeCode ?? episode.id}`;
}

export function applyPrivatePlaybackProgress(state: LibraryState, records: Record<string, PlaybackProgressRecord>, force = false) {
  let changed = false;
  const shows = state.shows.map((show) => ({ ...show, episodes: show.episodes.map((episode) => {
    const record = records[playbackIdentity(show, episode)];
    if (!record || !Number.isFinite(record.position) || !Number.isFinite(record.updatedAt) || (!force && record.updatedAt <= (episode.playbackUpdatedAt ?? 0))) return episode;
    if (record.updatedAt === episode.playbackUpdatedAt && record.position === episode.playbackPositionSeconds && record.watched === episode.watched) return episode;
    changed = true;
    return { ...episode, playbackPositionSeconds: record.position, playbackDurationSeconds: record.duration || episode.playbackDurationSeconds, watched: record.watched, playbackUpdatedAt: record.updatedAt };
  }) }));
  return changed ? { ...state, shows } : state;
}

/** Queue only interaction performed for the signed-in profile, never the entire local library. */
export function queuePrivatePlaybackProgress(state: LibraryState, episodeId: string, flush = false) {
  const connection = readPrivateNodeConnection();
  if (!connection.nodeUrl || !connection.token || !connection.accountId || !connection.profileId) return;
  const show = state.shows.find((item) => item.episodes.some((episode) => episode.id === episodeId));
  const episode = show?.episodes.find((item) => item.id === episodeId);
  if (!show || !episode) return;
  const key = playbackIdentity(show, episode);
  const record: PlaybackProgressRecord = { key, position: episode.playbackPositionSeconds ?? 0, duration: episode.playbackDurationSeconds ?? episode.durationSeconds ?? 0, watched: Boolean(episode.watched), updatedAt: episode.playbackUpdatedAt ?? Date.now() };
  try {
    const queue = { ...readQueue(connection), [key]: record };
    localStorage.setItem(queueKey(connection), JSON.stringify(Object.fromEntries(Object.entries(queue).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 1000))));
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: { flush } }));
  } catch { /* The main library still holds the local resume position. */ }
}

export function startPrivatePlaybackSync(connection: PrivateNodeConnection, callbacks: {
  getState: () => LibraryState;
  onState: (state: LibraryState) => void;
  onError: (message: string) => void;
}) {
  if (!connection.nodeUrl || !connection.token || !connection.accountId || !connection.profileId) return () => {};
  let disposed = false;
  let active = false;
  let hydrated = false;
  let errorReported = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const url = `${connection.nodeUrl}/api/node/private/library?profileId=${encodeURIComponent(connection.profileId)}`;
  const current = () => !disposed && scope(readPrivateNodeConnection()) === scope(connection);
  const run = async () => {
    if (!current() || active || !navigator.onLine) return true;
    active = true;
    try {
      const queue = readQueue(connection);
      const updates = Object.values(queue).slice(0, 100);
      const response = await fetch(url, { method: updates.length ? "POST" : "GET", headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json", "bypass-tunnel-reminder": "true" }, body: updates.length ? JSON.stringify({ playbackProgress: updates }) : undefined, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error("Private progress sync is unavailable. Your position is saved on this device; reconnect to your node to sync.");
      const payload = await response.json() as { playbackProgressSupported?: boolean; playbackProgress?: Record<string, PlaybackProgressRecord>; profile?: { playbackProgress?: Record<string, PlaybackProgressRecord> } };
      if (!payload.playbackProgress && !payload.playbackProgressSupported) throw new Error("This node needs an update for cross-device resume. Playback is saved on this device.");
      if (!current()) return true;
      const records = payload.playbackProgress ?? payload.profile?.playbackProgress ?? {};
      const pending = readQueue(connection);
      for (const entry of updates) if (pending[entry.key]?.updatedAt === entry.updatedAt && (records[entry.key]?.updatedAt ?? 0) >= entry.updatedAt) delete pending[entry.key];
      localStorage.setItem(queueKey(connection), JSON.stringify(pending));
      const merged = { ...records };
      for (const entry of Object.values(pending)) if ((merged[entry.key]?.updatedAt ?? 0) < entry.updatedAt) merged[entry.key] = entry;
      const state = callbacks.getState();
      const next = applyPrivatePlaybackProgress(state, merged, !hydrated);
      if (next !== state) callbacks.onState(next);
      hydrated = true;
      errorReported = false;
      return true;
    } catch (error) {
      if (current() && !errorReported) callbacks.onError(error instanceof Error ? error.message : "Private progress sync is temporarily unavailable.");
      errorReported = true;
      return false;
    } finally { active = false; }
  };
  const update = (event: Event) => {
    if ((event as CustomEvent<{ flush?: boolean }>).detail?.flush) { clearTimeout(timer); timer = undefined; void run(); }
    else if (!timer) timer = setTimeout(() => { timer = undefined; void run(); }, 15_000);
  };
  window.addEventListener(UPDATE_EVENT, update);
  const stop = scheduleEpisodeRefresh(run, 60_000);
  return () => { disposed = true; stop(); clearTimeout(timer); window.removeEventListener(UPDATE_EVENT, update); };
}
