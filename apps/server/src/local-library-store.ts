import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type LocalLibrarySnapshot = {
  version: 1;
  updatedAt: number;
  libraryState: unknown;
  downloadedLanguages?: Record<string, string>;
  downloadQueue?: Record<string, unknown>;
};

const FILE_NAME = "library-state.json";
const MAX_SNAPSHOT_BYTES = 25 * 1024 * 1024;

export function resolveLocalLibraryDir() {
  const dbPath = process.env.SPILLED_NODE_DATABASE?.trim();
  if (dbPath) {
    return dirname(resolve(dbPath));
  }
  const vaultPath = process.env.SPILLED_VAULT_PATH?.trim();
  if (vaultPath) {
    return resolve(dirname(resolve(vaultPath)), "data");
  }
  return resolve(process.cwd(), "data");
}

export function resolveLocalLibraryPath() {
  return resolve(resolveLocalLibraryDir(), FILE_NAME);
}

export async function readLocalLibrarySnapshot(): Promise<LocalLibrarySnapshot | null> {
  try {
    const text = await readFile(resolveLocalLibraryPath(), "utf8");
    if (!text.trim()) return null;
    const parsed = JSON.parse(text) as Partial<LocalLibrarySnapshot>;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : 0,
      libraryState: parsed.libraryState ?? null,
      downloadedLanguages:
        parsed.downloadedLanguages && typeof parsed.downloadedLanguages === "object"
          ? (parsed.downloadedLanguages as Record<string, string>)
          : {},
      downloadQueue:
        parsed.downloadQueue && typeof parsed.downloadQueue === "object"
          ? (parsed.downloadQueue as Record<string, unknown>)
          : {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  }
}

export function normalizeLocalLibraryInput(input: unknown): LocalLibrarySnapshot {
  if (!input || typeof input !== "object") {
    throw new Error("Snapshot must be a JSON object.");
  }
  const candidate = input as Partial<LocalLibrarySnapshot>;
  const updatedAt =
    typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt)
      ? Math.max(0, Math.floor(candidate.updatedAt))
      : Date.now();
  const libraryState = candidate.libraryState;
  if (!libraryState || typeof libraryState !== "object") {
    throw new Error("Snapshot libraryState must be an object.");
  }
  const downloadedLanguages =
    candidate.downloadedLanguages && typeof candidate.downloadedLanguages === "object"
      ? (candidate.downloadedLanguages as Record<string, string>)
      : {};
  const downloadQueue =
    candidate.downloadQueue && typeof candidate.downloadQueue === "object"
      ? (candidate.downloadQueue as Record<string, unknown>)
      : {};
  return { version: 1, updatedAt, libraryState, downloadedLanguages, downloadQueue };
}

export async function writeLocalLibrarySnapshot(snapshot: LocalLibrarySnapshot): Promise<LocalLibrarySnapshot> {
  const dir = resolveLocalLibraryDir();
  mkdirSync(dir, { recursive: true });
  const target = resolve(dir, FILE_NAME);
  const serialized = JSON.stringify(snapshot);
  if (Buffer.byteLength(serialized, "utf8") > MAX_SNAPSHOT_BYTES) {
    throw new Error("Library snapshot is too large.");
  }
  // Atomic write: tmp file in the same directory, then rename.
  const tmp = resolve(dir, `${FILE_NAME}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, serialized, "utf8");
  renameSync(tmp, target);
  return snapshot;
}
