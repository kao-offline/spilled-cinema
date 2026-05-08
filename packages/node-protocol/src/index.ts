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

export type NodeCapability = (typeof NODE_CAPABILITIES)[number];
export type NodeVisibility = (typeof NODE_VISIBILITY)[number];

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
};
