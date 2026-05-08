import { homedir } from "node:os";
import { resolve } from "node:path";
import { MemoryDiscoveryRegistry, MdnsService, verifyNodeRecord } from "../../../packages/discovery/src";
import { NODE_CAPABILITIES, NODE_PROTOCOL_VERSION, type AnonymousSessionGrant, type CapabilityPolicy, type NodeCapability, type NodeCapabilityMap, type NodeRecord, type PairingApproval, type PairingRequest, type PrivateSessionGrant, type SessionScope, type SpillshareSource } from "../../../packages/node-protocol/src";
import { approvePairing, createPairingRequest, createPasskeyAuthenticationChallenge, createPasskeyRegistrationChallenge, generateNodeIdentity, issueAnonymousSession, issuePrivateSession, signPayload, type NodeIdentity } from "../../../packages/security/src";
import { JsonNodeStorage, type NodeStateFile, type StoredImportedShow } from "../../../packages/storage/src";

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
};

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
      regionHint: identity.regionHint ?? this.options.regionHint,
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

  async getStatus() {
    const record = await this.announce();
    const state = await this.loadState();
    return {
      status: "ok",
      node: {
        nodeId: record.nodeId,
        protocolVersion: record.protocolVersion,
        regionHint: record.regionHint ?? null,
        capabilities: record.capabilities,
      },
      discovery: {
        mdns: this.mdns.discover().length,
        knownNodes: this.discovery.list().length,
        publishedSpillshare: state.spillshareSources.length,
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
}
