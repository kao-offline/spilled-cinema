export const LEGACY_NODE_PROTOCOL_VERSION = 1 as const;
export const NODE_PROTOCOL_VERSION = 2 as const;

export const NODE_CAPABILITIES = [
  "fetch",
  "relay",
  "library",
  "spillshare",
  "stream",
  "download",
] as const;

export const NODE_VISIBILITY = ["public", "paired", "private"] as const;
export const NODE_MODES = ["local", "public-fetch", "private", "full"] as const;

export type NodeCapability = (typeof NODE_CAPABILITIES)[number];
export type NodeVisibility = (typeof NODE_VISIBILITY)[number];
export type NodeMode = (typeof NODE_MODES)[number];

const NODE_CONNECTION_CODE_HEX_LENGTH = 16;

/** A connection code is an opaque locator, never an authentication factor. */
export function formatNodeConnectionCode(hexDigest: string) {
  const prefix = hexDigest.trim().slice(0, NODE_CONNECTION_CODE_HEX_LENGTH);
  if (!/^[a-f0-9]{16}$/i.test(prefix)) {
    throw new Error("Connection-code digest is invalid.");
  }
  return prefix.toUpperCase().match(/.{1,4}/g)!.join("-");
}

export function normalizeNodeConnectionCode(value: string) {
  const compact = value.trim().toUpperCase().replace(/^SPILL(?:ED)?/, "").replace(/[^A-F0-9]/g, "");
  if (compact.length !== NODE_CONNECTION_CODE_HEX_LENGTH) return null;
  return compact.match(/.{1,4}/g)!.join("-");
}

export const V2_CAPABILITIES = [
  "provider.search",
  "provider.feed",
  "provider.import",
  "player.resolve",
  "download.transient",
  "download.private",
  "spillshare.read",
  "spillshare.publish",
  "relay.stream",
  "library.read",
  "library.write",
  "node.admin",
] as const;

export type Capability = (typeof V2_CAPABILITIES)[number];

export type Principal =
  | { kind: "local-install"; installId: string }
  | { kind: "owner"; accountId: string; sessionId: string }
  | { kind: "watcher"; accountId: string; profileId: string; sessionId: string }
  | { kind: "public"; ticketId: string; ephemeralKey: string }
  | { kind: "gateway-verifier"; attestationId: string };

export type ResourceLimits = {
  maxRequestBytes: number;
  maxResponseBytes: number;
  maxDurationMs: number;
  maxConcurrentJobs: number;
  maxTemporaryBytes: number;
};

export type PolicyDenialReason =
  | "authentication-required"
  | "capability-disabled"
  | "capability-mismatch"
  | "principal-not-allowed"
  | "resource-unavailable"
  | "ticket-expired"
  | "replay-detected";

export type PolicyDecision =
  | { allow: true; limits: ResourceLimits; auditClass: string }
  | { allow: false; reason: PolicyDenialReason };

export type CapabilityTicketV2 = {
  version: 2;
  ticketId: string;
  nodeId: string;
  principalKind: "public" | "private" | "verifier";
  capability: Capability;
  action: string;
  contentId?: string;
  maxRequestBytes: number;
  maxResponseBytes: number;
  maxDurationMs: number;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  keyId: string;
  signature: string;
};

export type EncryptedRequestEnvelopeV2 = {
  version: 2;
  requestId: string;
  ticketId: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  clientEphemeralKey: string;
  acceptEncoding?: "gzip";
  ciphertext: string;
  authenticationTag: string;
};

export type EncryptedResponseEnvelopeV2 = {
  version: 2;
  requestId: string;
  ticketId: string;
  issuedAt: number;
  nonce: string;
  contentEncoding?: "gzip";
  ciphertext: string;
  authenticationTag: string;
};

export type NodeVerificationStatus =
  | "pending"
  | "verified"
  | "degraded"
  | "quarantined"
  | "disabled"
  | "legacy-unverified";

export type PublicJobState =
  | "queued"
  | "resolving"
  | "downloading"
  | "ready"
  | "streaming"
  | "completed"
  | "canceling"
  | "canceled"
  | "failed"
  | "expired";

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

export type ContentManifestV2 = {
  version: 2;
  manifestId: string;
  contentId: string;
  sourceNodeId: string;
  mimeType: string;
  size: number;
  sha256: string;
  chunks: ChunkDescriptor[];
  createdAt: number;
  expiresAt: number;
  signature: string;
};

export type SpillShareAvailabilityV2 = {
  contentId: string;
  nodeId: string;
  renditionClass: string;
  verifiedAt: number;
  expiresAt: number;
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
    connectionCode: string;
    mode: NodeMode;
    protocolVersion: number;
    regionHint: string | null;
    endpointUrl: string | null;
    capabilities: NodeCapabilityMap;
  };
  auth: {
    privateAuthEnabled: boolean;
    passkeysEnabled: boolean;
    setupRequired?: boolean;
    setupReason?: "missing-config" | "missing-admin" | "missing-admin-login" | "complete";
    adminPasswordEnabled?: boolean;
    watcherPasswordEnabled?: boolean;
    enrolledPasskeyCount?: number;
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
