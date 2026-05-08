import { type ClassValue, clsx } from "clsx";
import type {
  CapturePayload,
  ExtractedMediaCandidate,
  ExtractedMediaKind,
  ExtractedSubtitleTrack,
} from "@/lib/types";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function createId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function hostnameFromUrl(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "unknown-source";
  }
}

export function detectMediaKind(
  url: string,
  mimeType?: string,
): ExtractedMediaKind {
  const normalized = url.toLowerCase();
  const mime = mimeType?.toLowerCase() ?? "";

  if (
    normalized.includes(".m3u8") ||
    mime.includes("application/vnd.apple.mpegurl") ||
    mime.includes("application/x-mpegurl")
  ) {
    return "hls";
  }

  if (normalized.includes(".webm") || mime.includes("video/webm")) {
    return "direct_webm";
  }

  if (
    normalized.includes(".mp4") ||
    mime.includes("video/mp4") ||
    mime.includes("video/quicktime")
  ) {
    return "direct_mp4";
  }

  if (
    normalized.includes("/sources/") ||
    /(?:^|\.)(svetserialu\.to|filemoon\.[a-z]+|vidmoly\.[a-z]+|streamtape\.[a-z]+|mixdrop\.[a-z]+)/i.test(
      normalized,
    )
  ) {
    return "embed";
  }

  return "unknown";
}

export function resolveMaybeRelativeUrl(candidateUrl: string, pageUrl: string) {
  try {
    return new URL(candidateUrl, pageUrl).toString();
  } catch {
    return candidateUrl;
  }
}

export function choosePrimaryCandidate(
  mediaCandidates: ExtractedMediaCandidate[],
) {
  const score = (kind: ExtractedMediaKind) => {
    switch (kind) {
      case "hls":
        return 10;
      case "direct_mp4":
        return 9;
      case "direct_webm":
        return 8;
      case "embed":
        return 5;
      case "unknown":
        return 0;
      default:
        return -1;
    }
  };

  const sorted = [...mediaCandidates].sort((a, b) => score(b.kind) - score(a.kind));
  return sorted[0] ?? null;
}


export function normalizeSubtitleTracks(
  tracks: ExtractedSubtitleTrack[],
  pageUrl: string,
) {
  return tracks
    .map((track) => ({
      ...track,
      url: resolveMaybeRelativeUrl(track.url, pageUrl),
    }))
    .filter((track) => track.url);
}

export function sanitizeCapturePayload(payload: CapturePayload): CapturePayload {
  return {
    ...payload,
    pageUrl: resolveMaybeRelativeUrl(payload.pageUrl, payload.pageUrl),
    posterUrl: payload.posterUrl
      ? resolveMaybeRelativeUrl(payload.posterUrl, payload.pageUrl)
      : undefined,
    mediaCandidates: payload.mediaCandidates.map((candidate) => ({
      ...candidate,
      url: resolveMaybeRelativeUrl(candidate.url, payload.pageUrl),
      kind: candidate.kind ?? detectMediaKind(candidate.url, candidate.mimeType),
    })),
    subtitleTracks: normalizeSubtitleTracks(payload.subtitleTracks, payload.pageUrl),
  };
}

export function formatDuration(totalSeconds?: number) {
  if (!totalSeconds || Number.isNaN(totalSeconds)) {
    return "--:--";
  }

  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((totalSeconds / 60) % 60)
    .toString()
    .padStart(2, "0");
  const hours = Math.floor(totalSeconds / 3600);

  return hours > 0 ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
}

export function humanizeHost(host: string) {
  return host.split(".")[0]?.replace(/[-_]/g, " ") ?? host;
}

export function uniqueByUrl<T extends { url: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.url)) {
      return false;
    }
    seen.add(item.url);
    return true;
  });
}
