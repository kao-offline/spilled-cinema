import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CapturePayload, CaptureSession, LibraryToken, MediaItem } from "@/lib/types";
import { createId } from "@/lib/utils";
import { resolveMediaCandidate } from "./media-resolver";


type LibraryRecord = {
  token: LibraryToken;
  createdAt: number;
  lastSeenAt: number;
};

type AppStore = {
  libraries: Record<string, LibraryRecord>;
  captureSessions: Record<string, CaptureSession>;
  mediaItems: Record<string, MediaItem>;
};

const DATA_DIR = path.join(process.cwd(), ".spilledcinema-data");
const STORE_PATH = path.join(DATA_DIR, "store.json");

const emptyStore = (): AppStore => ({
  libraries: {},
  captureSessions: {},
  mediaItems: {},
});

let writeQueue = Promise.resolve();

async function ensureStoreFile() {
  await mkdir(DATA_DIR, { recursive: true });

  try {
    await readFile(STORE_PATH, "utf8");
  } catch {
    await writeFile(STORE_PATH, JSON.stringify(emptyStore(), null, 2), "utf8");
  }
}

async function readStore() {
  await ensureStoreFile();

  try {
    const raw = await readFile(STORE_PATH, "utf8");
    return JSON.parse(raw) as AppStore;
  } catch {
    return emptyStore();
  }
}

async function writeStore(store: AppStore) {
  await ensureStoreFile();
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

async function mutateStore<T>(mutator: (store: AppStore) => T | Promise<T>) {
  const operation = writeQueue.then(async () => {
    const store = await readStore();
    const result = await mutator(store);
    await writeStore(store);
    return result;
  });

  writeQueue = operation.then(
    () => undefined,
    () => undefined,
  );

  return operation;
}

export async function bootstrapLibrary(libraryToken?: string | null) {
  return mutateStore((store) => {
    const now = Date.now();
    const token = libraryToken ?? createId("lib");
    const existing = store.libraries[token];

    store.libraries[token] = existing
      ? { ...existing, lastSeenAt: now }
      : {
          token,
          createdAt: now,
          lastSeenAt: now,
        };

    return store.libraries[token];
  });
}

export async function createCaptureSession(libraryToken: string, sourcePageUrl: string) {
  return mutateStore((store) => {
    const now = Date.now();

    store.libraries[libraryToken] ??= {
      token: libraryToken,
      createdAt: now,
      lastSeenAt: now,
    };
    store.libraries[libraryToken].lastSeenAt = now;

    const session: CaptureSession = {
      id: createId("cap"),
      libraryToken,
      sourcePageUrl,
      status: "pending",
      createdAt: now,
    };

    store.captureSessions[session.id] = session;
    return session;
  });
}

export async function getCaptureSession(sessionId: string) {
  const store = await readStore();
  return store.captureSessions[sessionId] ?? null;
}

export async function setCaptureFailure(sessionId: string, message: string) {
  return mutateStore((store) => {
    const session = store.captureSessions[sessionId];
    if (!session) {
      return null;
    }

    const next: CaptureSession = {
      ...session,
      status: "failed",
      lastError: message,
    };

    store.captureSessions[sessionId] = next;
    return next;
  });
}

export async function ingestCapturePayload(payload: CapturePayload) {
  // Resolve candidates first (e.g. svetserialu.to/sources/ -> final iframe)
  const resolvedCandidates = await Promise.all(
    payload.mediaCandidates.map((c) => resolveMediaCandidate(c, payload.pageUrl)),
  );

  const optimizedPayload: CapturePayload = {
    ...payload,
    mediaCandidates: resolvedCandidates,
  };

  return mutateStore((store) => {
    const session = store.captureSessions[optimizedPayload.sessionId];
    if (!session) {
      return null;
    }

    const next: CaptureSession = {
      ...session,
      capturePayload: optimizedPayload,
      status: optimizedPayload.mediaCandidates.length > 0 ? "needs_review" : "failed",
      lastError:
        optimizedPayload.mediaCandidates.length > 0
          ? undefined
          : "No direct playable media URL could be extracted from the page.",
    };

    store.captureSessions[optimizedPayload.sessionId] = next;
    return next;
  });
}


export async function markSessionSaved(sessionId: string) {
  return mutateStore((store) => {
    const session = store.captureSessions[sessionId];
    if (!session) {
      return null;
    }

    const next: CaptureSession = {
      ...session,
      status: "saved",
    };

    store.captureSessions[sessionId] = next;
    return next;
  });
}

export async function listMediaItems(libraryToken: string) {
  const store = await readStore();
  return Object.values(store.mediaItems)
    .filter((item) => item.libraryToken === libraryToken)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function getMediaItem(itemId: string, libraryToken?: string | null) {
  const store = await readStore();
  const item = store.mediaItems[itemId] ?? null;

  if (!item) {
    return null;
  }

  if (libraryToken && item.libraryToken !== libraryToken) {
    return null;
  }

  return item;
}

type CreateMediaItemInput = Omit<
  MediaItem,
  "id" | "createdAt" | "updatedAt" | "resumePositionSeconds"
>;

export async function createMediaItem(input: CreateMediaItemInput) {
  return mutateStore((store) => {
    const now = Date.now();
    const item: MediaItem = {
      ...input,
      id: createId("media"),
      createdAt: now,
      updatedAt: now,
      resumePositionSeconds: 0,
    };

    store.mediaItems[item.id] = item;
    return item;
  });
}

export async function upsertMediaItems(inputs: CreateMediaItemInput[]) {
  return mutateStore((store) => {
    const now = Date.now();
    const items: MediaItem[] = [];
    let createdCount = 0;
    let updatedCount = 0;

    for (const input of inputs) {
      const existing = Object.values(store.mediaItems).find(
        (item) =>
          item.libraryToken === input.libraryToken &&
          item.sourcePageUrl === input.sourcePageUrl &&
          item.playback.primaryUrl === input.playback.primaryUrl,
      );

      if (existing) {
        const next: MediaItem = {
          ...existing,
          ...input,
          updatedAt: now,
        };

        store.mediaItems[existing.id] = next;
        items.push(next);
        updatedCount += 1;
        continue;
      }

      const item: MediaItem = {
        ...input,
        id: createId("media"),
        createdAt: now,
        updatedAt: now,
        resumePositionSeconds: 0,
      };

      store.mediaItems[item.id] = item;
      items.push(item);
      createdCount += 1;
    }

    return { items, createdCount, updatedCount };
  });
}

export async function updateMediaProgress(
  itemId: string,
  libraryToken: string,
  resumePositionSeconds: number,
) {
  return mutateStore((store) => {
    const item = store.mediaItems[itemId];
    if (!item || item.libraryToken !== libraryToken) {
      return null;
    }

    const next: MediaItem = {
      ...item,
      resumePositionSeconds: Math.max(0, resumePositionSeconds),
      updatedAt: Date.now(),
    };

    store.mediaItems[itemId] = next;
    return next;
  });
}
