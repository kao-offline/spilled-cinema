import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PairingRequest, SpillshareSource } from "../../node-protocol/src";
import type { PairedDevice, PasswordHash, StoredSession } from "../../security/src";

export type StoredImportedShow = {
  slug: string;
  title: string;
  importedAt: number;
  payload: unknown;
};

export type StoredDownloadInventory = {
  updatedAt: number;
  episodeIds: string[];
  files: string[];
};

export type PrivatePasskeyCredential = {
  credentialId: string;
  publicKey: string;
  counter: number;
  transports?: string[];
  createdAt: number;
  lastUsedAt?: number;
};

export type PrivateAccountRuntimeState = {
  accountId: string;
  passkeys: PrivatePasskeyCredential[];
  usedStorageBytes: number;
};

export type AdminAccountRuntimeState = {
  adminId: string;
  displayName: string;
  passwordHash?: PasswordHash;
  passkeys: PrivatePasskeyCredential[];
  createdAt: number;
  updatedAt: number;
  disabledAt?: number;
};

export type WatcherAccountRuntimeState = {
  watcherId: string;
  displayName: string;
  passwordHash?: PasswordHash;
  passkeys: PrivatePasskeyCredential[];
  quotaBytes: number;
  createdAt: number;
  updatedAt: number;
  disabledAt?: number;
};

export type WatcherProfileRuntimeState = {
  watcherId: string;
  profileId: string;
  displayName: string;
  avatar: string;
  createdAt: number;
  updatedAt: number;
};

export type PrivateProfileState = {
  accountId: string;
  profileId: string;
  libraryState: unknown;
  settings: unknown;
  enabledProviderFeeds: unknown;
  downloadedLanguages: Record<string, string>;
  updatedAt: number;
};

export type PrivateDownloadRecord = {
  downloadId: string;
  accountId: string;
  profileId: string;
  episodeId?: string;
  contentId: string;
  fileName: string;
  filePath: string;
  sizeBytes: number;
  mimeType: string;
  sha256?: string;
  createdAt: number;
  spillshareEnabled: boolean;
};

export type PrivateAuthChallenge = {
  challengeId: string;
  kind: "passkey-registration" | "passkey-login" | "oidc";
  accountId?: string;
  providerId?: string;
  challenge: string;
  codeVerifier?: string;
  nonce?: string;
  redirectUri?: string;
  createdAt: number;
  expiresAt: number;
};

export type NodeStateFile = {
  node?: {
    nodeId: string;
    publicKey: string;
    privateKey: string;
    regionHint?: string;
  };
  pendingPairings: PairingRequest[];
  pairedDevices: PairedDevice[];
  sessions: StoredSession[];
  importedShows: StoredImportedShow[];
  downloads: StoredDownloadInventory;
  spillshareSources: SpillshareSource[];
  passkeys: Array<{
    credentialId: string;
    label?: string;
    createdAt: number;
  }>;
  adminAccounts: AdminAccountRuntimeState[];
  watcherAccounts: WatcherAccountRuntimeState[];
  watcherProfiles: WatcherProfileRuntimeState[];
  privateAccounts: PrivateAccountRuntimeState[];
  privateProfiles: PrivateProfileState[];
  privateDownloads: PrivateDownloadRecord[];
  privateAuthChallenges: PrivateAuthChallenge[];
};

const DEFAULT_STATE: NodeStateFile = {
  pendingPairings: [],
  pairedDevices: [],
  sessions: [],
  importedShows: [],
  downloads: {
    updatedAt: 0,
    episodeIds: [],
    files: [],
  },
  spillshareSources: [],
  passkeys: [],
  adminAccounts: [],
  watcherAccounts: [],
  watcherProfiles: [],
  privateAccounts: [],
  privateProfiles: [],
  privateDownloads: [],
  privateAuthChallenges: [],
};

const RETRIABLE_WRITE_ERROR_CODES = new Set(["UNKNOWN", "EPERM", "EBUSY", "EACCES"]);

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class JsonNodeStorage {
  private readonly filePath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async read(): Promise<NodeStateFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<NodeStateFile>;
      return {
        ...DEFAULT_STATE,
        ...parsed,
        downloads: {
          ...DEFAULT_STATE.downloads,
          ...(parsed.downloads ?? {}),
        },
        pendingPairings: Array.isArray(parsed.pendingPairings) ? parsed.pendingPairings : [],
        pairedDevices: Array.isArray(parsed.pairedDevices) ? parsed.pairedDevices : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        importedShows: Array.isArray(parsed.importedShows) ? parsed.importedShows : [],
        spillshareSources: Array.isArray(parsed.spillshareSources) ? parsed.spillshareSources : [],
        passkeys: Array.isArray(parsed.passkeys) ? parsed.passkeys : [],
        adminAccounts: Array.isArray(parsed.adminAccounts) ? parsed.adminAccounts : [],
        watcherAccounts: Array.isArray(parsed.watcherAccounts) ? parsed.watcherAccounts : [],
        watcherProfiles: Array.isArray(parsed.watcherProfiles) ? parsed.watcherProfiles : [],
        privateAccounts: Array.isArray(parsed.privateAccounts) ? parsed.privateAccounts : [],
        privateProfiles: Array.isArray(parsed.privateProfiles) ? parsed.privateProfiles : [],
        privateDownloads: Array.isArray(parsed.privateDownloads) ? parsed.privateDownloads : [],
        privateAuthChallenges: Array.isArray(parsed.privateAuthChallenges) ? parsed.privateAuthChallenges : [],
      };
    } catch {
      return structuredClone(DEFAULT_STATE);
    }
  }

  async write(state: NodeStateFile) {
    const task = this.writeChain
      .catch(() => undefined)
      .then(() => this.writeWithRetry(state));
    this.writeChain = task;
    await task;
  }

  private async writeWithRetry(state: NodeStateFile) {
    const payload = JSON.stringify(state, null, 2);
    const directory = dirname(this.filePath);
    let lastError: unknown;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.${attempt}.tmp`;

      try {
        await mkdir(directory, { recursive: true });
        await writeFile(tempPath, payload, "utf8");
        await rm(this.filePath, { force: true }).catch(() => undefined);
        await rename(tempPath, this.filePath);
        return;
      } catch (error) {
        lastError = error;
        await rm(tempPath, { force: true }).catch(() => undefined);

        const code =
          typeof error === "object" && error && "code" in error
            ? String((error as { code?: unknown }).code ?? "")
            : "";

        if (!RETRIABLE_WRITE_ERROR_CODES.has(code) || attempt === 4) {
          throw error;
        }

        await delay(40 * (attempt + 1));
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Failed to write node state.");
  }
}
