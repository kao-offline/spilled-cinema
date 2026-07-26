import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
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

export type RefreshSessionRecord = {
  refreshSessionId: string;
  chainId: string;
  accessSessionId: string;
  principalKind: "admin" | "watcher";
  principalId: string;
  profileId?: string;
  tokenHash: string;
  rotatedTokenHashes: string[];
  createdAt: number;
  expiresAt: number;
  rotatedAt?: number;
  revokedAt?: number;
};

export type WatcherInvitationRecord = {
  invitationId: string;
  secretHash: string;
  confirmationCode: string;
  watcherId: string;
  displayName: string;
  quotaBytes: number;
  profiles: Array<{ profileId: string; displayName: string; avatar: string }>;
  createdAt: number;
  expiresAt: number;
  acceptedAt?: number;
  consumedAt?: number;
};

export type RecoveryStateRecord = {
  recoveryId: string;
  verifier: string;
  encryptedIdentityBackup: string;
  createdAt: number;
  usedAt?: number;
};

export type LocalSecurityEvent = {
  eventId: string;
  eventType: string;
  principalId?: string;
  details?: Record<string, string | number | boolean | null>;
  createdAt: number;
};

export type NodeStateFile = {
  node?: {
    nodeId: string;
    publicKey: string;
    privateKey: string;
    transportPublicKey?: string;
    transportPrivateKey?: string;
    transportKeyVersion?: number;
    transportKeySignature?: string;
    installId?: string;
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
  refreshSessions: RefreshSessionRecord[];
  watcherInvitations: WatcherInvitationRecord[];
  recoveryStates: RecoveryStateRecord[];
  securityEvents: LocalSecurityEvent[];
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
  refreshSessions: [],
  watcherInvitations: [],
  recoveryStates: [],
  securityEvents: [],
};

const RETRIABLE_WRITE_ERROR_CODES = new Set(["UNKNOWN", "EPERM", "EBUSY", "EACCES"]);

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface NodeStorage {
  read(): Promise<NodeStateFile>;
  write(state: NodeStateFile): Promise<void>;
  getProtectedSecret?(key: string): Promise<string | null>;
  setProtectedSecret?(key: string, value: string): Promise<void>;
}

export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

type EncryptedSecretRecord = {
  nonce: string;
  ciphertext: string;
  tag: string;
};

export class MasterKeyFileSecretStore implements SecretStore {
  private readonly masterKeyFile: string;
  private readonly recordsFile: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(masterKeyFile: string, recordsFile: string) {
    this.masterKeyFile = masterKeyFile;
    this.recordsFile = recordsFile;
  }

  private async loadMasterKey() {
    const metadata = await stat(this.masterKeyFile);
    if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
      throw new Error("SPILLED_MASTER_KEY_FILE must have 0600 permissions.");
    }
    const raw = (await readFile(this.masterKeyFile, "utf8")).trim();
    const key = /^[a-f0-9]{64}$/i.test(raw)
      ? Buffer.from(raw, "hex")
      : Buffer.from(raw, "base64");
    if (key.length !== 32) {
      throw new Error("SPILLED_MASTER_KEY_FILE must contain exactly 256 bits.");
    }
    return key;
  }

  private async readRecords(): Promise<Record<string, EncryptedSecretRecord>> {
    try {
      return JSON.parse(await readFile(this.recordsFile, "utf8")) as Record<string, EncryptedSecretRecord>;
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";
      if (code === "ENOENT") {
        return {};
      }
      throw error;
    }
  }

  async get(key: string) {
    const record = (await this.readRecords())[key];
    if (!record) {
      return null;
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      await this.loadMasterKey(),
      Buffer.from(record.nonce, "base64"),
    );
    decipher.setAAD(Buffer.from(key, "utf8"));
    decipher.setAuthTag(Buffer.from(record.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  async set(key: string, value: string) {
    const task = this.writeChain.then(async () => {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", await this.loadMasterKey(), nonce);
      cipher.setAAD(Buffer.from(key, "utf8"));
      const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      const records = await this.readRecords();
      records[key] = {
        nonce: nonce.toString("base64"),
        ciphertext: ciphertext.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
      };
      await mkdir(dirname(this.recordsFile), { recursive: true });
      const tempPath = `${this.recordsFile}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tempPath, JSON.stringify(records, null, 2), { encoding: "utf8", mode: 0o600 });
      await rename(tempPath, this.recordsFile);
    });
    this.writeChain = task.catch(() => undefined);
    await task;
  }
}

export class DpapiSecretStore implements SecretStore {
  private readonly delegate: MasterKeyFileSecretStore;
  private readonly plaintextKeyFile: string;
  private initialized: Promise<void> | null = null;
  private readonly protectedKeyFile: string;

  constructor(
    protectedKeyFile: string,
    recordsFile: string,
  ) {
    this.protectedKeyFile = protectedKeyFile;
    this.plaintextKeyFile = `${protectedKeyFile}.${process.pid}.active`;
    this.delegate = new MasterKeyFileSecretStore(this.plaintextKeyFile, recordsFile);
  }

  private ensureInitialized() {
    if (process.platform !== "win32") {
      throw new Error("DPAPI secret storage is available only on Windows.");
    }
    if (!this.initialized) {
      this.initialized = this.initialize();
    }
    return this.initialized;
  }

  private async initialize() {
    let masterKey: Buffer;
    try {
      const protectedBytes = Buffer.from((await readFile(this.protectedKeyFile, "utf8")).trim(), "base64");
      masterKey = await runDpapi("unprotect", protectedBytes);
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";
      if (code !== "ENOENT") throw error;
      masterKey = randomBytes(32);
      const protectedBytes = await runDpapi("protect", masterKey);
      await mkdir(dirname(this.protectedKeyFile), { recursive: true });
      await writeFile(this.protectedKeyFile, protectedBytes.toString("base64"), { encoding: "utf8", mode: 0o600 });
    }
    if (masterKey.length !== 32) throw new Error("DPAPI returned an invalid node master key.");
    await writeFile(this.plaintextKeyFile, masterKey.toString("base64"), { encoding: "utf8", mode: 0o600 });
  }

  async get(key: string) {
    await this.ensureInitialized();
    try {
      return await this.delegate.get(key);
    } finally {
      await rm(this.plaintextKeyFile, { force: true });
      this.initialized = null;
    }
  }

  async set(key: string, value: string) {
    await this.ensureInitialized();
    try {
      await this.delegate.set(key, value);
    } finally {
      await rm(this.plaintextKeyFile, { force: true });
      this.initialized = null;
    }
  }
}

async function runDpapi(operation: "protect" | "unprotect", bytes: Buffer) {
  const method = operation === "protect" ? "Protect" : "Unprotect";
  const script = [
    "Add-Type -AssemblyName System.Security",
    "$inputText = [Console]::In.ReadToEnd().Trim()",
    "$bytes = [Convert]::FromBase64String($inputText)",
    `$result = [Security.Cryptography.ProtectedData]::${method}($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)`,
    "[Console]::Out.Write([Convert]::ToBase64String($result))",
  ].join("; ");
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  child.stdin.end(bytes.toString("base64"));
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (exitCode !== 0) {
    throw new Error(`DPAPI ${operation} failed: ${Buffer.concat(stderr).toString("utf8").trim()}`);
  }
  return Buffer.from(Buffer.concat(stdout).toString("utf8").trim(), "base64");
}

export class NodeStateRecoveryError extends Error {
  readonly filePath: string;

  constructor(filePath: string, cause: unknown) {
    super(`Node state at "${filePath}" could not be read safely. Recovery is required.`, { cause });
    this.name = "NodeStateRecoveryError";
    this.filePath = filePath;
  }
}

export class JsonNodeStorage implements NodeStorage {
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
    } catch (error) {
      const code =
        typeof error === "object" && error && "code" in error
          ? String((error as { code?: unknown }).code ?? "")
          : "";
      if (code === "ENOENT") {
        return structuredClone(DEFAULT_STATE);
      }
      throw new NodeStateRecoveryError(this.filePath, error);
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

type StateCollectionKey =
  | "pendingPairings"
  | "pairedDevices"
  | "sessions"
  | "importedShows"
  | "spillshareSources"
  | "passkeys"
  | "adminAccounts"
  | "watcherAccounts"
  | "watcherProfiles"
  | "privateAccounts"
  | "privateProfiles"
  | "privateDownloads"
  | "privateAuthChallenges"
  | "refreshSessions"
  | "watcherInvitations"
  | "recoveryStates"
  | "securityEvents";

const SQLITE_COLLECTIONS: Record<StateCollectionKey, string> = {
  pendingPairings: "pending_pairings",
  pairedDevices: "devices",
  sessions: "access_sessions",
  importedShows: "provider_state",
  spillshareSources: "spillshare_manifests",
  passkeys: "passkeys",
  adminAccounts: "admin_accounts",
  watcherAccounts: "watcher_accounts",
  watcherProfiles: "profiles",
  privateAccounts: "account_runtime",
  privateProfiles: "profile_state",
  privateDownloads: "private_downloads",
  privateAuthChallenges: "auth_challenges",
  refreshSessions: "refresh_token_hashes",
  watcherInvitations: "invitations",
  recoveryStates: "recovery_state",
  securityEvents: "security_events_v2",
};

function sqliteRecordKey(value: unknown, index: number) {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of [
      "challengeId",
      "downloadId",
      "credentialId",
      "profileId",
      "watcherId",
      "adminId",
      "accountId",
      "sessionId",
      "pairedDeviceId",
      "pairingId",
      "contentId",
      "refreshSessionId",
      "invitationId",
      "recoveryId",
      "eventId",
      "slug",
    ]) {
      if (typeof record[key] === "string") {
        return `${record[key]}:${index}`;
      }
    }
  }
  return String(index);
}

export class SqliteNodeStorage implements NodeStorage {
  private readonly database: DatabaseSync;
  private readonly dbPath: string;
  private readonly secrets: SecretStore;

  constructor(dbPath: string, secrets: SecretStore) {
    this.dbPath = dbPath;
    this.secrets = secrets;
    try {
      this.database = new DatabaseSync(dbPath);
      this.database.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;");
      this.initialize();
    } catch (error) {
      throw new NodeStateRecoveryError(dbPath, error);
    }
  }

  async getProtectedSecret(key: string) {
    return await this.secrets.get(key);
  }

  async setProtectedSecret(key: string, value: string) {
    await this.secrets.set(key, value);
  }

  private initialize() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL,
        source_checksum TEXT
      );
      CREATE TABLE IF NOT EXISTS node_configuration (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS download_inventory (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS security_events (
        event_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pending_cleanup_tasks (
        task_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    for (const table of new Set(Object.values(SQLITE_COLLECTIONS))) {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS ${table} (
          record_key TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
    }
    this.database.prepare(
      "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, ?)",
    ).run(Date.now());
  }

  async read(): Promise<NodeStateFile> {
    try {
      const state = structuredClone(DEFAULT_STATE);
      const nodeRow = this.database.prepare(
        "SELECT payload FROM node_configuration WHERE singleton = 1",
      ).get() as { payload?: string } | undefined;
      if (nodeRow?.payload) {
        const publicNode = JSON.parse(nodeRow.payload) as Omit<NonNullable<NodeStateFile["node"]>, "privateKey" | "transportPrivateKey">;
        const privateKey = await this.secrets.get("node.identity.ed25519.private");
        if (!privateKey) {
          throw new Error("Node identity secret is unavailable.");
        }
        const transportPrivateKey = publicNode.transportPublicKey
          ? await this.secrets.get("node.identity.x25519.private")
          : null;
        if (publicNode.transportPublicKey && !transportPrivateKey) {
          throw new Error("Node transport identity secret is unavailable.");
        }
        state.node = {
          ...publicNode,
          privateKey,
          ...(transportPrivateKey ? { transportPrivateKey } : {}),
        };
      }
      const inventoryRow = this.database.prepare(
        "SELECT payload FROM download_inventory WHERE singleton = 1",
      ).get() as { payload?: string } | undefined;
      if (inventoryRow?.payload) {
        state.downloads = JSON.parse(inventoryRow.payload) as StoredDownloadInventory;
      }
      for (const [stateKey, table] of Object.entries(SQLITE_COLLECTIONS) as Array<[StateCollectionKey, string]>) {
        const rows = this.database.prepare(`SELECT payload FROM ${table} ORDER BY record_key`).all() as Array<{ payload: string }>;
        (state[stateKey] as unknown[]) = rows.map((row) => JSON.parse(row.payload));
      }
      return state;
    } catch (error) {
      throw error instanceof NodeStateRecoveryError ? error : new NodeStateRecoveryError(this.dbPath, error);
    }
  }

  async write(state: NodeStateFile) {
    if (state.node) {
      await this.secrets.set("node.identity.ed25519.private", state.node.privateKey);
      if (state.node.transportPrivateKey) {
        await this.secrets.set("node.identity.x25519.private", state.node.transportPrivateKey);
      }
    }
    const now = Date.now();
    try {
      this.database.exec("BEGIN IMMEDIATE");
      if (state.node) {
        const {
          privateKey: _privateKey,
          transportPrivateKey: _transportPrivateKey,
          ...publicNode
        } = state.node;
        this.database.prepare(`
          INSERT INTO node_configuration(singleton, payload, updated_at) VALUES (1, ?, ?)
          ON CONFLICT(singleton) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
        `).run(JSON.stringify(publicNode), now);
      }
      this.database.prepare(`
        INSERT INTO download_inventory(singleton, payload, updated_at) VALUES (1, ?, ?)
        ON CONFLICT(singleton) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
      `).run(JSON.stringify(state.downloads), now);
      for (const [stateKey, table] of Object.entries(SQLITE_COLLECTIONS) as Array<[StateCollectionKey, string]>) {
        this.database.exec(`DELETE FROM ${table}`);
        const insert = this.database.prepare(`INSERT INTO ${table}(record_key, payload, updated_at) VALUES (?, ?, ?)`);
        state[stateKey].forEach((record, index) => {
          insert.run(sqliteRecordKey(record, index), JSON.stringify(record), now);
        });
      }
      this.database.exec("COMMIT");
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // The original failure is the actionable recovery error.
      }
      throw new NodeStateRecoveryError(this.dbPath, error);
    }
  }

  close() {
    this.database.close();
  }

  async createVerifiedBackup(targetPath: string) {
    await mkdir(dirname(targetPath), { recursive: true });
    await rm(targetPath, { force: true });
    const escaped = targetPath.replace(/'/g, "''");
    this.database.exec(`VACUUM INTO '${escaped}'`);
    const verification = new DatabaseSync(targetPath, { readOnly: true });
    try {
      const row = verification.prepare("PRAGMA integrity_check").get() as { integrity_check?: string };
      if (row.integrity_check !== "ok") {
        throw new Error(`SQLite backup integrity check failed: ${row.integrity_check ?? "unknown"}.`);
      }
    } finally {
      verification.close();
    }
    return targetPath;
  }
}
