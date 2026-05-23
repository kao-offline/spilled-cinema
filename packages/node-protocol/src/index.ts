export const NODE_PROTOCOL_VERSION = 1 as const;

export const NODE_CAPABILITIES = [
  "fetch",
  "relay",
  "library",
  "spillshare",
  "stream",
  "download",
] as const;

export const NODE_VISIBILITY = ["public", "paired", "private"] as const;
export const NODE_MODES = ["public-fetch", "private", "full"] as const;

export type NodeCapability = (typeof NODE_CAPABILITIES)[number];
export type NodeVisibility = (typeof NODE_VISIBILITY)[number];
export type NodeMode = (typeof NODE_MODES)[number];

export type CapabilityPolicy = {
  visibility: NodeVisibility;
  requiresSession: boolean;
};

export type NodeCapabilityMap = Record<NodeCapability, CapabilityPolicy>;

export type NodeLoadSnapshot = {
  activeSessions: number;
  activeDownloads: number;
  spillshareItems: number;
  relayPercent: number;
};

export type NodeEndpoint = {
  protocol: "https" | "http" | "noise" | "local";
  url: string;
};

export type NodeRecord = {
  nodeId: string;
  publicKey: string;
  protocolVersion: number;
  endpoints: NodeEndpoint[];
  capabilities: NodeCapabilityMap;
  regionHint?: string;
  load?: NodeLoadSnapshot;
  publishedAt: number;
  ttlMs: number;
  signature: string;
};

export type SessionScope = {
  capability: NodeCapability;
  contentId?: string;
  action?: string;
};

export type AnonymousSessionGrant = {
  kind: "anonymous";
  sessionId: string;
  token: string;
  expiresAt: number;
  scope: SessionScope;
  nodeId: string;
};

export type PrivateSessionGrant = {
  kind: "private";
  sessionId: string;
  token: string;
  expiresAt: number;
  pairedDeviceId: string;
  scope: SessionScope;
  nodeId: string;
};

export type PairingRequest = {
  pairingId: string;
  deviceName: string;
  requestedAt: number;
  expiresAt: number;
  code: string;
};

export type PairingApproval = {
  pairingId: string;
  pairedDeviceId: string;
  approvedAt: number;
  token: string;
};

export type ChunkDescriptor = {
  index: number;
  offset: number;
  size: number;
  sha256: string;
};

export type ContentManifest = {
  manifestId: string;
  contentId: string;
  fileName: string;
  mimeType: string;
  size: number;
  sha256: string;
  chunks: ChunkDescriptor[];
  sourceNodeId: string;
  createdAt: number;
  signature: string;
};

export type DiscoveryQuery = {
  capability: NodeCapability;
  contentId?: string;
  regionHint?: string;
  limit?: number;
};

export type DiscoveryCandidate = {
  record: NodeRecord;
  latencyMs?: number;
  successRate?: number;
  score?: number;
};

export type DiscoveryResult = {
  query: DiscoveryQuery;
  candidates: DiscoveryCandidate[];
};

export type SpillshareSource = {
  contentId: string;
  nodeId: string;
  fileName: string;
  manifestId: string;
  size: number;
  mimeType: string;
  sha256?: string;
};

export type PrivateNodeSessionToken = {
  kind: "private";
  sessionId: string;
  nodeId: string;
  accountId: string;
  profileId?: string;
  role: "admin" | "user";
  scope: {
    capabilities: Array<"library" | "download" | "spillshare" | "settings">;
  };
  issuedAt: number;
  expiresAt: number;
};

export type NodeCompatibilityStatus = {
  status: "ok";
  node: {
    nodeId: string;
    mode: NodeMode;
    protocolVersion: number;
    regionHint: string | null;
    endpointUrl: string | null;
    capabilities: NodeCapabilityMap;
  };
  auth: {
    privateAuthEnabled: boolean;
    passkeysEnabled: boolean;
    oidcProviders: Array<{
      providerId: string;
      displayName: string;
    }>;
    pairedDeviceCount: number;
  };
  capabilities: {
    providerSearch: boolean;
    providerImport: boolean;
    providerFeeds: boolean;
    streamResolve: boolean;
    fullDownload: boolean;
    browserDownloadResolve: boolean;
    spillsharePublish: boolean;
    spillshareServe: boolean;
    privateLibrary: boolean;
  };
  mediaTools: {
    ffmpeg: boolean;
    ffprobe: boolean;
    canDownload: boolean;
    canValidate: boolean;
    canRepairSeekableMp4: boolean;
  };
  storage: {
    privateStorageEnabled: boolean;
    rootConfigured: boolean;
    totalUsedBytes: number;
    quotaBytes: number | null;
  };
};
