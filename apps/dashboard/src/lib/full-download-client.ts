import type { LibraryEpisode } from "./types";
import { formatEpisodeTitle } from "./episode-title";
import { requestRuntimeJson, resolveRuntimeUrl } from "./local-api";

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

export async function startFullDownload(episode: LibraryEpisode): Promise<FullDownloadJob> {
  const activePlayer = episode.players.find((player) => player.alias === episode.selectedPlayerAlias) ?? episode.players[0];
  if (!activePlayer) {
    throw new Error("No player available for this episode.");
  }

  const remotePlayers = episode.players.filter((player) => player.provider !== "local" && player.provider !== "spillsave");
  const sortedPlayers = [
    activePlayer,
    ...remotePlayers.filter((player) => player.alias !== activePlayer.alias),
  ];
  const streamCandidates = sortedPlayers
    .filter((player) => Boolean(player.embedUrl))
    .map((player) => ({
      embedUrl: player.embedUrl,
      subtitlesUrl: player.subtitlesUrl,
    }));

  const response = await requestRuntimeJson<{ job?: FullDownloadJob; error?: string }>("/api/download-full/start", {
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
  if (!response.ok || !response.data?.job) {
    throw new Error(response.data?.error ?? "Failed to start full download.");
  }
  return response.data.job;
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

  const streamCandidates = sortedPlayers
    .filter((player) => Boolean(player.embedUrl))
    .map((player) => ({
      embedUrl: player.embedUrl,
      subtitlesUrl: player.subtitlesUrl,
    }));

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
  if (!response.ok || !response.data?.downloadUrl || !response.data?.resolvedUrl || !response.data?.refererUrl) {
    throw new Error(response.data?.error ?? "Failed to resolve stream for browser download.");
  }

  return {
    downloadUrl: resolveRuntimeUrl(response.data.downloadUrl, response.origin),
    resolvedUrl: response.data.resolvedUrl,
    refererUrl: response.data.refererUrl,
  };
}
