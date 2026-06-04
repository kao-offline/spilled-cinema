import { homedir } from "node:os";
import { relative, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { MemoryDiscoveryRegistry, MdnsService, verifyNodeRecord } from "../../../packages/discovery/src";
import { NODE_CAPABILITIES, NODE_PROTOCOL_VERSION, type AnonymousSessionGrant, type CapabilityPolicy, type NodeCapability, type NodeCapabilityMap, type NodeCompatibilityStatus, type NodeRecord, type PairingApproval, type PairingRequest, type PrivateNodeSessionToken, type PrivateSessionGrant, type SessionScope, type SpillshareSource } from "../../../packages/node-protocol/src";
import { approvePairing, base64UrlDecode, base64UrlEncode, createPairingRequest, createPasskeyAuthenticationChallenge, createPasskeyRegistrationChallenge, createSignedToken, generateNodeIdentity, hashPassword, issueAnonymousSession, issuePrivateSession, randomId, signPayload, verifyPassword, verifySignedToken, type NodeIdentity } from "../../../packages/security/src";
import { JsonNodeStorage, type AdminAccountRuntimeState, type NodeStateFile, type PrivateDownloadRecord, type PrivatePasskeyCredential, type PrivateProfileState, type StoredImportedShow, type WatcherAccountRuntimeState, type WatcherProfileRuntimeState } from "../../../packages/storage/src";
import type { LoadedPrivateNodeConfig, PrivateNodeAccountConfig, PrivateNodeConfig, SpilledNodeMode } from "./private-config";
import { getPrivateNodeConfigPathFromEnv, hashSetupSecret, verifySetupSecret, writePrivateNodeConfig } from "./private-config";

const DEFAULT_CAPABILITIES: NodeCapabilityMap = {
  fetch: { visibility: "public", requiresSession: true },
  relay: { visibility: "public", requiresSession: true },
  library: { visibility: "private", requiresSession: true },
  spillshare: { visibility: "public", requiresSession: true },
  stream: { visibility: "public", requiresSession: true },
  download: { visibility: "public", requiresSession: true },
};

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

export type NodeRuntimeOptions = {
  storageFile?: string;
  regionHint?: string;
  endpointUrl?: string;
  capabilities?: Partial<Record<NodeCapability, Partial<CapabilityPolicy>>>;
  mode?: SpilledNodeMode;
  privateConfig?: LoadedPrivateNodeConfig | null;
  privateSetupEnabled?: boolean;
  privateConfigPath?: string;
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
  readonly storage: JsonNodeStorage;
  readonly discovery = new MemoryDiscoveryRegistry();
  readonly mdns = new MdnsService();
  private statePromise: Promise<NodeStateFile> | null = null;
  private readonly options: NodeRuntimeOptions;
  private bootstrapSetupCode: string | null = null;

  constructor(options: NodeRuntimeOptions = {}) {
    this.options = options;
    this.storage = new JsonNodeStorage(
      options.storageFile ?? getDefaultNodeStatePath(),
    );
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
    const mode = this.options.mode ?? "public-fetch";
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
      merged.spillshare = { visibility: "public", requiresSession: true };
    }
    const publicCapabilities = this.options.privateConfig?.publicCapabilities;
    if (publicCapabilities) {
      merged.fetch = { visibility: publicCapabilities.fetch === false ? "private" : "public", requiresSession: true };
      merged.stream = { visibility: publicCapabilities.stream === false ? "private" : "public", requiresSession: true };
      merged.download = { visibility: publicCapabilities.download === false ? "private" : "public", requiresSession: true };
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

  private getRpId(origin: string) {
    return new URL(origin).hostname;
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
      expiresAt: issuedAt + (input.ttlMs ?? 24 * 60 * 60 * 1000),
    };
    const token = createSignedToken(payload, identity.privateKey);
    const state = await this.loadState();
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
    };
    await this.saveState(next);
    return {
      token,
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

  private async ensureIdentity(): Promise<NodeIdentity & { regionHint?: string }> {
    const state = await this.loadState();
    if (state.node?.nodeId && state.node.publicKey && state.node.privateKey) {
      return state.node as NodeIdentity & { regionHint?: string };
    }

    const identity = generateNodeIdentity();
    const next = {
      ...state,
      node: {
        ...identity,
        regionHint: this.options.regionHint,
      },
    };
    await this.saveState(next);
    return next.node!;
  }

  async getNodeRecord(): Promise<NodeRecord> {
    const identity = await this.ensureIdentity();
    const state = await this.loadState();
    const regionHint = identity.regionHint ?? this.options.regionHint;
    const unsigned = {
      nodeId: identity.nodeId,
      publicKey: identity.publicKey,
      protocolVersion: NODE_PROTOCOL_VERSION,
      endpoints: [
        {
          protocol: (this.options.endpointUrl?.startsWith("https") ? "https" : "http") as "https" | "http",
          url: this.options.endpointUrl ?? "http://127.0.0.1:5173",
        },
      ],
      capabilities: this.getCapabilities(),
      ...(regionHint ? { regionHint } : {}),
      load: {
        activeSessions: state.sessions.filter((session) => session.expiresAt > Date.now()).length,
        activeDownloads: 0,
        spillshareItems: state.spillshareSources.length,
        relayPercent: 0,
      },
      publishedAt: Date.now(),
      ttlMs: 60_000,
    };

    return {
      ...unsigned,
      signature: signPayload(unsigned, identity.privateKey),
    };
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
        mode: this.options.mode ?? "public-fetch",
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
      expiresAt: issuedAt + 8 * 60 * 60 * 1000,
    };
    const token = createSignedToken(payload, identity.privateKey);
    const state = await this.loadState();
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
    });
    return {
      token,
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
    });
    return { ok: true };
  }

  async createPasskeyRegistrationOptions(input: { accountId: string; setupSecret: string; origin: string }) {
    const config = this.requirePrivateConfig();
    const state = await this.loadState();
    const setupSecret = input.setupSecret.trim();
    const acceptsPrintedCode = this.bootstrapSetupCode && setupSecret.toUpperCase() === this.bootstrapSetupCode;
    if (!acceptsPrintedCode && !verifySetupSecret(setupSecret, config.privateNode.setupSecretHash)) {
      throw new Error("Invalid setup secret.");
    }
    const account = this.getAccount(input.accountId);
    const runtimeAccount = state.privateAccounts.find((entry) => entry.accountId === account.accountId);
    const rpID = this.getRpId(input.origin);
    const options = await generateRegistrationOptions({
      rpName: config.privateNode.nodeName ?? "Spilled Private Node",
      rpID,
      userName: account.accountId,
      userDisplayName: account.displayName,
      excludeCredentials: (runtimeAccount?.passkeys ?? []).map((credential) => ({
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
    const account = this.getAccount(input.accountId);
    const state = await this.loadState();
    const challenge = [...state.privateAuthChallenges]
      .reverse()
      .find((entry) => entry.kind === "passkey-registration" && entry.accountId === account.accountId && entry.expiresAt > Date.now());
    if (!challenge) {
      throw new Error("Passkey registration challenge expired.");
    }
    const verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: input.origin,
      expectedRPID: this.getRpId(input.origin),
      requireUserVerification: false,
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
    });
    return await this.createPrivateSession({ accountId: account.accountId, profileId: account.profiles[0]?.profileId });
  }

  async createPasskeyLoginOptions(input: { accountId: string; origin: string }) {
    const account = this.getAccount(input.accountId);
    const state = await this.loadState();
    const runtimeAccount = state.privateAccounts.find((entry) => entry.accountId === account.accountId);
    if (!runtimeAccount || runtimeAccount.passkeys.length === 0) {
      throw new Error("No passkeys are enrolled for this account.");
    }
    const options = await generateAuthenticationOptions({
      rpID: this.getRpId(input.origin),
      allowCredentials: runtimeAccount.passkeys.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports as never,
      })),
      userVerification: "preferred",
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
    const account = this.getAccount(input.accountId);
    const state = await this.loadState();
    const runtimeAccount = state.privateAccounts.find((entry) => entry.accountId === account.accountId);
    const passkey = runtimeAccount?.passkeys.find((entry) => entry.credentialId === input.response.id);
    if (!runtimeAccount || !passkey) {
      throw new Error("Unknown passkey.");
    }
    const challenge = [...state.privateAuthChallenges]
      .reverse()
      .find((entry) => entry.kind === "passkey-login" && entry.accountId === account.accountId && entry.expiresAt > Date.now());
    if (!challenge) {
      throw new Error("Passkey login challenge expired.");
    }
    const verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: input.origin,
      expectedRPID: this.getRpId(input.origin),
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(base64UrlDecode(passkey.publicKey)),
        counter: passkey.counter,
      },
      requireUserVerification: false,
    });
    if (!verification.verified) {
      throw new Error("Passkey login was not verified.");
    }
    await this.saveState({
      ...state,
      privateAccounts: state.privateAccounts.map((entry) =>
        entry.accountId === account.accountId
          ? {
              ...entry,
              passkeys: entry.passkeys.map((item) =>
                item.credentialId === passkey.credentialId
                  ? { ...item, counter: verification.authenticationInfo.newCounter, lastUsedAt: Date.now() }
                  : item,
              ),
            }
          : entry,
      ),
      privateAuthChallenges: state.privateAuthChallenges.filter((entry) => entry.challenge !== challenge.challenge),
    });
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
