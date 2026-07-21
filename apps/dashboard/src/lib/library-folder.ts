import type { LibraryEpisode } from "./types";

type BrowserWindowWithPicker = Window & {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
};

type PermissionCapableHandle = FileSystemDirectoryHandle & {
  queryPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
};

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  entries?: () => AsyncIterable<[string, FileSystemHandle]>;
};

const DB_NAME = "spilled-library-folder";
const STORE_NAME = "handles";
const HANDLE_KEY = "library-root";
const APP_DIR_NAME = "spilled-library";
const VAULT_DIR_NAME = "vault";
const SNAPSHOT_FILE_NAME = "library-state.json";

function isNativeVaultAvailable() {
  return typeof window !== "undefined" && window.spilledNative?.kind === "native";
}

export type VaultStatusCode =
  | "unsupported"
  | "disconnected"
  | "stored_handle_needs_access"
  | "ready"
  | "read_error"
  | "write_error";

export type VaultOperation =
  | "status"
  | "connect"
  | "reconnect_access"
  | "disconnect"
  | "read_snapshot"
  | "write_snapshot"
  | "list_artifacts"
  | "read_file"
  | "write_blob"
  | "write_response";

export type VaultDiagnostics = {
  lastOperation: VaultOperation | null;
  lastReadError: string | null;
  lastWriteError: string | null;
  lastPermissionError: string | null;
  updatedAt: number | null;
};

export type VaultStatus = {
  code: VaultStatusCode;
  supported: boolean;
  connected: boolean;
  requiresUserAction: boolean;
  handleStored: boolean;
  folderName: string | null;
  permission: PermissionState | "unsupported" | "missing";
  lastError: string | null;
};

export type VaultSnapshot = {
  version: 1;
  updatedAt: number;
  libraryState: unknown;
  downloadedLanguages: Record<string, string>;
  downloadQueue: Record<string, unknown>;
};

let dbInstance: IDBDatabase | null = null;
let vaultDiagnostics: VaultDiagnostics = {
  lastOperation: null,
  lastReadError: null,
  lastWriteError: null,
  lastPermissionError: null,
  updatedAt: null,
};

function recordVaultDiagnostics(patch: Partial<VaultDiagnostics>) {
  vaultDiagnostics = {
    ...vaultDiagnostics,
    ...patch,
    updatedAt: Date.now(),
  };
}

function recordVaultInfo(operation: VaultOperation, message: string, details?: unknown) {
  console.info(`[vault] ${operation}: ${message}`, details ?? "");
  recordVaultDiagnostics({ lastOperation: operation });
}

function recordVaultReadError(operation: VaultOperation, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[vault] ${operation} failed`, error);
  recordVaultDiagnostics({
    lastOperation: operation,
    lastReadError: message,
  });
}

function recordVaultWriteError(operation: VaultOperation, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[vault] ${operation} failed`, error);
  recordVaultDiagnostics({
    lastOperation: operation,
    lastWriteError: message,
  });
}

function recordVaultPermissionError(operation: VaultOperation, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[vault] ${operation} permission failed`, error);
  recordVaultDiagnostics({
    lastOperation: operation,
    lastPermissionError: message,
  });
}

function clearVaultErrors() {
  recordVaultDiagnostics({
    lastReadError: null,
    lastWriteError: null,
    lastPermissionError: null,
  });
}

export function getVaultDiagnostics(): VaultDiagnostics {
  return { ...vaultDiagnostics };
}

export function createInitialVaultStatus(): VaultStatus {
  const supported = isFolderConnectionSupported();
  return {
    code: supported ? "disconnected" : "unsupported",
    supported,
    connected: false,
    requiresUserAction: false,
    handleStored: false,
    folderName: null,
    permission: supported ? "missing" : "unsupported",
  lastError: null,
  };
}

type VaultAccessState = {
  read: PermissionState | "missing";
  write: PermissionState | "missing";
};

async function openDb(): Promise<IDBDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB."));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };
  });
}

function withTransaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, resolve: (value: T) => void, reject: (error: Error) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    let settled = false;

    const resolveOnce = (value: T) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    const rejectOnce = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    tx.onerror = () => rejectOnce(tx.error ?? new Error("IndexedDB transaction failed."));
    tx.onabort = () => rejectOnce(tx.error ?? new Error("IndexedDB transaction was aborted."));
    tx.oncomplete = () => {
      if (!settled) {
        // This should not happen if run calls resolve/reject, but just in case.
        rejectOnce(new Error("Transaction completed without result."));
      }
    };

    run(store, resolveOnce, rejectOnce);
  });
}

async function getStoredHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDb();
    return await withTransaction<FileSystemDirectoryHandle | null>(db, "readonly", (store, resolve, reject) => {
      const request = store.get(HANDLE_KEY);
      request.onerror = () => reject(request.error ?? new Error("Failed to read stored folder."));
      request.onsuccess = () => {
        const value = request.result as FileSystemDirectoryHandle | undefined;
        resolve(value ?? null);
      };
    });
  } catch (error) {
    console.error("Failed to get stored handle:", error);
    return null;
  }
}

async function getHandleAccessState(handle: FileSystemDirectoryHandle): Promise<VaultAccessState> {
  const read = await queryHandlePermission(handle, "read");
  const write = await queryHandlePermission(handle, "readwrite");
  return { read, write };
}

async function hasReadableVaultAccess(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const access = await getHandleAccessState(handle);
  if (access.read === "granted" || access.write === "granted") {
    return true;
  }

  try {
    await handle.getDirectoryHandle(APP_DIR_NAME);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      return true;
    }
    if (isVaultPermissionError(error)) {
      return false;
    }
    return false;
  }
}

type VaultPermissionMode = "read" | "readwrite";

async function setStoredHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  await withTransaction<void>(db, "readwrite", (store, resolve, reject) => {
    const request = store.put(handle, HANDLE_KEY);
    request.onerror = () => reject(request.error ?? new Error("Failed to persist folder handle."));
    request.onsuccess = () => resolve();
  });
}

export async function clearStoredFolderHandle(): Promise<void> {
  if (isNativeVaultAvailable()) {
    await window.spilledNative!.disconnectVault();
    clearVaultErrors();
    recordVaultInfo("disconnect", "Cleared native vault path.");
    return;
  }

  const db = await openDb();
  await withTransaction<void>(db, "readwrite", (store, resolve, reject) => {
    const request = store.delete(HANDLE_KEY);
    request.onerror = () => reject(request.error ?? new Error("Failed to clear folder connection."));
    request.onsuccess = () => resolve();
  });
  clearVaultErrors();
  recordVaultInfo("disconnect", "Cleared stored vault handle.");
}

export function isFolderConnectionSupported(): boolean {
  if (isNativeVaultAvailable()) {
    return true;
  }
  return typeof window !== "undefined" && "showDirectoryPicker" in window && "indexedDB" in window;
}

async function queryHandlePermission(
  handle: FileSystemDirectoryHandle,
  mode: VaultPermissionMode = "read",
): Promise<PermissionState> {
  const permissionHandle = handle as PermissionCapableHandle;
  if (!permissionHandle.queryPermission) {
    return "granted";
  }
  return permissionHandle.queryPermission({ mode });
}

async function requestHandlePermission(
  handle: FileSystemDirectoryHandle,
  mode: VaultPermissionMode = "readwrite",
): Promise<PermissionState> {
  const permissionHandle = handle as PermissionCapableHandle;
  if (!permissionHandle.requestPermission) {
    return "granted";
  }
  try {
    return await permissionHandle.requestPermission({ mode });
  } catch (error) {
    recordVaultPermissionError("reconnect_access", error);
    return "prompt";
  }
}

function isVaultPermissionError(error: unknown) {
  if (!(error instanceof DOMException)) {
    return false;
  }
  return error.name === "NotAllowedError" || error.name === "SecurityError";
}

async function ensureHandleWritableAccess(
  handle: FileSystemDirectoryHandle,
  options: { requestPermission?: boolean } = {},
): Promise<void> {
  const writePermission = await queryHandlePermission(handle, "readwrite");
  if (writePermission !== "granted" && options.requestPermission) {
    const requested = await requestHandlePermission(handle, "readwrite");
    if (requested !== "granted") {
      throw new Error("Folder permission was not granted.");
    }
  }

  try {
    await getAppDirectory(handle);
    return;
  } catch (error) {
    if (!options.requestPermission || !isVaultPermissionError(error)) {
      throw error;
    }
  }

  const requested = await requestHandlePermission(handle, "readwrite");
  if (requested !== "granted") {
    throw new Error("Folder permission was not granted.");
  }

  await getAppDirectory(handle);
}

export async function connectLibraryFolder(): Promise<{ name: string }> {
  if (isNativeVaultAvailable()) {
    const connected = await window.spilledNative!.connectVault();
    clearVaultErrors();
    recordVaultInfo("connect", "Connected native vault folder.", { folderName: connected.name });
    return { name: connected.name };
  }

  const picker = (window as BrowserWindowWithPicker).showDirectoryPicker;
  if (!picker) {
    throw new Error("Folder connection is not supported in this browser.");
  }

  const handle = await picker();
  await ensureHandleWritableAccess(handle, { requestPermission: true });

  await setStoredHandle(handle);
  clearVaultErrors();
  recordVaultInfo("connect", "Connected vault folder.", { folderName: handle.name });
  return { name: handle.name };
}

export async function requestStoredFolderAccess(): Promise<{ name: string }> {
  if (isNativeVaultAvailable()) {
    const status = await window.spilledNative!.getVaultStatus();
    if (status.kind === "ready" && status.folderName) {
      clearVaultErrors();
      recordVaultInfo("reconnect_access", "Native vault path still available.", { folderName: status.folderName });
      return { name: status.folderName };
    }
    const connected = await window.spilledNative!.connectVault();
    clearVaultErrors();
    recordVaultInfo("reconnect_access", "Reconnected native vault folder.", { folderName: connected.name });
    return { name: connected.name };
  }

  const handle = await getStoredHandle();
  if (!handle) {
    throw new Error("No stored vault folder. Connect a folder first.");
  }

  await ensureHandleWritableAccess(handle, { requestPermission: true });

  clearVaultErrors();
  recordVaultInfo("reconnect_access", "Restored access to stored vault folder.", { folderName: handle.name });
  return { name: handle.name };
}

export async function getConnectedLibraryFolderName(): Promise<string | null> {
  if (isNativeVaultAvailable()) {
    const status = await window.spilledNative!.getVaultStatus();
    return status.kind === "ready" ? status.folderName ?? null : null;
  }

  const handle = await getStoredHandle();
  if (!handle) {
    return null;
  }

  if (!(await hasReadableVaultAccess(handle))) {
    return null;
  }

  return handle.name;
}

export async function getVaultStatus(): Promise<VaultStatus> {
  if (isNativeVaultAvailable()) {
    const status = await window.spilledNative!.getVaultStatus();
    return {
      code: status.kind === "ready" ? "ready" : "disconnected",
      supported: true,
      connected: status.kind === "ready",
      requiresUserAction: false,
      handleStored: status.handleStored,
      folderName: status.folderName,
      permission: status.kind === "ready" ? "granted" : "missing",
      lastError: vaultDiagnostics.lastPermissionError ?? vaultDiagnostics.lastReadError ?? vaultDiagnostics.lastWriteError,
    };
  }

  const supported = isFolderConnectionSupported();
  if (!supported) {
    return {
      code: "unsupported",
      supported: false,
      connected: false,
      requiresUserAction: false,
      handleStored: false,
      folderName: null,
      permission: "unsupported",
      lastError: null,
    };
  }

  const handle = await getStoredHandle();
  if (!handle) {
    return {
      code: "disconnected",
      supported: true,
      connected: false,
      requiresUserAction: false,
      handleStored: false,
      folderName: null,
      permission: "missing",
      lastError: vaultDiagnostics.lastPermissionError ?? vaultDiagnostics.lastReadError ?? vaultDiagnostics.lastWriteError,
    };
  }

  const access = await getHandleAccessState(handle);
  const readable = await hasReadableVaultAccess(handle);
  const lastError = vaultDiagnostics.lastPermissionError ?? vaultDiagnostics.lastReadError ?? vaultDiagnostics.lastWriteError;

  if (!readable) {
    return {
      code: "stored_handle_needs_access",
      supported: true,
      connected: false,
      requiresUserAction: true,
      handleStored: true,
      folderName: handle.name,
      permission: access.read,
      lastError,
    };
  }

  if (vaultDiagnostics.lastWriteError) {
    return {
      code: "write_error",
      supported: true,
      connected: true,
      requiresUserAction: false,
      handleStored: true,
      folderName: handle.name,
      permission: access.write === "granted" || access.read === "granted" ? "granted" : access.read,
      lastError,
    };
  }

  if (vaultDiagnostics.lastReadError) {
    return {
      code: "read_error",
      supported: true,
      connected: true,
      requiresUserAction: false,
      handleStored: true,
      folderName: handle.name,
      permission: access.write === "granted" || access.read === "granted" ? "granted" : access.read,
      lastError,
    };
  }

  return {
    code: "ready",
    supported: true,
    connected: true,
    requiresUserAction: false,
    handleStored: true,
    folderName: handle.name,
    permission: access.write === "granted" || access.read === "granted" ? "granted" : access.read,
    lastError,
  };
}

type WritableFolderOptions = {
  requestPermission?: boolean;
};

async function getReadableFolder(options: WritableFolderOptions = {}): Promise<FileSystemDirectoryHandle | null> {
  const handle = await getStoredHandle();
  if (!handle) {
    return null;
  }

  if (await hasReadableVaultAccess(handle)) {
    return handle;
  }

  if (!options.requestPermission) {
    return null;
  }

  const requested = await requestHandlePermission(handle, "read");
  return requested === "granted" ? handle : null;
}

async function getWritableFolder(options: WritableFolderOptions = {}): Promise<FileSystemDirectoryHandle | null> {
  const handle = await getStoredHandle();
  if (!handle) {
    return null;
  }

  const permission = await queryHandlePermission(handle, "readwrite");
  if (permission === "granted") {
    return handle;
  }

  if (!options.requestPermission) {
    return null;
  }

  // Only request permission from explicit user-triggered flows.
  const requested = await requestHandlePermission(handle, "readwrite");
  return requested === "granted" ? handle : null;
}


async function getAppDirectory(root: FileSystemDirectoryHandle) {
  return root.getDirectoryHandle(APP_DIR_NAME, { create: true });
}

async function getVaultDirectory(root: FileSystemDirectoryHandle) {
  const appDir = await getAppDirectory(root);
  return appDir.getDirectoryHandle(VAULT_DIR_NAME, { create: true });
}

async function getSnapshotFileHandle(root: FileSystemDirectoryHandle) {
  const appDir = await getAppDirectory(root);
  return appDir.getFileHandle(SNAPSHOT_FILE_NAME, { create: true });
}

function sanitizeVaultFileName(value: string) {
  const cleaned = String(value || "download.mp4")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
  if (!cleaned) {
    return "download.mp4";
  }
  return /\.[a-z0-9]{2,5}$/i.test(cleaned) ? cleaned : `${cleaned}.mp4`;
}

export async function requireWritableLibraryFolder(): Promise<{ name: string }> {
  if (isNativeVaultAvailable()) {
    const status = await window.spilledNative!.getVaultStatus();
    if (status.kind !== "ready" || !status.folderName) {
      throw new Error("Connect a writable vault folder in Settings before downloading.");
    }
    return { name: status.folderName };
  }

  const root = await getWritableFolder({ requestPermission: true });
  if (!root) {
    recordVaultPermissionError("write_blob", new Error("Connect a writable vault folder in Settings before downloading."));
    throw new Error("Connect a writable vault folder in Settings before downloading.");
  }

  await getVaultDirectory(root);
  recordVaultInfo("status", "Writable vault folder is ready.", { folderName: root.name });
  return { name: root.name };
}

export async function writeBlobToLibraryVault(fileName: string, blob: Blob): Promise<{ fileName: string; folderName: string }> {
  if (isNativeVaultAvailable()) {
    const status = await window.spilledNative!.getVaultStatus();
    if (status.kind !== "ready" || !status.folderName) {
      throw new Error("Connect a writable vault folder in Settings before downloading.");
    }
    const safeName = sanitizeVaultFileName(fileName);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await window.spilledNative!.writeVaultBlob(safeName, bytes);
    recordVaultInfo("write_blob", "Wrote blob to native vault.", { fileName: safeName, folderName: status.folderName });
    recordVaultDiagnostics({ lastWriteError: null });
    return { fileName: safeName, folderName: status.folderName };
  }

  const root = await getWritableFolder({ requestPermission: true });
  if (!root) {
    recordVaultPermissionError("write_blob", new Error("Connect a writable vault folder in Settings before downloading."));
    throw new Error("Connect a writable vault folder in Settings before downloading.");
  }

  const safeName = sanitizeVaultFileName(fileName);
  const vaultDir = await getVaultDirectory(root);
  const fileHandle = await vaultDir.getFileHandle(safeName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }

  recordVaultInfo("write_blob", "Wrote blob to vault.", { fileName: safeName, folderName: root.name });
  recordVaultDiagnostics({ lastWriteError: null });
  return { fileName: safeName, folderName: root.name };
}

export async function writeResponseToLibraryVault(
  fileName: string,
  response: Response,
  signal?: AbortSignal,
  onChunk?: (receivedBytes: number, totalBytes: number | null) => void,
): Promise<{ fileName: string; folderName: string }> {
  if (isNativeVaultAvailable()) {
    const status = await window.spilledNative!.getVaultStatus();
    if (status.kind !== "ready" || !status.folderName) {
      throw new Error("Connect a writable vault folder in Settings before downloading.");
    }
    if (!response.ok || !response.body) {
      throw new Error(`Vault download failed (${response.status}).`);
    }
    const safeName = sanitizeVaultFileName(fileName);
    const bytes = new Uint8Array(await response.arrayBuffer());
    await window.spilledNative!.writeVaultBlob(safeName, bytes);
    recordVaultInfo("write_response", "Streamed response into native vault.", { fileName: safeName, folderName: status.folderName });
    recordVaultDiagnostics({ lastWriteError: null });
    return { fileName: safeName, folderName: status.folderName };
  }

  const root = await getWritableFolder({ requestPermission: true });
  if (!root) {
    recordVaultPermissionError("write_response", new Error("Connect a writable vault folder in Settings before downloading."));
    throw new Error("Connect a writable vault folder in Settings before downloading.");
  }

  if (!response.ok || !response.body) {
    recordVaultWriteError("write_response", new Error(`Vault download failed (${response.status}).`));
    throw new Error(`Vault download failed (${response.status}).`);
  }

  const safeName = sanitizeVaultFileName(fileName);
  const vaultDir = await getVaultDirectory(root);
  const fileHandle = await vaultDir.getFileHandle(safeName, { create: true });
  const writable = await fileHandle.createWritable();
  const totalHeader = response.headers.get("content-length");
  const totalBytes = totalHeader ? Number.parseInt(totalHeader, 10) : Number.NaN;
  const expectedBytes = Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : null;
  const reader = response.body.getReader();
  let writtenBytes = 0;

  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      await writable.write(value);
      writtenBytes += value.byteLength;
      onChunk?.(writtenBytes, expectedBytes);
    }
  } catch (error) {
    try {
      await writable.abort();
    } catch {
      // no-op cleanup
    }
    throw error;
  }

  await writable.close();
  recordVaultInfo("write_response", "Streamed response into vault.", { fileName: safeName, folderName: root.name });
  recordVaultDiagnostics({ lastWriteError: null });
  return { fileName: safeName, folderName: root.name };
}

export async function getLibraryVaultFileObjectUrl(fileName: string): Promise<string | null> {
  if (isNativeVaultAvailable()) {
    return null;
  }

  const root = await getReadableFolder();
  if (!root) {
    return null;
  }

  try {
    const safeName = sanitizeVaultFileName(fileName);
    const vaultDir = await getVaultDirectory(root);
    const fileHandle = await vaultDir.getFileHandle(safeName);
    const file = await fileHandle.getFile();
    recordVaultInfo("read_file", "Created vault file object URL.", { fileName: safeName, folderName: root.name });
    recordVaultDiagnostics({ lastReadError: null });
    return URL.createObjectURL(file);
  } catch (error) {
    recordVaultReadError("read_file", error);
    return null;
  }
}

export async function writeEpisodeFolderRecord(
  episode: LibraryEpisode,
  urls: string[],
  sizeBytes: number,
  fileName?: string,
): Promise<void> {
  if (isNativeVaultAvailable()) {
    await window.spilledNative!.writeVaultRecord(
      episode.id,
      JSON.stringify(
        {
          episodeId: episode.id,
          showTitle: episode.showTitle,
          seasonNumber: episode.seasonNumber,
          episodeNumber: episode.episodeNumber,
          episodeTitle: episode.episodeTitle,
          cachedAt: Date.now(),
          sizeBytes,
          urls,
          fileName: fileName ?? null,
        },
        null,
        2,
      ),
    );
    return;
  }

  const root = await getWritableFolder({ requestPermission: true });
  if (!root) {
    return;
  }

  const appDir = await getAppDirectory(root);
  const recordsDir = await appDir.getDirectoryHandle("offline-records", { create: true });
  const file = await recordsDir.getFileHandle(`${episode.id}.json`, { create: true });
  const writable = await file.createWritable();

  await writable.write(
    JSON.stringify(
      {
        episodeId: episode.id,
        showTitle: episode.showTitle,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        episodeTitle: episode.episodeTitle,
        cachedAt: Date.now(),
        sizeBytes,
        urls,
        fileName: fileName ?? null,
      },
      null,
      2,
    ),
  );

  await writable.close();
}

export async function removeEpisodeFolderRecord(episodeId: string): Promise<void> {
  if (isNativeVaultAvailable()) {
    await window.spilledNative!.removeVaultRecord(episodeId);
    return;
  }

  const root = await getWritableFolder({ requestPermission: true });
  if (!root) {
    return;
  }

  try {
    const appDir = await getAppDirectory(root);
    const recordsDir = await appDir.getDirectoryHandle("offline-records");
    await recordsDir.removeEntry(`${episodeId}.json`);
  } catch {
    // The directory or record may not exist yet.
  }
}

export async function clearEpisodeFolderRecords(): Promise<void> {
  if (isNativeVaultAvailable()) {
    await window.spilledNative!.clearVaultRecords();
    return;
  }

  const root = await getWritableFolder({ requestPermission: true });
  if (!root) {
    return;
  }

  try {
    const appDir = await getAppDirectory(root);
    await appDir.removeEntry("offline-records", { recursive: true });
  } catch {
    // Nothing to clear.
  }
}

export async function listLibraryVaultArtifacts(): Promise<{ episodeIds: string[]; files: string[]; filesByEpisodeId: Record<string, string> }> {
  if (isNativeVaultAvailable()) {
    const result = await window.spilledNative!.listVaultArtifacts();
    recordVaultInfo("list_artifacts", "Listed native vault artifacts.", {
      fileCount: result.files.length,
      episodeCount: result.episodeIds.length,
    });
    recordVaultDiagnostics({ lastReadError: null });
    return result;
  }

  const root = await getReadableFolder();
  if (!root) {
    return { episodeIds: [], files: [], filesByEpisodeId: {} };
  }

  const fileNames: string[] = [];
  const episodeIds = new Set<string>();
  const filesByEpisodeId: Record<string, string> = {};

  try {
    const vaultDir = await getVaultDirectory(root);
    const iterableVaultDir = vaultDir as IterableDirectoryHandle;
    if (!iterableVaultDir.entries) {
      return { episodeIds: [], files: [], filesByEpisodeId: {} };
    }
    for await (const [name, handle] of iterableVaultDir.entries()) {
      if (handle.kind === "file") {
        fileNames.push(name);
      }
    }
  } catch {
    // Vault may not exist yet.
  }

  try {
    const appDir = await getAppDirectory(root);
    const recordsDir = await appDir.getDirectoryHandle("offline-records");
    const iterableRecordsDir = recordsDir as IterableDirectoryHandle;
    if (!iterableRecordsDir.entries) {
      return {
        episodeIds: Array.from(episodeIds),
        files: fileNames,
        filesByEpisodeId,
      };
    }
    for await (const [name, handle] of iterableRecordsDir.entries()) {
      if (handle.kind !== "file" || !name.endsWith(".json")) {
        continue;
      }

      const fileHandle = handle as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      const text = await file.text();
      const parsed = JSON.parse(text) as { episodeId?: string; fileName?: string };
      if (typeof parsed.episodeId === "string" && parsed.episodeId.trim()) {
        episodeIds.add(parsed.episodeId);
        if (typeof parsed.fileName === "string" && parsed.fileName.trim()) {
          filesByEpisodeId[parsed.episodeId] = parsed.fileName;
        }
      }
    }
  } catch {
    // Offline records may not exist yet.
  }

  recordVaultInfo("list_artifacts", "Listed vault artifacts.", {
    folderName: root.name,
    fileCount: fileNames.length,
    episodeCount: episodeIds.size,
  });
  recordVaultDiagnostics({ lastReadError: null });
  return {
    episodeIds: Array.from(episodeIds),
    files: fileNames,
    filesByEpisodeId,
  };
}

export async function readVaultSnapshot(): Promise<VaultSnapshot | null> {
  if (isNativeVaultAvailable()) {
    try {
      const text = await window.spilledNative!.readVaultSnapshot();
      if (!text?.trim()) {
        return null;
      }
      const parsed = JSON.parse(text) as Partial<VaultSnapshot>;
      return {
        version: 1,
        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
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
      recordVaultReadError("read_snapshot", error);
      return null;
    }
  }

  const root = await getReadableFolder();
  if (!root) {
    return null;
  }

  try {
    const fileHandle = await getSnapshotFileHandle(root);
    const file = await fileHandle.getFile();
    const text = await file.text();
    if (!text.trim()) {
      return null;
    }

    const parsed = JSON.parse(text) as Partial<VaultSnapshot>;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    recordVaultInfo("read_snapshot", "Read vault snapshot.", { folderName: root.name });
    recordVaultDiagnostics({ lastReadError: null });
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
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
    recordVaultReadError("read_snapshot", error);
    return null;
  }
}

export async function writeVaultSnapshot(snapshot: VaultSnapshot): Promise<void> {
  if (isNativeVaultAvailable()) {
    try {
      await window.spilledNative!.writeVaultSnapshot(JSON.stringify(snapshot, null, 2));
      recordVaultInfo("write_snapshot", "Wrote native vault snapshot.");
      recordVaultDiagnostics({ lastWriteError: null });
    } catch (error) {
      recordVaultWriteError("write_snapshot", error);
    }
    return;
  }

  try {
    const root = await getWritableFolder();
    if (!root) {
      return;
    }

    const fileHandle = await getSnapshotFileHandle(root);
    const writable = await fileHandle.createWritable();

    try {
      await writable.write(JSON.stringify(snapshot, null, 2));
    } finally {
      await writable.close();
    }
    recordVaultInfo("write_snapshot", "Wrote vault snapshot.", { folderName: root.name });
    recordVaultDiagnostics({ lastWriteError: null });
  } catch (error) {
    recordVaultWriteError("write_snapshot", error);
  }
}

