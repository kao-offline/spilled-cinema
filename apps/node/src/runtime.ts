import { homedir } from "node:os";
import { relative, resolve } from "node:path";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { MemoryDiscoveryRegistry, MdnsService, verifyNodeRecord } from "../../../packages/discovery/src";
import { NODE_CAPABILITIES, NODE_PROTOCOL_VERSION, type AnonymousSessionGrant, type CapabilityPolicy, type NodeCapability, type NodeCapabilityMap, type NodeCompatibilityStatus, type NodeRecord, type PairingApproval, type PairingRequest, type PrivateNodeSessionToken, type PrivateSessionGrant, type SessionScope, type SpillshareSource } from "../../../packages/node-protocol/src";
import { approvePairing, base64UrlDecode, base64UrlEncode, createPairingRequest, createPasskeyAuthenticationChallenge, createPasskeyRegistrationChallenge, createSignedToken, generateNodeIdentity, issueAnonymousSession, issuePrivateSession, randomId, signPayload, verifySignedToken, type NodeIdentity } from "../../../packages/security/src";
import { JsonNodeStorage, type NodeStateFile, type PrivateDownloadRecord, type PrivatePasskeyCredential, type PrivateProfileState, type StoredImportedShow } from "../../../packages/storage/src";
import type { LoadedPrivateNodeConfig, PrivateNodeAccountConfig, SpilledNodeMode } from "./private-config";
import { verifySetupSecret } from "./private-config";

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
};

export type PrivateNodeSessionScopeCapability = "library" | "download" | "spillshare" | "settings";

export type PrivateNodeSessionPayload = PrivateNodeSessionToken;

export class SpilledCinemaNodeRuntime {
  readonly storage: JsonNodeStorage;
  readonly discovery = new MemoryDiscoveryRegistry();
  readonly mdns = new MdnsService();
  private statePromise: Promise<NodeStateFile> | null = null;
  private readonly options: NodeRuntimeOptions;

  constructor(options: NodeRuntimeOptions = {}) {
    this.options = options;
    this.storage = new JsonNodeStorage(
      options.storageFile ?? getDefaultNodeStatePath(),
    );
  }

  configure(options: Partial<NodeRuntimeOptions>) {
    Object.assign(this.options, options);
  }

  setEndpointUrl(endpointUrl?: string) {
    this.options.endpointUrl = endpointUrl;
  }

  private async loadState() {
    if (!this.statePromise) {
      this.statePromise = this.storage.read();
    }
    return this.statePromise;
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

  private getAccount(accountId: string): PrivateNodeAccountConfig {
    const config = this.requirePrivateConfig();
    const account = config.accounts.find((entry) => entry.accountId === accountId);
    if (!account) {
      throw new Error("Unknown account.");
    }
    return account;
  }

  private getAccountQuotaBytes(account: PrivateNodeAccountConfig) {
    return account.quotaBytes ?? this.requirePrivateConfig().storage?.defaultAccountQuotaBytes ?? 0;
  }

  private assertProfile(account: PrivateNodeAccountConfig, profileId: string) {
    const profile = account.profiles.find((entry) => entry.profileId === profileId);
    if (!profile) {
      throw new Error("Profile does not belong to this account.");
    }
    return profile;
  }

  private getRpId(origin: string) {
    return new URL(origin).hostname;
  }

  private async createPrivateSession(input: {
    accountId: string;
    profileId?: string;
    capabilities?: PrivateNodeSessionScopeCapability[];
    ttlMs?: number;
  }) {
    const identity = await this.ensureIdentity();
    const account = this.getAccount(input.accountId);
    if (input.profileId) {
      this.assertProfile(account, input.profileId);
    }
    const issuedAt = Date.now();
    const payload: PrivateNodeSessionPayload = {
      kind: "private",
      sessionId: randomId("priv"),
      nodeId: identity.nodeId,
      accountId: account.accountId,
      profileId: input.profileId,
      role: account.role,
      scope: {
        capabilities: input.capabilities ?? ["library", "download", "spillshare", "settings"],
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
          kind: "private" as const,
          sessionId: payload.sessionId,
          token,
          expiresAt: payload.expiresAt,
          scope: {
            capability: "library" as const,
          },
          pairedDeviceId: account.accountId,
        }),
    };
    await this.saveState(next);
    return {
      token,
      session: payload,
      account: this.toPublicAccount(account),
      profiles: account.profiles,
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
    const payload = verifySignedToken<PrivateNodeSessionPayload>(token, identity.publicKey);
    if (!payload || payload.kind !== "private" || payload.nodeId !== identity.nodeId) {
      throw new Error("Invalid private session token.");
    }
    if (payload.expiresAt <= Date.now()) {
      throw new Error("Private session expired.");
    }
    if (!payload.scope.capabilities.includes(capability)) {
      throw new Error("Private session is missing required capability.");
    }
    const account = this.getAccount(payload.accountId);
    const state = await this.loadState();
    const storedSession = state.sessions.find((entry) => entry.sessionId === payload.sessionId && entry.token === token);
    if (!storedSession || storedSession.expiresAt <= Date.now()) {
      throw new Error("Private session was revoked or expired.");
    }
    if (profileId) {
      this.assertProfile(account, profileId);
    }
    return {
      ...payload,
      account,
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
    const totalUsedBytes = state.privateDownloads.reduce((sum, entry) => sum + entry.sizeBytes, 0);
    const quotaBytes = privateConfig
      ? privateConfig.accounts.reduce((sum, account) => sum + this.getAccountQuotaBytes(account), 0)
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
    const config = this.requirePrivateConfig();
    return config.accounts.map((account) => ({
      ...this.toPublicAccount(account),
      profiles: account.profiles,
    }));
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

  async getPrivateMe(token: string | undefined) {
    const session = await this.validatePrivateSession(token, "library");
    return {
      session: {
        sessionId: session.sessionId,
        accountId: session.accountId,
        profileId: session.profileId ?? null,
        role: session.role,
        expiresAt: session.expiresAt,
        scope: session.scope,
      },
      account: this.toPublicAccount(session.account),
      profiles: session.account.profiles,
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
    if (!verifySetupSecret(input.setupSecret, config.privateNode.setupSecretHash)) {
      throw new Error("Invalid setup secret.");
    }
    const account = this.getAccount(input.accountId);
    const state = await this.loadState();
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
    return session.account.profiles;
  }

  async selectPrivateProfile(token: string | undefined, profileId: string) {
    const session = await this.validatePrivateSession(token, "library", profileId);
    return await this.createPrivateSession({
      accountId: session.accountId,
      profileId,
      capabilities: session.scope.capabilities,
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
    const quotaBytes = this.getAccountQuotaBytes(session.account);
    const accountDownloads = state.privateDownloads.filter((entry) => entry.accountId === session.accountId);
    const usedBytes = accountDownloads.reduce((sum, entry) => sum + entry.sizeBytes, 0);
    return {
      accountId: session.accountId,
      quotaBytes,
      usedBytes,
      availableBytes: Math.max(0, quotaBytes - usedBytes),
      profiles: session.account.profiles.map((profile) => ({
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
