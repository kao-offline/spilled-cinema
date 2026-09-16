export type PlaybackProgressRecord = {
  key: string;
  position: number;
  duration: number;
  watched: boolean;
  updatedAt: number;
};

export function mergePlaybackProgress(existing: Record<string, PlaybackProgressRecord>, updates: PlaybackProgressRecord[], now = Date.now()) {
  if (!Array.isArray(updates) || updates.length > 100) throw new Error("Send at most 100 playback updates.");
  const merged = new Map(Object.entries(existing));
  for (const entry of updates) {
    if (!entry || typeof entry.key !== "string" || !entry.key.includes(":") || entry.key.length > 512
      || !Number.isFinite(entry.position) || entry.position < 0 || entry.position > 604800
      || !Number.isFinite(entry.duration) || entry.duration < 0 || entry.duration > 604800
      || typeof entry.watched !== "boolean" || !Number.isFinite(entry.updatedAt) || entry.updatedAt <= 0 || entry.updatedAt > now + 300_000) throw new Error("Invalid playback progress.");
    if ((merged.get(entry.key)?.updatedAt ?? 0) >= entry.updatedAt) continue;
    merged.set(entry.key, { key: entry.key, position: entry.position, duration: entry.duration, watched: entry.watched, updatedAt: entry.updatedAt });
  }
  return Object.fromEntries([...merged].sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 5000));
}
