export type ServerLibrarySnapshot = {
  version: 1;
  updatedAt: number;
  libraryState: unknown;
  downloadedLanguages: Record<string, string>;
  downloadQueue: Record<string, unknown>;
};

const LOCAL_ORIGINS = ["http://127.0.0.1:8787", "http://localhost:8787"];
const REQUEST_TIMEOUT_MS = 2000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

function normalizeSnapshot(input: unknown): ServerLibrarySnapshot | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const candidate = input as Partial<ServerLibrarySnapshot>;
  if (!candidate.libraryState || typeof candidate.libraryState !== "object") {
    return null;
  }
  return {
    version: 1,
    updatedAt:
      typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt) && candidate.updatedAt > 0
        ? Math.floor(candidate.updatedAt)
        : 0,
    libraryState: candidate.libraryState,
    downloadedLanguages:
      candidate.downloadedLanguages && typeof candidate.downloadedLanguages === "object"
        ? (candidate.downloadedLanguages as Record<string, string>)
        : {},
    downloadQueue:
      candidate.downloadQueue && typeof candidate.downloadQueue === "object"
        ? (candidate.downloadQueue as Record<string, unknown>)
        : {},
  };
}

/**
 * Silent loopback-only sync with the installed Spilled Server.
 * `reachable` is true when a local server answered (even with no snapshot
 * stored yet); false when no local server is running (hosted-only users).
 * POST is used for writes so the existing server CORS allow-list applies.
 */
export async function readServerLibrarySnapshot(): Promise<{
  reachable: boolean;
  snapshot: ServerLibrarySnapshot | null;
}> {
  for (const origin of LOCAL_ORIGINS) {
    try {
      const response = await fetchWithTimeout(`${origin}/api/local-library`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        // A 403 here still proves a local server is listening (just refusing
        // a non-loopback Host); treat other statuses as "try next alias".
        if (response.status === 403) {
          return { reachable: true, snapshot: null };
        }
        continue;
      }
      const payload = (await response.json().catch(() => null)) as { snapshot?: unknown } | null;
      return { reachable: true, snapshot: normalizeSnapshot(payload?.snapshot) };
    } catch {
      // No server on this hostname; try the next loopback alias.
    }
  }
  return { reachable: false, snapshot: null };
}

export async function probeServerLibraryReachable(): Promise<boolean> {
  for (const origin of LOCAL_ORIGINS) {
    try {
      const response = await fetchWithTimeout(`${origin}/api/local-library`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (response.ok || response.status === 403) {
        return true;
      }
    } catch {
      // Try the next alias.
    }
  }
  return false;
}

export async function writeServerLibrarySnapshot(snapshot: ServerLibrarySnapshot): Promise<boolean> {
  const body = JSON.stringify({ snapshot });
  for (const origin of LOCAL_ORIGINS) {
    try {
      const response = await fetchWithTimeout(`${origin}/api/local-library`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body,
      });
      if (response.ok) {
        return true;
      }
    } catch {
      // Try the next alias.
    }
  }
  return false;
}
