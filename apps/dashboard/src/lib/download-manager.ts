import type { FullDownloadJobState } from "./full-download-client";

export type PersistentDownloadJob = {
  episodeId: string;
  jobId: string;
  showTitle: string;
  episodeTitle?: string | null;
  seasonNumber: number;
  episodeNumber: number | null;
  episodeCode: string | null;
  selectedPlayerAlias: string;
  playerLabel: string;
  language?: string;
  state: FullDownloadJobState;
  percent: number;
  message: string;
  outputPath?: string;
  error?: string;
  updatedAt: number;
};

export type PersistentDownloadQueue = Record<string, PersistentDownloadJob>;

const STORAGE_KEY = "spilled-library.download-queue.v1";

function canUseStorage() {
  return typeof window !== "undefined";
}

export function readDownloadQueue(): PersistentDownloadQueue {
  if (!canUseStorage()) {
    return {};
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return parsed as PersistentDownloadQueue;
  } catch {
    return {};
  }
}

export function writeDownloadQueue(queue: PersistentDownloadQueue) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

export function replaceDownloadQueue(queue: unknown): PersistentDownloadQueue {
  if (!queue || typeof queue !== "object") {
    writeDownloadQueue({});
    return {};
  }

  const nextQueue = queue as PersistentDownloadQueue;
  writeDownloadQueue(nextQueue);
  return nextQueue;
}

export function removeDownloadQueueItem(queue: PersistentDownloadQueue, episodeId: string): PersistentDownloadQueue {
  const next = { ...queue };
  delete next[episodeId];
  return next;
}
