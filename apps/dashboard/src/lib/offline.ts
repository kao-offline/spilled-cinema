import type { LibraryEpisode } from "./types";

const EPISODE_CACHE = "spilled-library-episode-cache-v1";
const OPAQUE_FALLBACK_BYTES = 2 * 1024 * 1024;

type DownloadOptions = {
  maxBytes: number;
  currentBytes: number;
  onProgress?: (progress: { completed: number; total: number; percent: number }) => void;
};

export type OfflineDownloadResult = {
  urls: string[];
  sizeBytes: number;
};

function normalizeUrl(url: string): string | null {
  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return null;
  }
}

export function getEpisodeOfflineUrls(episode: LibraryEpisode): string[] {
  const candidates = [episode.episodeUrl];

  // Skip embedUrl - it may be internal API endpoints that return 404
  // Only cache the source page info and subtitles for offline metadata
  for (const player of episode.players) {
    candidates.push(player.sourcePageUrl);
    if (player.subtitlesUrl) {
      candidates.push(player.subtitlesUrl);
    }
  }

  const normalized = candidates
    .map((entry) => normalizeUrl(entry))
    .filter((entry): entry is string => Boolean(entry));

  return Array.from(new Set(normalized));
}

export async function downloadEpisodeForOffline(
  episode: LibraryEpisode,
  options: DownloadOptions,
): Promise<OfflineDownloadResult> {
  if (!("caches" in window)) {
    throw new Error("Your browser does not support the Cache API.");
  }

  const cache = await caches.open(EPISODE_CACHE);
  const urls = getEpisodeOfflineUrls(episode);
  const cached: string[] = [];
  const cachedRequests: Request[] = [];
  let totalAddedBytes = 0;
  let completed = 0;

  options.onProgress?.({ completed: 0, total: urls.length, percent: 0 });

  for (const url of urls) {
    const request = new Request(url, {
      mode: "no-cors",
      credentials: "omit",
      cache: "reload",
    });

    try {
      const response = await fetch(request);
      if (response.ok || response.type === "opaque") {
        const contentLengthHeader = response.headers.get("content-length");
        const parsedHeaderSize = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : Number.NaN;
        let responseSize = Number.isFinite(parsedHeaderSize) && parsedHeaderSize > 0 ? parsedHeaderSize : 0;

        if (!responseSize && response.type !== "opaque") {
          const clonedBuffer = await response.clone().arrayBuffer();
          responseSize = clonedBuffer.byteLength;
        }

        if (!responseSize && response.type === "opaque") {
          responseSize = OPAQUE_FALLBACK_BYTES;
        }

        if (options.currentBytes + totalAddedBytes + responseSize > options.maxBytes) {
          await Promise.all(cachedRequests.map((entry) => cache.delete(entry)));
          throw new Error("Offline limit reached. Increase max storage in Settings or remove downloaded episodes.");
        }

        await cache.put(request, response.clone());
        cached.push(url);
        cachedRequests.push(request);
        totalAddedBytes += responseSize;
      }
    } catch {
      // Best effort: some origins may block fetch/caching for no-cors requests.
    } finally {
      completed += 1;
      const percent = urls.length > 0 ? Math.round((completed / urls.length) * 100) : 100;
      options.onProgress?.({ completed, total: urls.length, percent });
    }
  }

  if (cached.length === 0) {
    throw new Error("No episode assets could be cached for offline use.");
  }

  return {
    urls: cached,
    sizeBytes: totalAddedBytes,
  };
}

export async function removeEpisodeFromOfflineCache(urls: string[]): Promise<void> {
  if (!("caches" in window)) {
    return;
  }

  const cache = await caches.open(EPISODE_CACHE);
  await Promise.all(urls.map((url) => cache.delete(url, { ignoreVary: true })));
}

export async function clearOfflineCache(): Promise<void> {
  if (!("caches" in window)) {
    return;
  }
  await caches.delete(EPISODE_CACHE);
}
