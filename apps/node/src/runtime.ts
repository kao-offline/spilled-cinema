import { homedir } from "node:os";
import { relative, resolve } from "node:path";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { hash as hashArgon2, verify as verifyArgon2 } from "@node-rs/argon2";
import { open, stat } from "node:fs/promises";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { MemoryDiscoveryRegistry, MdnsService, verifyNodeRecord } from "../../../packages/discovery/src";
import { NODE_CAPABILITIES, NODE_PROTOCOL_VERSION, V2_CAPABILITIES, type AnonymousSessionGrant, type Capability, type CapabilityTicketV2, type CapabilityPolicy, type EncryptedRequestEnvelopeV2, type NodeCapability, type NodeCapabilityMap, type NodeCompatibilityStatus, type NodeRecord, type PairingApproval, type PairingRequest, type PrivateNodeSessionToken, type PrivateSessionGrant, type SessionScope, type SpillshareSource } from "../../../packages/node-protocol/src";
import { approvePairing, base64UrlDecode, base64UrlEncode, createPairingRequest, createPasskeyAuthenticationChallenge, createPasskeyRegistrationChallenge, createSignedToken, decryptNodeRequest, encryptNodeResponse, generateNodeIdentity, generateNodeTransportIdentity, hashPassword, issueAnonymousSession, issuePrivateSession, randomId, sha256, signPayload, TicketReplayWindow, verifyCapabilityTicket, verifyPassword, verifySignedToken, type NodeIdentity } from "../../../packages/security/src";
import { DpapiSecretStore, JsonNodeStorage, MasterKeyFileSecretStore, SqliteNodeStorage, type AdminAccountRuntimeState, type NodeStateFile, type NodeStorage, type PrivateDownloadRecord, type PrivatePasskeyCredential, type PrivateProfileState, type RefreshSessionRecord, type StoredImportedShow, type WatcherAccountRuntimeState, type WatcherProfileRuntimeState } from "../../../packages/storage/src";
import type { LoadedPrivateNodeConfig, PrivateNodeAccountConfig, PrivateNodeConfig, SpilledNodeMode } from "./private-config";
import { getPrivateNodeConfigPathFromEnv, hashSetupSecret, verifySetupSecret, writePrivateNodeConfig } from "./private-config";
import { decideCapability } from "./capability-policy";

const DEFAULT_CAPABILITIES: NodeCapabilityMap = {
  fetch: { visibility: "private", requiresSession: true },
  relay: { visibility: "private", requiresSession: true },
  library: { visibility: "private", requiresSession: true },
  spillshare: { visibility: "private", requiresSession: true },
  stream: { visibility: "private", requiresSession: true },
  download: { visibility: "private", requiresSession: true },
};

const REMOTE_METHOD_CAPABILITIES: Record<string, Capability> = {
  "provider.search": "provider.search",
  "provider.feed": "provider.feed",
  "provider.import": "provider.import",
  "player.embed.resolve": "player.resolve",
  "player.clean.resolve": "player.resolve",
  "player.playback.resolve": "player.resolve",
  "player.resolve": "player.resolve",
  "download.transient.create": "download.transient",
  "download.transient.status": "download.transient",
  "download.transient.cancel": "download.transient",
  "download.transient.prepare": "download.transient",
  "spillshare.manifest": "spillshare.read",
  "spillshare.transfer.prepare": "spillshare.read",
  "relay.stream": "relay.stream",
  "auth.refresh": "library.read",
  "auth.logout": "library.read",
  "auth.passkey.options": "library.read",
  "auth.passkey.verify": "library.write",
  "auth.password.disable": "node.admin",
  "invite.inspect": "library.read",
  "invite.accept": "library.write",
  "recovery.export": "node.admin",
  "recovery.restore": "node.admin",
};

const ACCESS_SESSION_TTL_MS = 15 * 60 * 1000;
const REFRESH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function createRefreshTokenRecord(input: {
  accessSessionId: string;
  principalKind: "admin" | "watcher";
  principalId: string;
  profileId?: string;
  chainId?: string;
}) {
  const token = base64UrlEncode(randomBytes(32));
  const now = Date.now();
  const record: RefreshSessionRecord = {
    refreshSessionId: randomId("refresh"),
    chainId: input.chainId ?? randomId("chain"),
    accessSessionId: input.accessSessionId,
    principalKind: input.principalKind,
    principalId: input.principalId,
    profileId: input.profileId,
    tokenHash: sha256(token),
    rotatedTokenHashes: [],
    createdAt: now,
    expiresAt: now + REFRESH_SESSION_TTL_MS,
  };
  return { token, record };
}

function recoveryWords(secret: Buffer) {
  return [...secret].map((byte) => `s${byte.toString(16).padStart(2, "0")}`).join(" ");
}

function recoverySecretFromWords(words: string) {
  const parts = words.trim().toLowerCase().split(/\s+/);
  if (parts.length !== 32 || parts.some((part) => !/^s[0-9a-f]{2}$/.test(part))) {
    throw new Error("Recovery secret must contain all 32 Spilled recovery words.");
  }
  return Buffer.from(parts.map((part) => Number.parseInt(part.slice(1), 16)));
}

function getDefaultNodeStatePath() {
  const explicitPath = process.env.SPILLEDCINEMA_NODE_STATE_FILE?.trim();
  if (explicitPath) {
    return resolve(explicitPath);
  }

  if (process.platform === "win32") {
    const appDataRoot = process.env.LOCALAPPDATA || process.env.APPDATA;
    if (appDataRoot) {
      return resolve(appDataRoot, "SpilledCinema", "node", "state.json");
    }
  }

  if (process.platform === "darwin") {
    return resolve(homedir(), "Library", "Application Support", "SpilledCinema", "node", "state.json");
  }

  const xdgStateHome = process.env.XDG_STATE_HOME?.trim();
  if (xdgStateHome) {
    return resolve(xdgStateHome, "spilledcinema", "node", "state.json");
  }

  return resolve(homedir(), ".local", "state", "spilledcinema", "node", "state.json");
}

function createConfiguredStorage(storageFile?: string): NodeStorage {
  const databasePath = process.env.SPILLED_NODE_DATABASE?.trim();
  if (!databasePath) {
    return new JsonNodeStorage(storageFile ?? getDefaultNodeStatePath());
  }
  const masterKeyFile = process.env.SPILLED_MASTER_KEY_FILE?.trim();
  if (!masterKeyFile && process.platform !== "win32") {
    throw new Error("SPILLED_MASTER_KEY_FILE is required when SPILLED_NODE_DATABASE is configured.");
  }
  const resolvedDatabase = resolve(databasePath);
  const secretRecords = resolve(process.env.SPILLED_SECRET_RECORDS_FILE?.trim() || `${resolvedDatabase}.secrets`);
  const secrets = process.platform === "win32" && !masterKeyFile
    ? new DpapiSecretStore(
        resolve(process.env.SPILLED_DPAPI_KEY_FILE?.trim() || `${resolvedDatabase}.master.dpapi`),
        secretRecords,
      )
    : new MasterKeyFileSecretStore(resolve(masterKeyFile!), secretRecords);
  return new SqliteNodeStorage(
    resolvedDatabase,
    secrets,
  );
}

export type NodeRuntimeOptions = {
  storageFile?: string;
  regionHint?: string;
  endpointUrl?: string;
  capabilities?: Partial<Record<NodeCapability, Partial<CapabilityPolicy>>>;
  mode?: SpilledNodeMode;
  privateConfig?: LoadedPrivateNodeConfig | null;
  privateSetupEnabled?: boolean;
  privateConfigPath?: string;
  storage?: NodeStorage;
  v2PublicCapabilities?: ReadonlySet<Capability>;
  passkeyOrigin?: string;
};

export type PrivateNodeSessionScopeCapability = "library" | "download" | "spillshare" | "settings";

export type PrivateNodeSessionPayload = PrivateNodeSessionToken;

export type AdminNodeSessionPayload = {
  kind: "admin";
  sessionId: string;
  nodeId: string;
  adminId: string;
  scope: {
    capabilities: Array<"settings" | "accounts" | "storage" | "sessions">;
  };
  issuedAt: number;
  expiresAt: number;
};

export type WatcherNodeSessionPayload = {
  kind: "watcher" | "private";
  sessionId: string;
  nodeId: string;
  watcherId: string;
  accountId?: string;
  profileId?: string;
  role?: "user";
  scope: {
    capabilities: Array<"library" | "download" | "spillshare">;
  };
  issuedAt: number;
  expiresAt: number;
};

function isWatcherSessionCapability(value: string): value is "library" | "download" | "spillshare" {
  return value === "library" || value === "download" || value === "spillshare";
}

export class SpilledCinemaNodeRuntime {
  readonly storage: NodeStorage;
  readonly discovery = new MemoryDiscoveryRegistry();
  readonly mdns = new MdnsService();
  private statePromise: Promise<NodeStateFile> | null = null;
  private readonly options: NodeRuntimeOptions;
  private bootstrapSetupCode: string | null = null;
  private readonly remoteReplayWindow = new TicketReplayWindow();

  constructor(options: NodeRuntimeOptions = {}) {
    this.options = options;
    this.storage = options.storage ?? createConfiguredStorage(options.storageFile);
  }

  configure(options: Partial<NodeRuntimeOptions>) {
    Object.assign(this.options, options);
    this.ensureBootstrapSetupCode();
  }

  setEndpointUrl(endpointUrl?: string) {
    this.options.endpointUrl = endpointUrl;
  }

  private async loadState() {
    if (!this.statePromise) {
      this.statePromise = this.storage.read().then((state) => this.migrateState(state));
    }
    return this.statePromise;
  }

  private migrateState(state: NodeStateFile): NodeStateFile {
    if (state.watcherAccounts.length > 0 || state.privateAccounts.length === 0) {
      return state;
    }
    const now = Date.now();
    const configAccounts = this.options.privateConfig?.accounts ?? [];
    const watcherAccounts: WatcherAccountRuntimeState[] = state.privateAccounts.map((account) => {
      const configAccount = configAccounts.find((entry) => entry.accountId === account.accountId);
      return {
        watcherId: account.accountId,
        displayName: configAccount?.displayName ?? account.accountId,
        passkeys: account.passkeys,
        quotaBytes: configAccount?.quotaBytes ?? this.options.privateConfig?.storage?.defaultAccountQuotaBytes ?? 200 * 1024 * 1024 * 1024,
        createdAt: now,
        updatedAt: now,
      };
    });
    const watcherProfiles: WatcherProfileRuntimeState[] = configAccounts.flatMap((account) =>
      account.profiles.map((profile) => ({
        watcherId: account.accountId,
        profileId: profile.profileId,
        displayName: profile.displayName,
        avatar: profile.avatar ?? "default",
        createdAt: now,
        updatedAt: now,
      })),
    );
    return {
      ...state,
      watcherAccounts,
      watcherProfiles,
    };
  }

  private async saveState(state: NodeStateFile) {
    this.statePromise = Promise.resolve(state);
    await this.storage.write(state);
  }

  private getCapabilities(): NodeCapabilityMap {
    const merged = { ...DEFAULT_CAPABILITIES };
    const mode = this.options.mode ?? "local";
    if (mode === "public-fetch") {
      merged.library = { visibility: "private", requiresSession: true };
      merged.spillshare = { visibility: "public", requiresSession: true };
    }
    if (mode === "private") {
      merged.fetch = { visibility: this.options.privateConfig?.privateNode.allowPublicFetch ? "public" : "private", requiresSession: true };
      merged.relay = { visibility: "private", requiresSession: true };
      merged.stream = { visibility: this.options.privateConfig?.privateNode.allowPublicFetch ? "public" : "private", requiresSession: true };
      merged.download = { visibility: "private", requiresSession: true };
      merged.spillshare = { visibility: "private", requiresSession: true };
      merged.library = { visibility: "private", requiresSession: true };
    }
    if (mode === "full") {
      merged.library = { visibility: "private", requiresSession: true };
      merged.spillshare = { visibility: "private", requiresSession: true };
    }
    const publicCapabilities = this.options.privateConfig?.publicCapabilities;
    if (publicCapabilities) {
      merged.fetch = { visibility: publicCapabilities.fetch === true ? "public" : "private", requiresSession: true };
      merged.stream = { visibility: publicCapabilities.stream === true ? "public" : "private", requiresSession: true };
      merged.download = { visibility: publicCapabilities.download === true ? "public" : "private", requiresSession: true };
      merged.spillshare = { visibility: publicCapabilities.spillshare ? "public" : "private", requiresSession: true };
      merged.relay = { visibility: publicCapabilities.relay ? "public" : "private", requiresSession: true };
    }
    for (const capability of NODE_CAPABILITIES) {
      const override = this.options.capabilities?.[capability];
      if (override) {
        merged[capability] = {
          ...merged[capability],
          ...override,
        };
      }
    }
    return merged;
  }

  private requirePrivateConfig() {
    if (!this.options.privateConfig?.privateNode.enabled) {
      throw new Error("Private node is not enabled.");
    }
    return this.options.privateConfig;
  }

  private ensureBootstrapSetupCode() {
    if (!this.bootstrapSetupCode) {
      this.bootstrapSetupCode = randomBytes(3).toString("hex").toUpperCase();
    }
    return this.bootstrapSetupCode;
  }

  private getSetupReason(state: NodeStateFile): "missing-config" | "missing-admin" | "missing-admin-login" | "complete" {
    if (!this.options.privateConfig?.privateNode.enabled) {
      return "missing-config";
    }
    if (state.adminAccounts.filter((account) => !account.disabledAt).length === 0) {
      return "missing-admin";
    }
    if (!state.adminAccounts.some((account) => !account.disabledAt && (account.passwordHash || account.passkeys.length > 0))) {
      return "missing-admin-login";
    }
    return "complete";
  }

  async getSetupBootstrapStatus() {
    const state = await this.loadState();
    const reason = this.getSetupReason(state);
    const enabled = reason !== "complete";
    if (enabled) {
      this.ensureBootstrapSetupCode();
    }
    return {
      enabled,
      setupRequired: enabled,
      reason,
      setupCode: null,
      configPath: this.options.privateConfigPath ?? getPrivateNodeConfigPathFromEnv(),
      nodeUrl: null,
      publicEndpointUrl: this.options.endpointUrl ?? null,
      codeRequired: true,
    };
  }

  async getSetupCodeForTerminal() {
    const state = await this.loadState();
    const reason = this.getSetupReason(state);
    if (reason !== "complete") {
      return {
        setupCode: this.ensureBootstrapSetupCode(),
        configPath: this.options.privateConfigPath ?? getPrivateNodeConfigPathFromEnv(),
        reason,
      };
    }
    return null;
  }

  private getAccount(accountId: string): PrivateNodeAccountConfig {
    const config = this.requirePrivateConfig();
    const account = (config.accounts ?? []).find((entry) => entry.accountId === accountId);
    if (!account) {
      throw new Error("Unknown account.");
    }
    return account;
  }

  private async getWatcherAccount(watcherId: string) {
    this.requirePrivateConfig();
    const state = await this.loadState();
    const watcher = state.watcherAccounts.find((entry) => entry.watcherId === watcherId && !entry.disabledAt);
    if (!watcher) {
      const legacy = (this.options.privateConfig?.accounts ?? []).find((entry) => entry.accountId === watcherId);
      if (!legacy) {
        throw new Error("Unknown watcher account.");
      }
      return {
        watcher: {
          watcherId: legacy.accountId,
          displayName: legacy.displayName,
          passkeys: state.privateAccounts.find((entry) => entry.accountId === legacy.accountId)?.passkeys ?? [],
          quotaBytes: legacy.quotaBytes ?? this.options.privateConfig?.storage?.defaultAccountQuotaBytes ?? 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } satisfies WatcherAccountRuntimeState,
        profiles: legacy.profiles.map((profile) => ({
          watcherId: legacy.accountId,
          profileId: profile.profileId,
          displayName: profile.displayName,
          avatar: profile.avatar ?? "default",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })),
      };
    }
    return {
      watcher,
      profiles: state.watcherProfiles.filter((profile) => profile.watcherId === watcher.watcherId),
    };
  }

  private async getPasskeyWatcherAccount(accountId: string): Promise<PrivateNodeAccountConfig> {
    const state = await this.loadState();
    const admin = state.adminAccounts.find((entry) => entry.adminId === accountId && !entry.disabledAt);
    if (admin) {
      return {
        accountId: admin.adminId,
        displayName: admin.displayName,
        role: "admin",
        profiles: [{ profileId: "admin", displayName: admin.displayName, avatar: "default" }],
      };
    }
    const watcher = state.watcherAccounts.find((entry) => entry.watcherId === accountId && !entry.disabledAt);
    if (watcher) {
      return {
        accountId: watcher.watcherId,
        displayName: watcher.displayName,
        role: "user",
        quotaBytes: watcher.quotaBytes,
        profiles: state.watcherProfiles
          .filter((profile) => profile.watcherId === watcher.watcherId)
          .map((profile) => ({
            profileId: profile.profileId,
            displayName: profile.displayName,
            avatar: profile.avatar,
          })),
      };
    }
    return this.getAccount(accountId);
  }

  private getAccountQuotaBytes(account: PrivateNodeAccountConfig) {
    return account.quotaBytes ?? this.requirePrivateConfig().storage?.defaultAccountQuotaBytes ?? 0;
  }

  private toPublicWatcherAccount(account: WatcherAccountRuntimeState, profiles: WatcherProfileRuntimeState[]) {
    return {
      accountId: account.watcherId,
      watcherId: account.watcherId,
      displayName: account.displayName,
      role: "user" as const,
      quotaBytes: account.quotaBytes,
      hasPassword: Boolean(account.passwordHash),
      passkeyCount: account.passkeys.length,
      profiles: profiles.map((profile) => ({
        profileId: profile.profileId,
        displayName: profile.displayName,
        avatar: profile.avatar,
      })),
    };
  }

  private toPublicAdminAccount(account: AdminAccountRuntimeState) {
    return {
      adminId: account.adminId,
      displayName: account.displayName,
      hasPassword: Boolean(account.passwordHash),
      passkeyCount: account.passkeys.length,
      disabledAt: account.disabledAt,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
  }

  private async getPasskeyContext(origin: string) {
    const parsed = new URL(origin);
    const identity = await this.ensureIdentity();
    const expectedRemoteOrigin = this.options.passkeyOrigin?.replace(/\/$/, "")
      ?? `https://${identity.nodeId}.nodes.spilled.overload.studio`;
    const localSetupAllowed =
      this.options.privateSetupEnabled === true &&
      parsed.protocol === "http:" &&
      ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
    if (!localSetupAllowed && parsed.origin !== expectedRemoteOrigin) {
      throw new Error("Passkey origin does not match this node's stable origin.");
    }
    return {
      expectedOrigin: localSetupAllowed ? parsed.origin : expectedRemoteOrigin,
      rpID: localSetupAllowed ? parsed.hostname : "nodes.spilled.overload.studio",
    };
  }

  private async createPrivateSession(input: {
    accountId: string;
    profileId?: string;
    capabilities?: Array<"library" | "download" | "spillshare">;
    ttlMs?: number;
  }) {
    const identity = await this.ensureIdentity();
    const { watcher, profiles } = await this.getWatcherAccount(input.accountId);
    if (input.profileId) {
      if (!profiles.some((profile) => profile.profileId === input.profileId)) {
        throw new Error("Profile does not belong to this watcher account.");
      }
    }
    const issuedAt = Date.now();
    const payload: WatcherNodeSessionPayload = {
      kind: "watcher",
      sessionId: randomId("watcher"),
      nodeId: identity.nodeId,
      watcherId: watcher.watcherId,
      accountId: watcher.watcherId,
      profileId: input.profileId ?? profiles[0]?.profileId,
      role: "user",
      scope: {
        capabilities: input.capabilities ?? ["library", "download", "spillshare"],
      },
      issuedAt,
      expiresAt: issuedAt + (input.ttlMs ?? ACCESS_SESSION_TTL_MS),
    };
    const token = createSignedToken(payload, identity.privateKey);
    const state = await this.loadState();
    const refresh = createRefreshTokenRecord({
      accessSessionId: payload.sessionId,
      principalKind: "watcher",
      principalId: watcher.watcherId,
      profileId: payload.profileId,
    });
    const next = {
      ...state,
      sessions: state.sessions
        .filter((entry) => entry.expiresAt > Date.now())
        .concat({
          kind: "watcher" as const,
          sessionId: payload.sessionId,
          token,
          expiresAt: payload.expiresAt,
          scope: {
            capability: "library" as const,
          },
          pairedDeviceId: watcher.watcherId,
        }),
      refreshSessions: state.refreshSessions
        .filter((entry) => !entry.revokedAt && entry.expiresAt > Date.now())
        .concat(refresh.record),
    };
    await this.saveState(next);
    return {
      token,
      accessToken: token,
      refreshToken: refresh.token,
      session: payload,
      account: this.toPublicWatcherAccount(watcher, profiles),
      profiles: this.toPublicWatcherAccount(watcher, profiles).profiles,
    };
  }

  private toPublicAccount(account: PrivateNodeAccountConfig) {
    return {
      accountId: account.accountId,
      displayName: account.displayName,
      role: account.role,
      quotaBytes: this.getAccountQuotaBytes(account),
    };
  }

  async validatePrivateSession(token: string | undefined, capability: PrivateNodeSessionScopeCapability, profileId?: string) {
    if (!token) {
      throw new Error("Missing private session token.");
    }
    const identity = await this.ensureIdentity();
    const payload = verifySignedToken<WatcherNodeSessionPayload | PrivateNodeSessionPayload>(token, identity.publicKey);
    if (!payload || (payload.kind !== "watcher" && payload.kind !== "private") || payload.nodeId !== identity.nodeId) {
      throw new Error("Invalid private session token.");
    }
    if (payload.expiresAt <= Date.now()) {
      throw new Error("Private session expired.");
    }
    if (capability === "settings" || !payload.scope.capabilities.some((entry) => entry === capability)) {
      throw new Error("Private session is missing required capability.");
    }
    const watcherId = "watcherId" in payload ? payload.watcherId : payload.accountId;
    const { watcher, profiles } = await this.getWatcherAccount(watcherId);
    const state = await this.loadState();
    const storedSession = state.sessions.find((entry) => entry.sessionId === payload.sessionId && entry.token === token);
    if (!storedSession || storedSession.expiresAt <= Date.now()) {
      throw new Error("Private session was revoked or expired.");
    }
    if (profileId) {
      if (!profiles.some((profile) => profile.profileId === profileId)) {
        throw new Error("Profile does not belong to this watcher account.");
      }
    }
    return {
      ...payload,
      scope: {
        capabilities: payload.scope.capabilities.filter(isWatcherSessionCapability),
      },
      accountId: watcher.watcherId,
      watcherId: watcher.watcherId,
      account: watcher,
      profiles,
    };
  }

  private async ensureIdentity(): Promise<NodeIdentity & {
    transportPublicKey: string;
    transportPrivateKey: string;
    transportKeyVersion: number;
    transportKeySignature: string;
    installId: string;
    regionHint?: string;
  }> {
    const state = await this.loadState();
    if (
      state.node?.nodeId &&
      state.node.publicKey &&
      state.node.privateKey &&
      state.node.transportPublicKey &&
      state.node.transportPrivateKey &&
      state.node.transportKeyVersion &&
      state.node.transportKeySignature &&
      state.node.installId
    ) {
      return {
        nodeId: state.node.nodeId,
        publicKey: state.node.publicKey,
        privateKey: state.node.privateKey,
        algorithm: "ed25519",
        transportPublicKey: state.node.transportPublicKey,
        transportPrivateKey: state.node.transportPrivateKey,
        transportKeyVersion: state.node.transportKeyVersion,
        transportKeySignature: state.node.transportKeySignature,
        installId: state.node.installId,
        regionHint: state.node.regionHint,
      };
    }

    const identity = state.node?.nodeId && state.node.publicKey && state.node.privateKey
      ? {
          nodeId: state.node.nodeId,
          publicKey: state.node.publicKey,
          privateKey: state.node.privateKey,
          algorithm: "ed25519" as const,
        }
      : generateNodeIdentity();
    const transport = generateNodeTransportIdentity(identity);
    const installId = state.node?.installId ?? base64UrlEncode(randomBytes(16));
    const next = {
      ...state,
      node: {
        ...identity,
        transportPublicKey: transport.publicKey,
        transportPrivateKey: transport.privateKey,
        transportKeyVersion: transport.keyVersion,
        transportKeySignature: transport.identitySignature,
        installId,
        regionHint: this.options.regionHint,
      },
    };
    await this.saveState(next);
    return {
      ...identity,
      transportPublicKey: transport.publicKey,
      transportPrivateKey: transport.privateKey,
      transportKeyVersion: transport.keyVersion,
      transportKeySignature: transport.identitySignature,
      installId,
      regionHint: next.node.regionHint,
    };
  }

  async getNodeRecord(): Promise<NodeRecord> {
    const identity = await this.ensureIdentity();
    const state = await this.loadState();
    const regionHint = identity.regionHint ?? this.options.regionHint;
    const unsigned = {
      nodeId: identity.nodeId,
      publicKey: identity.publicKey,
      protocolVersion: NODE_PROTOCOL_VERSION,
      endpoints: this.options.endpointUrl
        ? [{
            protocol: (this.options.endpointUrl.startsWith("https") ? "https" : "http") as "https" | "http",
            url: this.options.endpointUrl,
          }]
        : [{ protocol: "local" as const, url: "native-ipc" }],
      capabilities: this.getCapabilities(),
      ...(regionHint ? { regionHint } : {}),
      load: {
        activeSessions: state.sessions.filter((session) => session.expiresAt > Date.now()).length,
        activeDownloads: 0,
        spillshareItems: state.spillshareSources.length,
        relayPercent: 0,
      },
      publishedAt: Date.now(),
      ttlMs: 300_000,
    };

    return {
      ...unsigned,
      signature: signPayload(unsigned, identity.privateKey),
    };
  }

  async getTransportIdentityRecord() {
    const identity = await this.ensureIdentity();
    return {
      nodeId: identity.nodeId,
      ed25519PublicKey: identity.publicKey,
      x25519PublicKey: identity.transportPublicKey,
      transportKeySignature: identity.transportKeySignature,
      installIdHash: sha256(identity.installId),
      protocolVersion: NODE_PROTOCOL_VERSION,
      keyVersion: identity.transportKeyVersion,
    };
  }

  async createGatewayEnrollmentApplication(input: {
    enrollmentCredential?: string;
    advertisedCapabilities?: Capability[];
    issuedAt?: number;
  } = {}) {
    const identity = await this.ensureIdentity();
    const storedCredential = await this.storage.getProtectedSecret?.("gateway.enrollmentCredential");
    const enrollmentCredential = input.enrollmentCredential ?? storedCredential ?? base64UrlEncode(randomBytes(32));
    if (!storedCredential && this.storage.setProtectedSecret) {
      await this.storage.setProtectedSecret("gateway.enrollmentCredential", enrollmentCredential);
    }
    const advertisedCapabilities = [...new Set(
      input.advertisedCapabilities ?? [...this.getEnabledV2Capabilities()],
    )].sort();
    const application = {
      ...(await this.getTransportIdentityRecord()),
      enrollmentCredential,
      advertisedCapabilities,
      endpointUrl: this.options.endpointUrl ?? null,
      issuedAt: input.issuedAt ?? Date.now(),
    };
    return {
      ...application,
      applicationSignature: signPayload(application, identity.privateKey),
    };
  }

  async handleEncryptedRemoteRequest(input: {
    ticket: CapabilityTicketV2;
    envelope: EncryptedRequestEnvelopeV2;
    controlPlanePublicKey: string;
    execute: (request: {
      method: string;
      params: unknown;
      capability: Capability;
      ticketId: string;
      limits: { maxResponseBytes: number; maxDurationMs: number };
    }) => Promise<unknown>;
  }) {
    const identity = await this.ensureIdentity();
    if (input.envelope.ticketId !== input.ticket.ticketId) {
      throw new Error("Encrypted request and capability ticket do not match.");
    }
    if (!verifyCapabilityTicket({
      ticket: input.ticket,
      controlPlanePublicKey: input.controlPlanePublicKey,
      expectedNodeId: identity.nodeId,
      expectedCapability: input.ticket.capability,
    })) {
      throw new Error("Capability ticket is invalid.");
    }
    if (!this.remoteReplayWindow.accept(input.ticket.ticketId, input.envelope.nonce, input.ticket.expiresAt)) {
      throw new Error("Encrypted request replay was rejected.");
    }
    const requestBytes = base64UrlDecode(input.envelope.ciphertext).length;
    if (requestBytes > input.ticket.maxRequestBytes) {
      throw new Error("Encrypted request exceeds its ticket quota.");
    }
    const decoded = JSON.parse(
      decryptNodeRequest(input.envelope, identity.transportPrivateKey).toString("utf8"),
    ) as { method?: unknown; params?: unknown };
    if (typeof decoded.method !== "string") {
      throw new Error("Remote RPC method is missing.");
    }
    if (REMOTE_METHOD_CAPABILITIES[decoded.method] !== input.ticket.capability) {
      throw new Error("Remote RPC method does not match its capability ticket.");
    }
    if (input.ticket.capability === "spillshare.read" && !input.ticket.contentId) {
      throw new Error("SpillShare tickets must be content-specific.");
    }
    if (input.ticket.contentId) {
      const params = decoded.params && typeof decoded.params === "object"
        ? decoded.params as Record<string, unknown>
        : {};
      if (params.contentId !== input.ticket.contentId) {
        throw new Error("Remote RPC content does not match its capability ticket.");
      }
    }
    const enabled = input.ticket.principalKind === "private"
      ? new Set(V2_CAPABILITIES)
      : this.getEnabledV2Capabilities();
    const policy = decideCapability({
      principal: input.ticket.principalKind === "verifier"
        ? { kind: "gateway-verifier", attestationId: input.ticket.ticketId }
        : input.ticket.principalKind === "private"
          ? { kind: "owner", accountId: "ticket-bound", sessionId: input.ticket.ticketId }
          : { kind: "public", ticketId: input.ticket.ticketId, ephemeralKey: input.envelope.clientEphemeralKey },
      capability: input.ticket.capability,
      ticketCapability: input.ticket.capability,
      enabledCapabilities: enabled,
    });
    if (!policy.allow) {
      throw new Error(`Capability denied: ${"reason" in policy ? policy.reason : "policy-denied"}.`);
    }
    const startedAt = Date.now();
    let responsePayload: { ok: true; result: unknown } | { ok: false; error: string };
    try {
      const payload = await input.execute({
        method: decoded.method,
        params: decoded.params ?? {},
        capability: input.ticket.capability,
        ticketId: input.ticket.ticketId,
        limits: {
          maxResponseBytes: input.ticket.maxResponseBytes,
          maxDurationMs: input.ticket.maxDurationMs,
        },
      });
      responsePayload = { ok: true, result: payload };
    } catch (error) {
      responsePayload = {
        ok: false,
        error: error instanceof Error ? error.message : "Remote operation failed.",
      };
    }
    if (Date.now() - startedAt > Math.min(input.ticket.maxDurationMs, policy.limits.maxDurationMs)) {
      responsePayload = { ok: false, error: "Remote RPC exceeded its ticket duration." };
    }
    let responseBytes = Buffer.from(JSON.stringify(responsePayload), "utf8");
    if (responseBytes.length > input.ticket.maxResponseBytes) {
      responsePayload = { ok: false, error: "Remote RPC response exceeds its ticket quota." };
      responseBytes = Buffer.from(JSON.stringify(responsePayload), "utf8");
    }
    return encryptNodeResponse({
      request: input.envelope,
      nodeTransportPrivateKey: identity.transportPrivateKey,
      plaintext: responseBytes,
    });
  }

  private getEnabledV2Capabilities() {
    if (this.options.v2PublicCapabilities) {
      return new Set(this.options.v2PublicCapabilities);
    }
    const legacy = this.getCapabilities();
    const enabled = new Set<Capability>();
    if (legacy.fetch.visibility === "public") {
      enabled.add("provider.search");
      enabled.add("provider.feed");
      enabled.add("provider.import");
    }
    if (legacy.stream.visibility === "public") {
      enabled.add("player.resolve");
    }
    if (legacy.download.visibility === "public") {
      enabled.add("download.transient");
    }
    if (legacy.spillshare.visibility === "public") {
      enabled.add("spillshare.read");
    }
    if (legacy.relay.visibility === "public") {
      enabled.add("relay.stream");
    }
    return enabled;
  }

  async announce() {
    const record = await this.getNodeRecord();
    this.discovery.publish(record);
    this.mdns.announce(`spilledcinema-${record.nodeId}`, record);
    return record;
  }

  async getStatus(): Promise<NodeCompatibilityStatus & {
    discovery: {
      mdns: number;
      knownNodes: number;
      publishedSpillshare: number;
    };
  }> {
    const record = await this.announce();
    const state = await this.loadState();
    const privateConfig = this.options.privateConfig;
    const enrolledPasskeyCount = state.watcherAccounts.reduce((sum, account) => sum + account.passkeys.length, 0)
      + state.adminAccounts.reduce((sum, account) => sum + account.passkeys.length, 0);
    const setupReason = this.getSetupReason(state);
    if (setupReason !== "complete") {
      this.ensureBootstrapSetupCode();
    }
    const totalUsedBytes = state.privateDownloads.reduce((sum, entry) => sum + entry.sizeBytes, 0);
    const quotaBytes = privateConfig
      ? state.watcherAccounts.reduce((sum, account) => sum + account.quotaBytes, 0)
      : null;
    return {
      status: "ok",
      node: {
        nodeId: record.nodeId,
        mode: this.options.mode ?? "local",
        protocolVersion: record.protocolVersion,
        regionHint: record.regionHint ?? null,
        endpointUrl: this.options.endpointUrl ?? null,
        capabilities: record.capabilities,
      },
      auth: {
        privateAuthEnabled: Boolean(privateConfig?.privateNode.enabled),
        passkeysEnabled: Boolean(privateConfig?.privateNode.enabled),
        setupRequired: setupReason !== "complete",
        setupReason,
        adminPasswordEnabled: state.adminAccounts.some((account) => Boolean(account.passwordHash)),
        watcherPasswordEnabled: state.watcherAccounts.some((account) => Boolean(account.passwordHash)),
        enrolledPasskeyCount,
        oidcProviders: (privateConfig?.oidcProviders ?? []).map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
        })),
        pairedDeviceCount: state.pairedDevices.length,
      },
      capabilities: {
        providerSearch: record.capabilities.fetch.visibility === "public" || record.capabilities.fetch.visibility === "paired",
        providerImport: record.capabilities.fetch.visibility === "public" || record.capabilities.fetch.visibility === "paired",
        providerFeeds: record.capabilities.fetch.visibility === "public" || record.capabilities.fetch.visibility === "paired",
        streamResolve: record.capabilities.stream.visibility !== "private" || Boolean(privateConfig?.privateNode.enabled),
        fullDownload: record.capabilities.download.visibility !== "private" || Boolean(privateConfig?.privateNode.enabled),
        browserDownloadResolve: record.capabilities.fetch.visibility !== "private" || Boolean(privateConfig?.privateNode.enabled),
        spillsharePublish: Boolean(privateConfig?.privateNode.enabled),
        spillshareServe: record.capabilities.spillshare.visibility !== "private" || Boolean(privateConfig?.privateNode.enabled),
        privateLibrary: Boolean(privateConfig?.privateNode.enabled),
      },
      mediaTools: {
        ffmpeg: false,
        ffprobe: false,
        canDownload: record.capabilities.download.visibility !== "private" || Boolean(privateConfig?.privateNode.enabled),
        canValidate: false,
        canRepairSeekableMp4: false,
      },
      discovery: {
        mdns: this.mdns.discover().length,
        knownNodes: this.discovery.list().length,
        publishedSpillshare: state.spillshareSources.length,
      },
      storage: {
        privateStorageEnabled: Boolean(privateConfig?.privateNode.enabled),
        rootConfigured: Boolean(privateConfig?.storageRoot),
        totalUsedBytes,
        quotaBytes,
      },
    };
  }

  async acceptRemoteNodeRecord(record: NodeRecord) {
    if (!verifyNodeRecord(record)) {
      throw new Error("Rejected unsigned or invalid node record.");
    }
    this.discovery.publish(record);
    return record;
  }

  async listKnownNodeRecords(capability?: NodeCapability) {
    await this.announce();
    return this.discovery.list(capability);
  }

  async persistImportedShow(slug: string, title: string, payload: unknown) {
    const state = await this.loadState();
    const nextShow: StoredImportedShow = {
      slug,
      title,
      importedAt: Date.now(),
      payload,
    };
    const next = {
      ...state,
      importedShows: [nextShow, ...state.importedShows.filter((entry) => entry.slug !== slug)].slice(0, 500),
    };
    await this.saveState(next);
    return nextShow;
  }

  async updateDownloadInventory(episodeIds: string[], files: string[]) {
    const state = await this.loadState();
    const next = {
      ...state,
      downloads: {
        updatedAt: Date.now(),
        episodeIds,
        files,
      },
    };
    await this.saveState(next);
    return next.downloads;
  }

  async publishSpillshareSource(source: SpillshareSource) {
    const state = await this.loadState();
    const spillshareSources = state.spillshareSources
      .filter((entry) => !(entry.contentId === source.contentId && entry.nodeId === source.nodeId))
      .concat(source);
    const next = {
      ...state,
      spillshareSources,
    };
    await this.saveState(next);
    this.discovery.publishSpillshare(source);
    return source;
  }

  async findSpillshareSources(contentId: string) {
    const state = await this.loadState();
    const local = state.spillshareSources.filter((entry) => entry.contentId === contentId);
    const discovered = this.discovery.lookupSpillshare(contentId);
    return [...local, ...discovered.filter((entry) => !local.some((localEntry) => localEntry.nodeId === entry.nodeId))];
  }

  async acceptRemoteSpillshareSource(source: SpillshareSource) {
    this.discovery.publishSpillshare(source);
    return source;
  }

  async listPublishedSpillshareSources() {
    const state = await this.loadState();
    return state.spillshareSources;
  }

  async createSpillshareManifest(contentId: string) {
    if (this.getCapabilities().spillshare.visibility !== "public") {
      throw new Error("SpillShare is disabled.");
    }
    const state = await this.loadState();
    const download = state.privateDownloads.find(
      (entry) => entry.contentId === contentId && entry.spillshareEnabled,
    );
    if (!download) {
      throw new Error("Content is not eligible for SpillShare.");
    }
    const metadata = await stat(download.filePath);
    if (!metadata.isFile()) {
      throw new Error("SpillShare source is not a regular file.");
    }
    const chunkSize = 4 * 1024 * 1024;
    const chunks: Array<{ index: number; offset: number; size: number; sha256: string }> = [];
    const whole = createHash("sha256");
    const file = await open(download.filePath, "r");
    try {
      let offset = 0;
      let index = 0;
      while (offset < metadata.size) {
        const size = Math.min(chunkSize, metadata.size - offset);
        const buffer = Buffer.allocUnsafe(size);
        const { bytesRead } = await file.read(buffer, 0, size, offset);
        if (bytesRead !== size) throw new Error("SpillShare source changed while creating its manifest.");
        const bytes = buffer.subarray(0, bytesRead);
        whole.update(bytes);
        chunks.push({
          index,
          offset,
          size: bytesRead,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
        offset += bytesRead;
        index += 1;
      }
    } finally {
      await file.close();
    }
    const identity = await this.ensureIdentity();
    const unsigned = {
      version: 2 as const,
      manifestId: randomId("manifest"),
      contentId,
      sourceNodeId: identity.nodeId,
      mimeType: download.mimeType,
      size: metadata.size,
      sha256: whole.digest("hex"),
      chunks,
      createdAt: Date.now(),
      expiresAt: Date.now() + 5 * 60_000,
    };
    return { ...unsigned, signature: signPayload(unsigned, identity.privateKey) };
  }

  async getSpillshareTransferSource(contentId: string) {
    const manifest = await this.createSpillshareManifest(contentId);
    const state = await this.loadState();
    const download = state.privateDownloads.find(
      (entry) => entry.contentId === contentId && entry.spillshareEnabled,
    );
    if (!download) throw new Error("SpillShare source is unavailable.");
    return {
      path: download.filePath,
      contentId,
      manifestId: manifest.manifestId,
      chunks: manifest.chunks,
      manifest,
    };
  }

  async createAnonymousGrant(scope: SessionScope): Promise<AnonymousSessionGrant> {
    const identity = await this.ensureIdentity();
    const grant = issueAnonymousSession({
      nodeId: identity.nodeId,
      scope,
      ttlMs: 5 * 60 * 1000,
      privateKeyPem: identity.privateKey,
    });

    const state = await this.loadState();
    const next = {
      ...state,
      sessions: state.sessions
        .filter((entry) => entry.expiresAt > Date.now())
        .concat({
          kind: "anonymous" as const,
          sessionId: grant.sessionId,
          token: grant.token,
          expiresAt: grant.expiresAt,
          scope: grant.scope,
        }),
    };
    await this.saveState(next);
    return grant;
  }

  async startPairing(deviceName: string): Promise<PairingRequest> {
    const pairing = createPairingRequest({
      deviceName,
      ttlMs: 10 * 60 * 1000,
    });
    const state = await this.loadState();
    const next = {
      ...state,
      pendingPairings: state.pendingPairings
        .filter((entry) => entry.expiresAt > Date.now())
        .concat(pairing),
    };
    await this.saveState(next);
    return pairing;
  }

  async approvePairing(pairingId: string, code: string): Promise<PairingApproval> {
    const identity = await this.ensureIdentity();
    const state = await this.loadState();
    const pairing = state.pendingPairings.find((entry) => entry.pairingId === pairingId);
    if (!pairing || pairing.expiresAt < Date.now()) {
      throw new Error("Pairing request expired or missing.");
    }
    if (pairing.code !== code.trim().toUpperCase()) {
      throw new Error("Invalid pairing code.");
    }

    const approval = approvePairing({
      nodeId: identity.nodeId,
      pairing,
      privateKeyPem: identity.privateKey,
    });

    const next = {
      ...state,
      pendingPairings: state.pendingPairings.filter((entry) => entry.pairingId !== pairingId),
      pairedDevices: state.pairedDevices
        .filter((entry) => entry.pairedDeviceId !== approval.device.pairedDeviceId)
        .concat(approval.device),
    };
    await this.saveState(next);
    return approval;
  }

  async issuePrivateGrant(pairedDeviceId: string, scope: SessionScope): Promise<PrivateSessionGrant> {
    const identity = await this.ensureIdentity();
    const state = await this.loadState();
    const pairedDevice = state.pairedDevices.find((entry) => entry.pairedDeviceId === pairedDeviceId);
    if (!pairedDevice) {
      throw new Error("Unknown paired device.");
    }

    const grant = issuePrivateSession({
      nodeId: identity.nodeId,
      pairedDeviceId,
      scope,
      ttlMs: 15 * 60 * 1000,
      privateKeyPem: identity.privateKey,
    });

    const next = {
      ...state,
      sessions: state.sessions
        .filter((entry) => entry.expiresAt > Date.now())
        .concat({
          kind: "private" as const,
          sessionId: grant.sessionId,
          token: grant.token,
          expiresAt: grant.expiresAt,
          scope: grant.scope,
          pairedDeviceId,
        }),
    };
    await this.saveState(next);
    return grant;
  }

  async revokePairedDevice(pairedDeviceId: string) {
    const state = await this.loadState();
    const next = {
      ...state,
      pairedDevices: state.pairedDevices.filter((entry) => entry.pairedDeviceId !== pairedDeviceId),
      sessions: state.sessions.filter((entry) => entry.pairedDeviceId !== pairedDeviceId),
    };
    await this.saveState(next);
  }

  async getPasskeyRegistrationChallenge() {
    return createPasskeyRegistrationChallenge();
  }

  async getPasskeyAuthenticationChallenge() {
    return createPasskeyAuthenticationChallenge();
  }

  async listPrivateAccounts() {
    this.requirePrivateConfig();
    const state = await this.loadState();
    if (state.watcherAccounts.length > 0) {
      return state.watcherAccounts
        .filter((account) => !account.disabledAt)
        .map((account) => this.toPublicWatcherAccount(
          account,
          state.watcherProfiles.filter((profile) => profile.watcherId === account.watcherId),
        ));
    }
    return (this.options.privateConfig?.accounts ?? []).map((account) => ({
      ...this.toPublicAccount(account),
      profiles: account.profiles,
    }));
  }

  async completePrivateSetup(input: {
    setupCode: string;
    dashboardOrigin: string;
    nodeName: string;
    admin?: { adminId: string; displayName: string; password: string };
    accountId?: string;
    displayName?: string;
    password?: string;
    quotaBytes?: number;
    profiles?: Array<{ profileId: string; displayName: string; avatar?: string }>;
    initialWatchers?: Array<{
      watcherId: string;
      displayName: string;
      password?: string;
      quotaBytes: number;
      profiles: Array<{ profileId: string; displayName: string; avatar?: string }>;
    }>;
    publicCapabilities?: {
      fetch?: boolean;
      search?: boolean;
      import?: boolean;
      stream?: boolean;
      download?: boolean;
      spillshare?: boolean;
      relay?: boolean;
    };
    allowPublicFetch?: boolean;
  }) {
    const status = await this.getSetupBootstrapStatus();
    if (!status.enabled || !this.bootstrapSetupCode) {
      throw new Error("Private node setup is not waiting for bootstrap.");
    }
    if (input.setupCode.trim().toUpperCase() !== this.bootstrapSetupCode) {
      throw new Error("Invalid setup code.");
    }
    const adminId = (input.admin?.adminId ?? input.accountId ?? "admin").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_") || "admin";
    const adminPassword = input.admin?.password ?? input.password ?? "";
    if (adminPassword.length < 10) {
      throw new Error("Admin password must be at least 10 characters.");
    }
    const now = Date.now();
    const defaultQuota = Math.max(1, Math.round(input.quotaBytes ?? 500 * 1024 * 1024 * 1024));
    const legacyWatcherId = (input.accountId ?? "watcher_owner").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_") || "watcher_owner";
    const initialWatchers = input.initialWatchers?.length
      ? input.initialWatchers
      : [{
          watcherId: legacyWatcherId.startsWith("watcher_") ? legacyWatcherId : `watcher_${legacyWatcherId.replace(/^acct_/, "")}`,
          displayName: input.displayName ?? "Owner",
          quotaBytes: defaultQuota,
          profiles: input.profiles?.length ? input.profiles : [{ profileId: "prof_owner", displayName: input.displayName || "Owner", avatar: "default" }],
        }];
    const config: PrivateNodeConfig = {
      privateNode: {
        enabled: true,
        nodeName: input.nodeName.trim() || "Private Node",
        setupSecretHash: hashSetupSecret(this.bootstrapSetupCode),
        allowPublicFetch: input.publicCapabilities?.fetch ?? input.allowPublicFetch ?? true,
        allowedOrigins: [input.dashboardOrigin],
      },
      publicCapabilities: {
        fetch: input.publicCapabilities?.fetch ?? input.allowPublicFetch ?? true,
        search: input.publicCapabilities?.search ?? true,
        import: input.publicCapabilities?.import ?? true,
        stream: input.publicCapabilities?.stream ?? true,
        download: input.publicCapabilities?.download ?? true,
        spillshare: input.publicCapabilities?.spillshare ?? false,
        relay: input.publicCapabilities?.relay ?? false,
      },
      oidcProviders: [],
      storage: {
        root: "./spilled-data",
        defaultAccountQuotaBytes: 200 * 1024 * 1024 * 1024,
      },
    };
    const configPath = this.options.privateConfigPath ?? getPrivateNodeConfigPathFromEnv();
    const loadedConfig = writePrivateNodeConfig(configPath, config);
    this.configure({
      mode: "full",
      privateConfig: loadedConfig,
      privateConfigPath: configPath,
      privateSetupEnabled: false,
    });
    const state = await this.loadState();
    const adminAccount: AdminAccountRuntimeState = {
      adminId,
      displayName: input.admin?.displayName?.trim() || input.displayName?.trim() || "Admin",
      passwordHash: await hashPassword(adminPassword),
      passkeys: [],
      createdAt: now,
      updatedAt: now,
    };
    const watcherAccounts: WatcherAccountRuntimeState[] = await Promise.all(initialWatchers.map(async (watcher) => ({
      watcherId: watcher.watcherId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_") || randomId("watcher"),
      displayName: watcher.displayName.trim() || "Watcher",
      passwordHash: watcher.password ? await hashPassword(watcher.password) : undefined,
      passkeys: [],
      quotaBytes: Math.max(1, Math.round(watcher.quotaBytes || defaultQuota)),
      createdAt: now,
      updatedAt: now,
    })));
    const watcherProfiles: WatcherProfileRuntimeState[] = initialWatchers.flatMap((watcher, watcherIndex) => {
      const watcherId = watcherAccounts[watcherIndex]?.watcherId ?? watcher.watcherId;
      return (watcher.profiles.length ? watcher.profiles : [{ profileId: "prof_owner", displayName: watcher.displayName, avatar: "default" }]).map((profile, index) => ({
        watcherId,
        profileId: profile.profileId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_") || `prof_${index + 1}`,
        displayName: profile.displayName.trim() || `Profile ${index + 1}`,
        avatar: profile.avatar || "default",
        createdAt: now,
        updatedAt: now,
      }));
    });
    await this.saveState({
      ...state,
      adminAccounts: [adminAccount],
      watcherAccounts,
      watcherProfiles,
    });
    this.bootstrapSetupCode = null;
    return {
      ok: true,
      configPath,
      admin: this.toPublicAdminAccount(adminAccount),
      accounts: await this.listPrivateAccounts(),
    };
  }

  async listOidcProviders() {
    const config = this.requirePrivateConfig();
    return (config.oidcProviders ?? []).map((provider) => ({
      providerId: provider.providerId,
      displayName: provider.displayName,
      issuer: provider.issuer,
      scopes: provider.scopes ?? ["openid", "profile", "email"],
    }));
  }

  private async createAdminSession(admin: AdminAccountRuntimeState) {
    const identity = await this.ensureIdentity();
    const issuedAt = Date.now();
    const payload: AdminNodeSessionPayload = {
      kind: "admin",
      sessionId: randomId("admin"),
      nodeId: identity.nodeId,
      adminId: admin.adminId,
      scope: {
        capabilities: ["settings", "accounts", "storage", "sessions"],
      },
      issuedAt,
      expiresAt: issuedAt + ACCESS_SESSION_TTL_MS,
    };
    const token = createSignedToken(payload, identity.privateKey);
    const state = await this.loadState();
    const refresh = createRefreshTokenRecord({
      accessSessionId: payload.sessionId,
      principalKind: "admin",
      principalId: admin.adminId,
    });
    await this.saveState({
      ...state,
      sessions: state.sessions.filter((entry) => entry.expiresAt > Date.now()).concat({
        kind: "admin",
        sessionId: payload.sessionId,
        token,
        expiresAt: payload.expiresAt,
        scope: { capability: "library" },
        pairedDeviceId: admin.adminId,
      }),
      refreshSessions: state.refreshSessions
        .filter((entry) => !entry.revokedAt && entry.expiresAt > Date.now())
        .concat(refresh.record),
    });
    return {
      token,
      accessToken: token,
      refreshToken: refresh.token,
      session: payload,
      admin: this.toPublicAdminAccount(admin),
    };
  }

  async loginAdminPassword(input: { adminId: string; password: string }) {
    const state = await this.loadState();
    const admin = state.adminAccounts.find((entry) => entry.adminId === input.adminId && !entry.disabledAt);
    if (!admin?.passwordHash || !(await verifyPassword(input.password, admin.passwordHash))) {
      throw new Error("Invalid username or password.");
    }
    return this.createAdminSession(admin);
  }

  async disableAdminPassword(adminToken: string | undefined) {
    const session = await this.validateAdminSession(adminToken);
    if (session.admin.passkeys.length === 0) {
      throw new Error("Enroll an owner passkey before disabling password fallback.");
    }
    const state = await this.loadState();
    await this.saveState({
      ...state,
      adminAccounts: state.adminAccounts.map((entry) =>
        entry.adminId === session.adminId
          ? { ...entry, passwordHash: undefined, updatedAt: Date.now() }
          : entry
      ),
      securityEvents: state.securityEvents.concat({
        eventId: randomId("security"),
        eventType: "admin-password-disabled",
        principalId: session.adminId,
        createdAt: Date.now(),
      }),
    });
    return { ok: true };
  }

  async loginWatcherPassword(input: { watcherId: string; password: string; profileId?: string }) {
    const { watcher, profiles } = await this.getWatcherAccount(input.watcherId);
    if (!watcher.passwordHash || !(await verifyPassword(input.password, watcher.passwordHash))) {
      throw new Error("Invalid username or password.");
    }
    const profileId = input.profileId && profiles.some((profile) => profile.profileId === input.profileId)
      ? input.profileId
      : profiles[0]?.profileId;
    return this.createPrivateSession({ accountId: watcher.watcherId, profileId });
  }

  async validateAdminSession(token: string | undefined) {
    if (!token) {
      throw new Error("Missing admin session token.");
    }
    const identity = await this.ensureIdentity();
    const payload = verifySignedToken<AdminNodeSessionPayload>(token, identity.publicKey);
    if (!payload || payload.kind !== "admin" || payload.nodeId !== identity.nodeId || payload.expiresAt <= Date.now()) {
      throw new Error("Invalid admin session token.");
    }
    const state = await this.loadState();
    const storedSession = state.sessions.find((entry) => entry.sessionId === payload.sessionId && entry.token === token && entry.expiresAt > Date.now());
    const admin = state.adminAccounts.find((entry) => entry.adminId === payload.adminId && !entry.disabledAt);
    if (!storedSession || !admin) {
      throw new Error("Admin session was revoked or expired.");
    }
    return { ...payload, admin };
  }

  async getAdminMe(token: string | undefined) {
    const session = await this.validateAdminSession(token);
    return {
      session: {
        sessionId: session.sessionId,
        adminId: session.adminId,
        expiresAt: session.expiresAt,
        scope: session.scope,
      },
      admin: this.toPublicAdminAccount(session.admin),
    };
  }

  async logoutAdminSession(token: string | undefined) {
    const identity = await this.ensureIdentity();
    const payload = token ? verifySignedToken<AdminNodeSessionPayload>(token, identity.publicKey) : null;
    if (!payload) {
      return { ok: true };
    }
    const state = await this.loadState();
    await this.saveState({
      ...state,
      sessions: state.sessions.filter((entry) => entry.sessionId !== payload.sessionId),
      refreshSessions: state.refreshSessions.map((entry) =>
        entry.accessSessionId === payload.sessionId ? { ...entry, revokedAt: Date.now() } : entry
      ),
    });
    return { ok: true };
  }

  async getAdminStatus(token: string | undefined) {
    await this.validateAdminSession(token);
    const status = await this.getStatus();
    const state = await this.loadState();
    return {
      status,
      admins: state.adminAccounts.map((account) => this.toPublicAdminAccount(account)),
      watchers: state.watcherAccounts.map((account) => this.toPublicWatcherAccount(
        account,
        state.watcherProfiles.filter((profile) => profile.watcherId === account.watcherId),
      )),
      sessions: state.sessions.filter((session) => session.expiresAt > Date.now()).map((session) => ({
        sessionId: session.sessionId,
        kind: session.kind,
        expiresAt: session.expiresAt,
        pairedDeviceId: session.pairedDeviceId,
      })),
      storage: {
        root: this.options.privateConfig?.storageRoot ?? null,
        usedBytes: state.privateDownloads.reduce((sum, entry) => sum + entry.sizeBytes, 0),
        downloadsCount: state.privateDownloads.length,
      },
    };
  }

  async updatePublicCapabilities(token: string | undefined, capabilities: NonNullable<PrivateNodeConfig["publicCapabilities"]>) {
    await this.validateAdminSession(token);
    const config = this.requirePrivateConfig();
    const nextConfig: PrivateNodeConfig = {
      privateNode: {
        ...config.privateNode,
        allowPublicFetch: capabilities.fetch !== false,
      },
      publicCapabilities: {
        ...config.publicCapabilities,
        ...capabilities,
      },
      oidcProviders: config.oidcProviders,
      storage: config.storage,
    };
    const loadedConfig = writePrivateNodeConfig(config.configPath, nextConfig);
    this.configure({ privateConfig: loadedConfig, mode: "full" });
    return { ok: true, publicCapabilities: loadedConfig.publicCapabilities };
  }

  async createWatcherAccount(token: string | undefined, input: { watcherId: string; displayName: string; password?: string; quotaBytes: number; profiles?: Array<{ profileId: string; displayName: string; avatar?: string }> }) {
    await this.validateAdminSession(token);
    const state = await this.loadState();
    const watcherId = input.watcherId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    if (!watcherId) throw new Error("Watcher id is required.");
    if (state.watcherAccounts.some((entry) => entry.watcherId === watcherId)) throw new Error("Watcher already exists.");
    const now = Date.now();
    const watcher: WatcherAccountRuntimeState = {
      watcherId,
      displayName: input.displayName.trim() || watcherId,
      passwordHash: input.password ? await hashPassword(input.password) : undefined,
      passkeys: [],
      quotaBytes: Math.max(1, Math.round(input.quotaBytes || this.options.privateConfig?.storage?.defaultAccountQuotaBytes || 0)),
      createdAt: now,
      updatedAt: now,
    };
    const profiles = (input.profiles?.length ? input.profiles : [{ profileId: "prof_main", displayName: watcher.displayName, avatar: "default" }]).map((profile, index) => ({
      watcherId,
      profileId: profile.profileId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_") || `prof_${index + 1}`,
      displayName: profile.displayName.trim() || `Profile ${index + 1}`,
      avatar: profile.avatar || "default",
      createdAt: now,
      updatedAt: now,
    }));
    await this.saveState({
      ...state,
      watcherAccounts: state.watcherAccounts.concat(watcher),
      watcherProfiles: state.watcherProfiles.concat(profiles),
    });
    return this.toPublicWatcherAccount(watcher, profiles);
  }

  async createWatcherInvitation(token: string | undefined, input: {
    watcherId: string;
    displayName: string;
    quotaBytes: number;
    profiles?: Array<{ profileId: string; displayName: string; avatar?: string }>;
  }) {
    await this.validateAdminSession(token);
    const state = await this.loadState();
    const watcherId = input.watcherId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    if (!watcherId || state.watcherAccounts.some((entry) => entry.watcherId === watcherId)) {
      throw new Error("A unique watcher id is required.");
    }
    const secret = base64UrlEncode(randomBytes(16));
    const confirmationCode = String(randomBytes(3).readUIntBE(0, 3) % 1_000_000).padStart(6, "0");
    const now = Date.now();
    const invitation = {
      invitationId: randomId("invite"),
      secretHash: sha256(secret),
      confirmationCode,
      watcherId,
      displayName: input.displayName.trim() || watcherId,
      quotaBytes: Math.max(1, Math.round(input.quotaBytes)),
      profiles: (input.profiles?.length ? input.profiles : [{
        profileId: "prof_main",
        displayName: input.displayName.trim() || watcherId,
        avatar: "default",
      }]).map((profile, index) => ({
        profileId: profile.profileId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_") || `prof_${index + 1}`,
        displayName: profile.displayName.trim() || `Profile ${index + 1}`,
        avatar: profile.avatar || "default",
      })),
      createdAt: now,
      expiresAt: now + 10 * 60 * 1000,
    };
    await this.saveState({
      ...state,
      watcherInvitations: state.watcherInvitations
        .filter((entry) => entry.expiresAt > now && !entry.consumedAt)
        .concat(invitation),
    });
    const identity = await this.ensureIdentity();
    return {
      invitationId: invitation.invitationId,
      invitationSecret: secret,
      confirmationCode,
      nodeId: identity.nodeId,
      expiresAt: invitation.expiresAt,
      url: `https://${identity.nodeId}.nodes.spilled.overload.studio/invite?secret=${encodeURIComponent(secret)}`,
    };
  }

  async inspectWatcherInvitation(input: { invitationSecret: string; confirmationCode: string }) {
    const state = await this.loadState();
    const invitation = state.watcherInvitations.find((entry) =>
      entry.secretHash === sha256(input.invitationSecret) &&
      entry.confirmationCode === input.confirmationCode &&
      !entry.consumedAt &&
      entry.expiresAt > Date.now()
    );
    if (!invitation) throw new Error("Invitation is invalid, expired, or already used.");
    return {
      invitationId: invitation.invitationId,
      watcherId: invitation.watcherId,
      displayName: invitation.displayName,
      profiles: invitation.profiles,
      expiresAt: invitation.expiresAt,
    };
  }

  async exportRecoveryKit(adminToken: string | undefined) {
    await this.validateAdminSession(adminToken);
    const state = await this.loadState();
    if (!state.node) throw new Error("Node identity is unavailable.");
    const secret = randomBytes(32);
    const words = recoveryWords(secret);
    const recoveryId = randomId("recovery");
    const key = createHash("sha256").update(secret).digest();
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(recoveryId));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(state.node), "utf8"),
      cipher.final(),
    ]);
    const encryptedIdentityBackup = [
      nonce.toString("base64"),
      cipher.getAuthTag().toString("base64"),
      ciphertext.toString("base64"),
    ].join(".");
    const verifier = await hashArgon2(base64UrlEncode(secret), {
      algorithm: 2,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });
    await this.saveState({
      ...state,
      recoveryStates: [{
        recoveryId,
        verifier,
        encryptedIdentityBackup,
        createdAt: Date.now(),
      }],
    });
    return {
      recoveryId,
      words,
      qrPayload: base64UrlEncode(Buffer.from(JSON.stringify({
        version: 2,
        nodeId: state.node.nodeId,
        recoveryId,
        words,
      }))),
      nodeId: state.node.nodeId,
    };
  }

  async restoreRecoveryKit(input: { recoveryId: string; words: string }) {
    const secret = recoverySecretFromWords(input.words);
    const state = await this.loadState();
    const recovery = state.recoveryStates.find((entry) => entry.recoveryId === input.recoveryId && !entry.usedAt);
    if (!recovery || !(await verifyArgon2(recovery.verifier, base64UrlEncode(secret)))) {
      throw new Error("Recovery kit is invalid or already used.");
    }
    const [nonceText, tagText, ciphertextText] = recovery.encryptedIdentityBackup.split(".");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      createHash("sha256").update(secret).digest(),
      Buffer.from(nonceText, "base64"),
    );
    decipher.setAAD(Buffer.from(recovery.recoveryId));
    decipher.setAuthTag(Buffer.from(tagText, "base64"));
    const restoredNode = JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, "base64")),
      decipher.final(),
    ]).toString("utf8")) as NonNullable<NodeStateFile["node"]>;
    const now = Date.now();
    await this.saveState({
      ...state,
      node: restoredNode,
      sessions: [],
      refreshSessions: state.refreshSessions.map((entry) => ({ ...entry, revokedAt: now })),
      watcherInvitations: state.watcherInvitations.map((entry) => ({ ...entry, consumedAt: now })),
      adminAccounts: state.adminAccounts.map((entry) => ({ ...entry, passkeys: [], updatedAt: now })),
      watcherAccounts: state.watcherAccounts.map((entry) => ({ ...entry, passkeys: [], updatedAt: now })),
      privateAccounts: state.privateAccounts.map((entry) => ({ ...entry, passkeys: [] })),
      recoveryStates: state.recoveryStates.map((entry) =>
        entry.recoveryId === recovery.recoveryId ? { ...entry, usedAt: now } : entry
      ),
      securityEvents: state.securityEvents.concat({
        eventId: randomId("security"),
        eventType: "owner-recovery",
        createdAt: now,
      }),
    });
    this.bootstrapSetupCode = randomBytes(3).toString("hex").toUpperCase();
    return {
      ok: true,
      nodeId: restoredNode.nodeId,
      requiresNewOwnerPasskey: true,
      requiresGatewayReenrollment: true,
      ownerEnrollmentCode: this.bootstrapSetupCode,
    };
  }

  async getPrivateMe(token: string | undefined) {
    const session = await this.validatePrivateSession(token, "library");
    return {
      session: {
        sessionId: session.sessionId,
        accountId: session.accountId,
        profileId: session.profileId ?? null,
        role: "user",
        expiresAt: session.expiresAt,
        scope: session.scope,
      },
      account: this.toPublicWatcherAccount(session.account, session.profiles),
      profiles: this.toPublicWatcherAccount(session.account, session.profiles).profiles,
    };
  }

  async logoutPrivateSession(token: string | undefined) {
    const identity = await this.ensureIdentity();
    const payload = token ? verifySignedToken<PrivateNodeSessionPayload>(token, identity.publicKey) : null;
    if (!payload) {
      return { ok: true };
    }
    const state = await this.loadState();
    await this.saveState({
      ...state,
      sessions: state.sessions.filter((entry) => entry.sessionId !== payload.sessionId),
      refreshSessions: state.refreshSessions.map((entry) =>
        entry.accessSessionId === payload.sessionId ? { ...entry, revokedAt: Date.now() } : entry
      ),
    });
    return { ok: true };
  }

  async rotateRefreshSession(refreshToken: string) {
    const tokenHash = sha256(refreshToken);
    let state = await this.loadState();
    const replayed = state.refreshSessions.find((entry) => entry.rotatedTokenHashes.includes(tokenHash));
    if (replayed) {
      const now = Date.now();
      await this.saveState({
        ...state,
        sessions: state.sessions.filter((session) =>
          !state.refreshSessions.some((entry) => entry.chainId === replayed.chainId && entry.accessSessionId === session.sessionId)
        ),
        refreshSessions: state.refreshSessions.map((entry) =>
          entry.chainId === replayed.chainId ? { ...entry, revokedAt: now } : entry
        ),
        securityEvents: state.securityEvents.concat({
          eventId: randomId("security"),
          eventType: "refresh-token-reuse",
          principalId: replayed.principalId,
          createdAt: now,
        }),
      });
      throw new Error("Refresh token reuse detected; the device session was revoked.");
    }
    const current = state.refreshSessions.find((entry) =>
      entry.tokenHash === tokenHash && !entry.revokedAt && entry.expiresAt > Date.now()
    );
    if (!current) {
      throw new Error("Refresh session is invalid or expired.");
    }
    const now = Date.now();
    await this.saveState({
      ...state,
      sessions: state.sessions.filter((entry) => entry.sessionId !== current.accessSessionId),
      refreshSessions: state.refreshSessions.map((entry) =>
        entry.refreshSessionId === current.refreshSessionId
          ? {
              ...entry,
              rotatedAt: now,
              revokedAt: now,
              rotatedTokenHashes: entry.rotatedTokenHashes.concat(entry.tokenHash),
            }
          : entry
      ),
    });
    const issued = current.principalKind === "admin"
      ? await this.createAdminSession((await this.loadState()).adminAccounts.find((entry) =>
          entry.adminId === current.principalId && !entry.disabledAt
        ) ?? (() => { throw new Error("Refresh-session administrator no longer exists."); })())
      : await this.createPrivateSession({
          accountId: current.principalId,
          profileId: current.profileId,
        });
    state = await this.loadState();
    const newest = [...state.refreshSessions]
      .reverse()
      .find((entry) => entry.accessSessionId === issued.session.sessionId);
    if (newest) {
      await this.saveState({
        ...state,
        refreshSessions: state.refreshSessions.map((entry) =>
          entry.refreshSessionId === newest.refreshSessionId
            ? { ...entry, chainId: current.chainId, rotatedTokenHashes: current.rotatedTokenHashes.concat(current.tokenHash) }
            : entry
        ),
      });
    }
    return issued;
  }

  async createPasskeyRegistrationOptions(input: { accountId: string; setupSecret: string; origin: string }) {
    const config = this.requirePrivateConfig();
    let state = await this.loadState();
    const setupSecret = input.setupSecret.trim();
    const acceptsPrintedCode = this.bootstrapSetupCode && setupSecret.toUpperCase() === this.bootstrapSetupCode;
    const invitation = state.watcherInvitations.find((entry) =>
      entry.watcherId === input.accountId &&
      entry.secretHash === sha256(setupSecret) &&
      !entry.consumedAt &&
      entry.expiresAt > Date.now()
    );
    if (!acceptsPrintedCode && !invitation && !verifySetupSecret(setupSecret, config.privateNode.setupSecretHash)) {
      throw new Error("Invalid setup secret.");
    }
    if (invitation && !state.watcherAccounts.some((entry) => entry.watcherId === invitation.watcherId)) {
      const now = Date.now();
      state = {
        ...state,
        watcherAccounts: state.watcherAccounts.concat({
          watcherId: invitation.watcherId,
          displayName: invitation.displayName,
          passkeys: [],
          quotaBytes: invitation.quotaBytes,
          createdAt: now,
          updatedAt: now,
        }),
        watcherProfiles: state.watcherProfiles.concat(invitation.profiles.map((profile) => ({
          watcherId: invitation.watcherId,
          ...profile,
          createdAt: now,
          updatedAt: now,
        }))),
        watcherInvitations: state.watcherInvitations.map((entry) =>
          entry.invitationId === invitation.invitationId ? { ...entry, acceptedAt: now } : entry
        ),
      };
      await this.saveState(state);
    }
    const account = await this.getPasskeyWatcherAccount(input.accountId);
    const runtimePasskeys = account.role === "admin"
      ? state.adminAccounts.find((entry) => entry.adminId === account.accountId)?.passkeys ?? []
      : state.privateAccounts.find((entry) => entry.accountId === account.accountId)?.passkeys ?? [];
    const { rpID } = await this.getPasskeyContext(input.origin);
    const options = await generateRegistrationOptions({
      rpName: config.privateNode.nodeName ?? "Spilled Private Node",
      rpID,
      userName: account.accountId,
      userDisplayName: account.displayName,
      excludeCredentials: runtimePasskeys.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports as never,
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });
    await this.saveState({
      ...state,
      privateAuthChallenges: state.privateAuthChallenges
        .filter((entry) => entry.expiresAt > Date.now())
        .concat({
          challengeId: randomId("challenge"),
          kind: "passkey-registration",
          accountId: account.accountId,
          challenge: options.challenge,
          createdAt: Date.now(),
          expiresAt: Date.now() + 5 * 60 * 1000,
        }),
    });
    return { options, account: this.toPublicAccount(account) };
  }

  async verifyPasskeyRegistration(input: { accountId: string; origin: string; response: RegistrationResponseJSON }) {
    const account = await this.getPasskeyWatcherAccount(input.accountId);
    const state = await this.loadState();
    const challenge = [...state.privateAuthChallenges]
      .reverse()
      .find((entry) => entry.kind === "passkey-registration" && entry.accountId === account.accountId && entry.expiresAt > Date.now());
    if (!challenge) {
      throw new Error("Passkey registration challenge expired.");
    }
    const passkeyContext = await this.getPasskeyContext(input.origin);
    const verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: passkeyContext.expectedOrigin,
      expectedRPID: passkeyContext.rpID,
      requireUserVerification: true,
    });
    if (!verification.verified) {
      throw new Error("Passkey registration was not verified.");
    }
    const credential = verification.registrationInfo.credential;
    const passkey: PrivatePasskeyCredential = {
      credentialId: credential.id,
      publicKey: base64UrlEncode(Buffer.from(credential.publicKey)),
      counter: credential.counter,
      transports: input.response.response.transports,
      createdAt: Date.now(),
    };
    if (account.role === "admin") {
      const admin = state.adminAccounts.find((entry) => entry.adminId === account.accountId && !entry.disabledAt);
      if (!admin) throw new Error("Administrator no longer exists.");
      await this.saveState({
        ...state,
        adminAccounts: state.adminAccounts.map((entry) =>
          entry.adminId === admin.adminId
            ? { ...entry, passkeys: entry.passkeys.filter((item) => item.credentialId !== passkey.credentialId).concat(passkey), updatedAt: Date.now() }
            : entry
        ),
        privateAuthChallenges: state.privateAuthChallenges.filter((entry) => entry.challenge !== challenge.challenge),
      });
      return await this.createAdminSession({ ...admin, passkeys: admin.passkeys.concat(passkey) });
    }
    const existingAccount = state.privateAccounts.find((entry) => entry.accountId === account.accountId);
    const privateAccounts = existingAccount
      ? state.privateAccounts.map((entry) =>
          entry.accountId === account.accountId
            ? {
                ...entry,
                passkeys: entry.passkeys.filter((item) => item.credentialId !== passkey.credentialId).concat(passkey),
              }
            : entry,
        )
      : state.privateAccounts.concat({
          accountId: account.accountId,
          passkeys: [passkey],
          usedStorageBytes: 0,
        });
    await this.saveState({
      ...state,
      privateAccounts,
      privateAuthChallenges: state.privateAuthChallenges.filter((entry) => entry.challenge !== challenge.challenge),
      watcherInvitations: state.watcherInvitations.map((entry) =>
        entry.watcherId === account.accountId && entry.acceptedAt && !entry.consumedAt
          ? { ...entry, consumedAt: Date.now() }
          : entry
      ),
    });
    return await this.createPrivateSession({ accountId: account.accountId, profileId: account.profiles[0]?.profileId });
  }

  async createPasskeyLoginOptions(input: { accountId: string; origin: string }) {
    const account = await this.getPasskeyWatcherAccount(input.accountId);
    const state = await this.loadState();
    const runtimePasskeys = account.role === "admin"
      ? state.adminAccounts.find((entry) => entry.adminId === account.accountId)?.passkeys ?? []
      : state.privateAccounts.find((entry) => entry.accountId === account.accountId)?.passkeys ?? [];
    if (runtimePasskeys.length === 0) {
      throw new Error("No passkeys are enrolled for this account.");
    }
    const options = await generateAuthenticationOptions({
      rpID: (await this.getPasskeyContext(input.origin)).rpID,
      allowCredentials: runtimePasskeys.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports as never,
      })),
      userVerification: "required",
    });
    await this.saveState({
      ...state,
      privateAuthChallenges: state.privateAuthChallenges
        .filter((entry) => entry.expiresAt > Date.now())
        .concat({
          challengeId: randomId("challenge"),
          kind: "passkey-login",
          accountId: account.accountId,
          challenge: options.challenge,
          createdAt: Date.now(),
          expiresAt: Date.now() + 5 * 60 * 1000,
        }),
    });
    return { options, account: this.toPublicAccount(account) };
  }

  async verifyPasskeyLogin(input: { accountId: string; origin: string; response: AuthenticationResponseJSON; profileId?: string }) {
    const account = await this.getPasskeyWatcherAccount(input.accountId);
    const state = await this.loadState();
    const runtimePasskeys = account.role === "admin"
      ? state.adminAccounts.find((entry) => entry.adminId === account.accountId)?.passkeys ?? []
      : state.privateAccounts.find((entry) => entry.accountId === account.accountId)?.passkeys ?? [];
    const passkey = runtimePasskeys.find((entry) => entry.credentialId === input.response.id);
    if (!passkey) {
      throw new Error("Unknown passkey.");
    }
    const challenge = [...state.privateAuthChallenges]
      .reverse()
      .find((entry) => entry.kind === "passkey-login" && entry.accountId === account.accountId && entry.expiresAt > Date.now());
    if (!challenge) {
      throw new Error("Passkey login challenge expired.");
    }
    const passkeyContext = await this.getPasskeyContext(input.origin);
    const verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: passkeyContext.expectedOrigin,
      expectedRPID: passkeyContext.rpID,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(base64UrlDecode(passkey.publicKey)),
        counter: passkey.counter,
      },
      requireUserVerification: true,
    });
    if (!verification.verified) {
      throw new Error("Passkey login was not verified.");
    }
    const updatedPasskey = { ...passkey, counter: verification.authenticationInfo.newCounter, lastUsedAt: Date.now() };
    await this.saveState({
      ...state,
      adminAccounts: account.role === "admin"
        ? state.adminAccounts.map((entry) => entry.adminId === account.accountId
            ? { ...entry, passkeys: entry.passkeys.map((item) => item.credentialId === passkey.credentialId ? updatedPasskey : item), updatedAt: Date.now() }
            : entry)
        : state.adminAccounts,
      privateAccounts: state.privateAccounts.map((entry) =>
        entry.accountId === account.accountId
          ? {
              ...entry,
              passkeys: entry.passkeys.map((item) =>
                item.credentialId === passkey.credentialId
                  ? updatedPasskey
                  : item,
              ),
            }
          : entry,
      ),
      privateAuthChallenges: state.privateAuthChallenges.filter((entry) => entry.challenge !== challenge.challenge),
    });
    if (account.role === "admin") {
      const admin = (await this.loadState()).adminAccounts.find((entry) => entry.adminId === account.accountId);
      if (!admin) throw new Error("Administrator no longer exists.");
      return await this.createAdminSession(admin);
    }
    return await this.createPrivateSession({ accountId: account.accountId, profileId: input.profileId ?? account.profiles[0]?.profileId });
  }

  async listPrivateProfiles(token: string | undefined) {
    const session = await this.validatePrivateSession(token, "library");
    return this.toPublicWatcherAccount(session.account, session.profiles).profiles;
  }

  async selectPrivateProfile(token: string | undefined, profileId: string) {
    const session = await this.validatePrivateSession(token, "library", profileId);
    return await this.createPrivateSession({
      accountId: session.accountId,
      profileId,
      capabilities: session.scope.capabilities.filter((capability): capability is "library" | "download" | "spillshare" =>
        capability === "library" || capability === "download" || capability === "spillshare"
      ),
    });
  }

  async getPrivateLibrary(token: string | undefined, profileId: string) {
    const session = await this.validatePrivateSession(token, "library", profileId);
    const state = await this.loadState();
    return state.privateProfiles.find((entry) => entry.accountId === session.accountId && entry.profileId === profileId) ?? {
      accountId: session.accountId,
      profileId,
      libraryState: null,
      settings: null,
      enabledProviderFeeds: null,
      downloadedLanguages: {},
      updatedAt: 0,
    } satisfies PrivateProfileState;
  }

  async putPrivateLibrary(token: string | undefined, profileId: string, patch: Partial<PrivateProfileState>) {
    const session = await this.validatePrivateSession(token, "library", profileId);
    const existing = await this.getPrivateLibrary(token, profileId);
    const nextProfile: PrivateProfileState = {
      accountId: session.accountId,
      profileId,
      libraryState: patch.libraryState ?? existing.libraryState,
      settings: patch.settings ?? existing.settings,
      enabledProviderFeeds: patch.enabledProviderFeeds ?? existing.enabledProviderFeeds,
      downloadedLanguages: patch.downloadedLanguages ?? existing.downloadedLanguages,
      updatedAt: Date.now(),
    };
    const state = await this.loadState();
    await this.saveState({
      ...state,
      privateProfiles: state.privateProfiles
        .filter((entry) => !(entry.accountId === session.accountId && entry.profileId === profileId))
        .concat(nextProfile),
    });
    return nextProfile;
  }

  async getPrivateStorageSummary(token: string | undefined) {
    const session = await this.validatePrivateSession(token, "library");
    const state = await this.loadState();
    const quotaBytes = session.account.quotaBytes;
    const accountDownloads = state.privateDownloads.filter((entry) => entry.accountId === session.accountId);
    const usedBytes = accountDownloads.reduce((sum, entry) => sum + entry.sizeBytes, 0);
    return {
      accountId: session.accountId,
      quotaBytes,
      usedBytes,
      availableBytes: Math.max(0, quotaBytes - usedBytes),
      profiles: session.profiles.map((profile) => ({
        profileId: profile.profileId,
        usedBytes: accountDownloads
          .filter((entry) => entry.profileId === profile.profileId)
          .reduce((sum, entry) => sum + entry.sizeBytes, 0),
      })),
    };
  }

  async listPrivateDownloads(token: string | undefined, profileId?: string) {
    const session = await this.validatePrivateSession(token, "download", profileId);
    const state = await this.loadState();
    return state.privateDownloads.filter((entry) =>
      entry.accountId === session.accountId && (!profileId || entry.profileId === profileId)
    );
  }

  async registerPrivateDownload(token: string | undefined, record: Omit<PrivateDownloadRecord, "createdAt" | "accountId">) {
    const session = await this.validatePrivateSession(token, "download", record.profileId);
    const storage = await this.getPrivateStorageSummary(token);
    if (storage.availableBytes < record.sizeBytes) {
      throw new Error("Private node storage quota exceeded.");
    }
    const nextRecord: PrivateDownloadRecord = {
      ...record,
      accountId: session.accountId,
      createdAt: Date.now(),
    };
    const state = await this.loadState();
    await this.saveState({
      ...state,
      privateDownloads: state.privateDownloads
        .filter((entry) => entry.downloadId !== nextRecord.downloadId)
        .concat(nextRecord),
    });
    return nextRecord;
  }

  async deletePrivateDownload(token: string | undefined, downloadId: string) {
    const session = await this.validatePrivateSession(token, "download");
    const state = await this.loadState();
    const existing = state.privateDownloads.find((entry) => entry.accountId === session.accountId && entry.downloadId === downloadId);
    if (!existing) {
      throw new Error("Unknown private download.");
    }
    await this.saveState({
      ...state,
      privateDownloads: state.privateDownloads.filter((entry) => !(entry.accountId === session.accountId && entry.downloadId === downloadId)),
    });
    return existing;
  }

  async getPrivateDownloadFile(token: string | undefined, downloadId: string) {
    const session = await this.validatePrivateSession(token, "download");
    const config = this.requirePrivateConfig();
    const state = await this.loadState();
    const download = state.privateDownloads.find((entry) => entry.accountId === session.accountId && entry.downloadId === downloadId);
    if (!download) {
      throw new Error("Unknown private download.");
    }
    const resolvedPath = resolve(download.filePath);
    const storageRoot = resolve(config.storageRoot);
    const relativePath = relative(storageRoot, resolvedPath);
    if (relativePath.startsWith("..") || resolve(relativePath) === relativePath) {
      throw new Error("Private download file is outside the configured storage root.");
    }
    return {
      ...download,
      filePath: resolvedPath,
    };
  }
}
