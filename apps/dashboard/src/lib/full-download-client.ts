import type { LibraryEpisode } from "./types";
import { formatEpisodeTitle } from "./episode-title";
import { requestRuntimeJson, resolveRuntimeUrl } from "./local-api";
import { normalizePlaybackUrlForClient } from "./player-url-cache";

const UNIVERSAL_PLAYBACK_TIMEOUT_MS = 90_000;

export type FullDownloadJobState = "queued" | "resolving" | "downloading" | "completed" | "failed";

export type FullDownloadJob = {
  id: string;
  episodeId: string;
  state: FullDownloadJobState;
  percent: number;
  message: string;
  outputPath?: string;
  error?: string;
};

export type DownloadedArtifacts = {
  episodeIds: string[];
  files: string[];
};

export type BrowserResolvedDownload = {
  downloadUrl: string;
  resolvedUrl: string;
  refererUrl: string;
};

export type CleanPlaybackResult = BrowserResolvedDownload;

export type PlaybackResolveFailure = {
  playerAlias: string;
  provider: string;
  reason: string;
};

export type PlaybackResolveResult = {
  playerAlias: string;
  playbackUrl: string;
  resolvedUrl: string;
  refererUrl: string;
  streamType: "hls" | "mp4" | "dash" | "embed" | "unknown";
  subtitlesUrl?: string;
  duration?: number;
  failures?: PlaybackResolveFailure[];
};

type CleanPlaybackPayload = {
  downloadUrl?: string;
  resolvedUrl?: string;
  refererUrl?: string;
  error?: string;
};

type PlaybackResolvePayload = {
  playerAlias?: string;
  playbackUrl?: string;
  resolvedUrl?: string;
  refererUrl?: string;
  streamType?: "hls" | "mp4" | "dash" | "embed" | "unknown";
  subtitlesUrl?: string;
  failures?: PlaybackResolveFailure[];
  error?: string;
};

type BrowserStreamCandidate = {
  provider?: string;
  embedUrl: string;
  sourcePageUrl?: string;
  subtitlesUrl?: string;
  streamUrl?: string;
  resolvedUrl?: string;
};

function shouldResolvePlayerUrl(provider: string | undefined, embedUrl: string | undefined) {
  const signature = `${provider ?? ""} ${embedUrl ?? ""}`.toLowerCase();
  return /(?:^|[^a-z])(2embed|multiembed|moviesclub|primewire)(?:[^a-z]|$)/i.test(signature);
}

function mediaOriginFromRuntime(origin: string | undefined, transport: string | undefined) {
  // Gateway-transport responses carry the node id as origin when the node has no
  // inbound HTTP endpoint. Media URLs can't be fetched from that origin, so route
  // them through the hosted dashboard proxy (same origin as the page).
  if (transport === "gateway" && origin && !/^https?:\/\//i.test(origin)) {
    return window.location.origin;
  }
  return origin ?? window.location.origin;
}

function absoluteUrl(value: string, base: string) {
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
}

function matchOne(html: string, pattern: RegExp) {
  const match = html.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function extractIframeCandidate(html: string, currentUrl: string) {
  const iframeSrc = matchOne(html, /<iframe[^>]+src=["']([^"'#?][^"']*)["']/i);
  if (!iframeSrc) {
    return null;
  }

  return absoluteUrl(iframeSrc, currentUrl);
}

function extractRedirectCandidate(html: string, currentUrl: string) {
  const candidates = [
    matchOne(html, /window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i),
    matchOne(html, /window\.location\s*=\s*["']([^"']+)["']/i),
    matchOne(html, /top\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i),
    matchOne(html, /parent\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i),
    matchOne(html, /location\.replace\(\s*["']([^"']+)["']\s*\)/i),
    matchOne(html, /location\.assign\(\s*["']([^"']+)["']\s*\)/i),
    matchOne(html, /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["']/i),
  ].filter(Boolean);

  if (candidates.length === 0) {
    return null;
  }

  return absoluteUrl(candidates[0] as string, currentUrl);
}

function chooseResolvedPlayerCandidate(html: string, currentUrl: string, provider: string | undefined) {
  const iframeCandidate = extractIframeCandidate(html, currentUrl);
  const redirectCandidate = extractRedirectCandidate(html, currentUrl);
  const signature = `${provider ?? ""} ${currentUrl}`.toLowerCase();

  if (/moviesclub/.test(signature)) {
    return iframeCandidate ?? null;
  }

  if (/primewire/.test(signature)) {
    return redirectCandidate ?? iframeCandidate ?? null;
  }

  if (/2embed|multiembed/.test(signature)) {
    return iframeCandidate ?? redirectCandidate ?? null;
  }

  return iframeCandidate ?? redirectCandidate ?? null;
}

async function fetchPlayerHtml(targetUrl: string, refererUrl?: string) {
  const response = await fetch(targetUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,cs;q=0.8",
      Referer: refererUrl ?? targetUrl,
    },
  });

  if (!response.ok) {
    throw new Error(`Player page request failed: ${response.status} ${response.statusText}`);
  }

  const finalUrl = response.url || targetUrl;
  const contentType = response.headers.get("content-type") || "";

  if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    return { finalUrl, html: null };
  }

  return {
    finalUrl,
    html: await response.text(),
  };
}

async function resolveBrowserStreamCandidate(candidate: BrowserStreamCandidate) {
  if (!shouldResolvePlayerUrl(candidate.provider, candidate.embedUrl)) {
    return candidate.embedUrl;
  }

  let currentUrl = candidate.embedUrl;
  let refererUrl: string | undefined;
  const visited = new Set<string>();

  for (let depth = 0; depth < 4; depth += 1) {
    if (visited.has(currentUrl)) {
      break;
    }
    visited.add(currentUrl);

    const { finalUrl, html } = await fetchPlayerHtml(currentUrl, refererUrl);
    currentUrl = finalUrl;

    if (!html) {
      return currentUrl;
    }

    const nextCandidate = chooseResolvedPlayerCandidate(html, currentUrl, candidate.provider);
    if (!nextCandidate || nextCandidate === currentUrl || visited.has(nextCandidate)) {
      return currentUrl;
    }

    refererUrl = currentUrl;
    currentUrl = nextCandidate;
  }

  return currentUrl;
}

function buildBrowserStreamCandidates(players: LibraryEpisode["players"]) {
  return players
    .filter((player) => Boolean(player.embedUrl))
    .map((player) => {
      const directUrl = (player as BrowserStreamCandidate).streamUrl ?? (player as BrowserStreamCandidate).resolvedUrl;
      return {
        provider: player.provider,
        embedUrl: player.embedUrl,
        sourcePageUrl: player.sourcePageUrl,
        subtitlesUrl: player.subtitlesUrl,
        ...(directUrl ? { streamUrl: directUrl } : {}),
        ...(typeof (player as BrowserStreamCandidate).resolvedUrl === "string" ? { resolvedUrl: (player as BrowserStreamCandidate).resolvedUrl } : {}),
      } satisfies BrowserStreamCandidate;
    });
}

export async function startFullDownload(episode: LibraryEpisode): Promise<FullDownloadJob> {
  return startFullDownloadAtRuntime(episode);
}

function buildDownloadRequestBody(episode: LibraryEpisode) {
  const activePlayer = episode.players.find((player) => player.alias === episode.selectedPlayerAlias) ?? episode.players[0];
  if (!activePlayer) {
    throw new Error("No player available for this episode.");
  }

  const remotePlayers = episode.players.filter((player) => player.provider !== "local" && player.provider !== "spillsave");
  const sortedPlayers = [
    activePlayer,
    ...remotePlayers.filter((player) => player.alias !== activePlayer.alias),
  ];
  const streamCandidates = buildBrowserStreamCandidates(sortedPlayers);

  return {
    episodeId: episode.id,
    showTitle: episode.showTitle,
    episodeTitle: formatEpisodeTitle(episode),
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
    embedUrl: activePlayer.embedUrl,
    subtitlesUrl: activePlayer.subtitlesUrl,
    streamCandidates,
  };
}

async function startFullDownloadAtRuntime(episode: LibraryEpisode): Promise<FullDownloadJob> {
  const response = await requestRuntimeJson<{ job?: FullDownloadJob; error?: string }>("/api/download-full/start", {
    method: "POST",
    body: buildDownloadRequestBody(episode),
  });
  if (!response.ok || !response.data?.job) {
    throw new Error(response.data?.error ?? "Failed to start full download.");
  }
  return response.data.job;
}

async function nodeFetch<T>(nodeUrl: string, path: string, init: RequestInit = {}) {
  const body = init.body;
  const response = await fetch(`${nodeUrl.replace(/\/+$/, "")}${path}`, {
    ...init,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "text/plain;charset=UTF-8" }),
      ...(init.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => null) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data?.error ?? `Node request failed (${response.status}).`);
  }
  return data;
}

export async function startFullDownloadOnNode(nodeUrl: string, episode: LibraryEpisode): Promise<FullDownloadJob> {
  const response = await nodeFetch<{ job?: FullDownloadJob; error?: string }>(nodeUrl, "/api/download-full/start", {
    method: "POST",
    body: JSON.stringify(buildDownloadRequestBody(episode)),
  });
  if (!response.job) {
    throw new Error(response.error ?? "Failed to start private node download.");
  }
  return response.job;
}

export async function getFullDownloadStatusFromNode(nodeUrl: string, jobId: string): Promise<FullDownloadJob> {
  const response = await nodeFetch<{ job?: FullDownloadJob; error?: string }>(nodeUrl, `/api/download-full/status?jobId=${encodeURIComponent(jobId)}`);
  if (!response.job) {
    throw new Error(response.error ?? "Failed to get private node download status.");
  }
  return response.job;
}

export async function getFullDownloadStatus(jobId: string): Promise<FullDownloadJob> {
  const response = await requestRuntimeJson<{ job?: FullDownloadJob; error?: string }>(`/api/download-full/status?jobId=${encodeURIComponent(jobId)}`);
  if (!response.ok || !response.data?.job) {
    throw new Error(response.data?.error ?? "Failed to get full download status.");
  }
  return response.data.job;
}

export async function checkDownloadExists(episodeId: string): Promise<boolean> {
  try {
    const response = await requestRuntimeJson<{ downloaded?: boolean; error?: string }>(`/api/download-full/check?episodeId=${encodeURIComponent(episodeId)}`);
    return response.ok ? (response.data?.downloaded ?? false) : false;
  } catch {
    return false;
  }
}

export async function listDownloadedEpisodeIds(): Promise<string[]> {
  const artifacts = await listDownloadedArtifacts();
  return artifacts.episodeIds;
}

export async function listDownloadedArtifacts(): Promise<DownloadedArtifacts> {
  try {
    const response = await requestRuntimeJson<{ episodeIds?: string[]; files?: string[]; error?: string }>("/api/download-full/list");
    if (!response.ok || !response.data) {
      return {
        episodeIds: [],
        files: [],
      };
    }
    return {
      episodeIds: Array.isArray(response.data.episodeIds) ? response.data.episodeIds : [],
      files: Array.isArray(response.data.files) ? response.data.files : [],
    };
  } catch {
    return {
      episodeIds: [],
      files: [],
    };
  }
}

export async function deleteDownload(episodeId: string): Promise<void> {
  const response = await requestRuntimeJson<{ deleted?: boolean; error?: string }>("/api/download-full/delete", {
    method: "POST",
    body: { episodeId },
  });
  if (!response.ok || !response.data?.deleted) {
    throw new Error(response.data?.error ?? "Failed to delete download.");
  }
}

export async function cancelDownload(episodeId: string): Promise<FullDownloadJob> {
  const response = await requestRuntimeJson<{ canceled?: boolean; job?: FullDownloadJob; error?: string }>("/api/download-full/cancel", {
    method: "POST",
    body: { episodeId },
  });
  if (!response.ok || !response.data?.canceled || !response.data.job) {
    throw new Error(response.data?.error ?? "Failed to cancel download.");
  }
  return response.data.job;
}

export async function startBrowserResolvedDownload(episode: LibraryEpisode): Promise<BrowserResolvedDownload> {
  const activePlayer = episode.players.find((player) => player.alias === episode.selectedPlayerAlias) ?? episode.players[0];
  if (!activePlayer) {
    throw new Error("No player available for this episode.");
  }

  const remotePlayers = episode.players.filter((player) => player.provider !== "local" && player.provider !== "spillsave");
  const sortedPlayers = [
    activePlayer,
    ...remotePlayers.filter((player) => player.alias !== activePlayer.alias),
  ];

  const streamCandidates = buildBrowserStreamCandidates(sortedPlayers);
  const isHostedDeployment = !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  let runtimeError: string | null = null;

  try {
    const response = await requestRuntimeJson<{ downloadUrl?: string; resolvedUrl?: string; refererUrl?: string; error?: string }>("/api/download-full/browser-start", {
      method: "POST",
      body: {
        episodeId: episode.id,
        showTitle: episode.showTitle,
        episodeTitle: formatEpisodeTitle(episode),
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        embedUrl: activePlayer.embedUrl,
        subtitlesUrl: activePlayer.subtitlesUrl,
        streamCandidates,
      },
    });

    if (response.ok && response.data?.downloadUrl && response.data?.resolvedUrl && response.data?.refererUrl) {
      return {
        downloadUrl: resolveRuntimeUrl(response.data.downloadUrl, mediaOriginFromRuntime(response.origin, response.transport)),
        resolvedUrl: response.data.resolvedUrl,
        refererUrl: response.data.refererUrl,
      };
    }

    runtimeError = response.data?.error ?? `Fetch server returned ${response.status}.`;
  } catch (error) {
    runtimeError = error instanceof Error ? error.message : String(error);
  }

  if (isHostedDeployment) {
    throw new Error(runtimeError ?? "Failed to resolve stream through a fetch server.");
  }

  const localCandidate = streamCandidates.find((candidate) => candidate.streamUrl || candidate.resolvedUrl) ?? streamCandidates[0];
  if (!localCandidate) {
    throw new Error("Failed to resolve stream for browser download.");
  }

  const resolvedUrl = localCandidate.streamUrl ?? localCandidate.resolvedUrl ?? (await resolveBrowserStreamCandidate(localCandidate));
  return {
    downloadUrl: resolvedUrl,
    resolvedUrl,
    refererUrl: localCandidate.embedUrl,
  };
}

export async function resolveCleanPlayback(episode: LibraryEpisode): Promise<CleanPlaybackResult> {
  const activePlayer = episode.players.find((player) => player.alias === episode.selectedPlayerAlias) ?? episode.players[0];
  if (!activePlayer) {
    throw new Error("No player available for this episode.");
  }

  if (activePlayer.provider === "local" || activePlayer.provider === "spillsave") {
    throw new Error("Local players do not need clean playback resolution.");
  }

  const remotePlayers = episode.players.filter((player) => player.provider !== "local" && player.provider !== "spillsave");
  const sortedPlayers = [
    activePlayer,
    ...remotePlayers.filter((player) => player.alias !== activePlayer.alias),
  ];

  const body = {
    episodeId: episode.id,
    showTitle: episode.showTitle,
    episodeTitle: formatEpisodeTitle(episode),
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
    embedUrl: activePlayer.embedUrl,
    subtitlesUrl: activePlayer.subtitlesUrl,
    streamCandidates: buildBrowserStreamCandidates(sortedPlayers),
  };

  if (["localhost", "127.0.0.1", "::1"].includes(window.location.hostname) && !window.spilledNative?.serverUrl) {
    const directResponse = await fetch("/api/player/clean-resolve", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await directResponse.json().catch(() => null) as CleanPlaybackPayload | null;
    if (!directResponse.ok || !data?.downloadUrl || !data.resolvedUrl || !data.refererUrl) {
      throw new Error(data?.error ?? "Clean playback is unavailable for this player.");
    }
    return {
      downloadUrl: resolveRuntimeUrl(data.downloadUrl, window.location.origin),
      resolvedUrl: data.resolvedUrl,
      refererUrl: data.refererUrl,
    };
  }

  const response = await requestRuntimeJson<CleanPlaybackPayload>("/api/player/clean-resolve", {
    method: "POST",
    body,
  });

  if (!response.ok || !response.data?.downloadUrl || !response.data.resolvedUrl || !response.data.refererUrl) {
    throw new Error(response.data?.error ?? "Clean playback is unavailable for this player.");
  }

  return {
    downloadUrl: normalizePlaybackUrlForClient(resolveRuntimeUrl(response.data.downloadUrl, mediaOriginFromRuntime(response.origin, response.transport))),
    resolvedUrl: response.data.resolvedUrl,
    refererUrl: response.data.refererUrl,
  };
}

export async function resolveUniversalPlayback(episode: LibraryEpisode): Promise<PlaybackResolveResult> {
  const activePlayer = episode.players.find((player) => player.alias === episode.selectedPlayerAlias) ?? episode.players[0];
  if (!activePlayer) {
    throw new Error("No player available for this episode.");
  }

  const payload = {
    episodeId: episode.id,
    showTitle: episode.showTitle,
    episodeTitle: formatEpisodeTitle(episode),
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
    activePlayerAlias: activePlayer.alias,
    players: episode.players,
  };

  const handlePayload = (data: PlaybackResolvePayload | null, origin: string) => {
    if (!data?.playerAlias || !data.playbackUrl || !data.resolvedUrl || !data.refererUrl) {
      const error = Object.assign(new Error(data?.error ?? "Universal playback is unavailable for this episode."), {
        failures: data?.failures ?? [],
      });
      throw error;
    }
    return {
      playerAlias: data.playerAlias,
      playbackUrl: normalizePlaybackUrlForClient(resolveRuntimeUrl(data.playbackUrl, origin)),
      resolvedUrl: data.resolvedUrl,
      refererUrl: data.refererUrl,
      streamType: data.streamType ?? "unknown",
      subtitlesUrl: data.subtitlesUrl,
      failures: data.failures,
    } satisfies PlaybackResolveResult;
  };

  if (["localhost", "127.0.0.1", "::1"].includes(window.location.hostname) && !window.spilledNative?.serverUrl) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), UNIVERSAL_PLAYBACK_TIMEOUT_MS);
    let directResponse: Response;
    try {
      directResponse = await fetch("/api/player/playback-resolve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("Clean playback resolution timed out. Loading the provider player instead.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
    const data = await directResponse.json().catch(() => null) as PlaybackResolvePayload | null;
    if (!directResponse.ok) {
      const error = Object.assign(new Error(data?.error ?? "Universal playback is unavailable for this episode."), {
        failures: data?.failures ?? [],
      });
      throw error;
    }
    return handlePayload(data, window.location.origin);
  }

  let timeout: number | undefined;
  const response = await Promise.race([
    requestRuntimeJson<PlaybackResolvePayload>("/api/player/playback-resolve", {
      method: "POST",
      body: payload,
    }),
    new Promise<never>((_resolve, reject) => {
      timeout = window.setTimeout(
        () => reject(new Error("Clean playback resolution timed out. Loading the provider player instead.")),
        UNIVERSAL_PLAYBACK_TIMEOUT_MS,
      );
    }),
  ]).finally(() => {
    if (timeout !== undefined) window.clearTimeout(timeout);
  });

  if (!response.ok) {
    const error = Object.assign(new Error(response.data?.error ?? "Universal playback is unavailable for this episode."), {
      failures: response.data?.failures ?? [],
    });
    throw error;
  }

  return handlePayload(response.data ?? null, mediaOriginFromRuntime(response.origin, response.transport));
}
