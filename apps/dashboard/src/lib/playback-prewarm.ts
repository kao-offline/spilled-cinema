function isHlsPlaybackUrl(value: string) {
  return /\.m3u8(?:$|[?#])|\/hls3\//i.test(value);
}

function isMp4PlaybackUrl(value: string) {
  return /\.mp4(?:$|[?#])|\/get_video\?/i.test(value);
}

function inferPlaybackKind(playbackUrl: string) {
  try {
    const parsed = new URL(playbackUrl, window.location.origin);
    const proxiedUrl = parsed.searchParams.get("url") ?? playbackUrl;
    const name = parsed.searchParams.get("name") ?? "";
    if (isHlsPlaybackUrl(proxiedUrl) || /\.m3u8$/i.test(name)) return "hls";
    if (isMp4PlaybackUrl(proxiedUrl) || /\.mp4$/i.test(name)) return "mp4";
  } catch {
    if (isHlsPlaybackUrl(playbackUrl)) return "hls";
    if (isMp4PlaybackUrl(playbackUrl)) return "mp4";
  }
  return "unknown";
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function prewarmPlaybackUrl(playbackUrl: string) {
  if (typeof window === "undefined" || !playbackUrl) {
    return;
  }

  const kind = inferPlaybackKind(playbackUrl);
  try {
    if (kind === "hls") {
      const playlistResponse = await fetchWithTimeout(playbackUrl, {
        cache: "force-cache",
        credentials: "same-origin",
      }, 1200);
      if (!playlistResponse.ok) {
        return;
      }
      await playlistResponse.arrayBuffer().catch(() => undefined);
      return;
    }

    if (kind === "mp4") {
      const response = await fetchWithTimeout(playbackUrl, {
        cache: "force-cache",
        credentials: "same-origin",
        headers: { Range: "bytes=0-65535" },
      }, 1000).catch(() => undefined);
      await response?.arrayBuffer().catch(() => undefined);
    }
  } catch {
    // Prewarming is opportunistic; playback still owns errors.
  }
}
