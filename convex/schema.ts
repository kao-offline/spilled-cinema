import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const capabilityPolicyValidator = v.object({
  visibility: v.union(v.literal("public"), v.literal("paired"), v.literal("private")),
  requiresSession: v.boolean(),
});

const nodeCapabilitiesValidator = v.object({
  fetch: capabilityPolicyValidator,
  relay: capabilityPolicyValidator,
  library: capabilityPolicyValidator,
  spillshare: capabilityPolicyValidator,
  stream: capabilityPolicyValidator,
  download: capabilityPolicyValidator,
});

const nodeEndpointValidator = v.object({
  protocol: v.union(v.literal("https"), v.literal("http"), v.literal("noise"), v.literal("local")),
  url: v.string(),
});

const nodeLoadValidator = v.object({
  activeSessions: v.number(),
  activeDownloads: v.number(),
  spillshareItems: v.number(),
  relayPercent: v.number(),
});

const providerFeedKindValidator = v.union(
  v.literal("new-episodes"),
  v.literal("new-additions"),
  v.literal("popular"),
  v.literal("latest-episodes"),
  v.literal("custom"),
);

const providerFeedValidator = v.object({
  feedId: v.string(),
  title: v.string(),
  description: v.string(),
  kind: providerFeedKindValidator,
  defaultEnabled: v.boolean(),
  pageTitle: v.string(),
  supportsSearch: v.boolean(),
  supportsOpenSource: v.boolean(),
  supportsImport: v.boolean(),
  sortMode: v.literal("newest"),
  itemGranularity: v.union(v.literal("episode"), v.literal("show"), v.literal("movie")),
});

const providerCapabilitiesValidator = v.object({
  import: v.boolean(),
  player: v.boolean(),
  search: v.boolean(),
  download: v.boolean(),
  feeds: v.array(providerFeedValidator),
});

const providerRuntimeValidator = v.object({
  entry: v.string(),
});

const integrationSecretStatusValidator = v.union(
  v.literal("active"),
  v.literal("disabled"),
  v.literal("testing"),
);

const nodeVerificationStatusValidator = v.union(
  v.literal("pending"),
  v.literal("verified"),
  v.literal("degraded"),
  v.literal("quarantined"),
  v.literal("disabled"),
  v.literal("legacy-unverified"),
);

export default defineSchema({
  nodes: defineTable({
    nodeId: v.string(),
    publicKey: v.string(),
    protocolVersion: v.number(),
    endpoints: v.array(nodeEndpointValidator),
    capabilities: nodeCapabilitiesValidator,
    regionHint: v.optional(v.string()),
    load: v.optional(nodeLoadValidator),
    publishedAt: v.number(),
    ttlMs: v.number(),
    signature: v.string(),
    verificationStatus: v.optional(nodeVerificationStatusValidator),
    verifiedAt: v.optional(v.number()),
    quarantinedAt: v.optional(v.number()),
    registeredAt: v.number(),
    updatedAt: v.number(),
  }).index("by_node_id", ["nodeId"]),
  nodeHeartbeats: defineTable({
    nodeId: v.string(),
    lastSeenAt: v.number(),
    expiresAt: v.number(),
    load: v.optional(nodeLoadValidator),
    regionHint: v.optional(v.string()),
    lastRegistrationAt: v.optional(v.number()),
  })
    .index("by_node_id", ["nodeId"])
    .index("by_expires_at", ["expiresAt"]),
  spillshareSources: defineTable({
    contentId: v.string(),
    nodeId: v.string(),
    fileName: v.string(),
    manifestId: v.string(),
    size: v.number(),
    mimeType: v.string(),
    sha256: v.optional(v.string()),
    updatedAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_content_id", ["contentId"])
    .index("by_node_id", ["nodeId"])
    .index("by_content_id_and_node_id", ["contentId", "nodeId"])
    .index("by_expires_at", ["expiresAt"]),
  providerModules: defineTable({
    moduleId: v.string(),
    providerId: v.string(),
    displayName: v.string(),
    version: v.number(),
    status: v.union(v.literal("active"), v.literal("disabled")),
    runtime: v.optional(providerRuntimeValidator),
    capabilities: providerCapabilitiesValidator,
    publishedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_module_id", ["moduleId"])
    .index("by_status_and_provider_id", ["status", "providerId"]),
  integrationPublicConfigs: defineTable({
    integrationId: v.string(),
    enabled: v.boolean(),
    priority: v.number(),
    defaultLocale: v.optional(v.string()),
    sharedKeyAvailable: v.boolean(),
    updatedAt: v.number(),
  }).index("by_integration_id", ["integrationId"]),
  integrationSecrets: defineTable({
    integrationId: v.string(),
    secretName: v.string(),
    ciphertext: v.string(),
    keyVersion: v.string(),
    status: integrationSecretStatusValidator,
    updatedAt: v.number(),
    updatedBy: v.string(),
  })
    .index("by_integration_id", ["integrationId"])
    .index("by_integration_id_and_secret_name", ["integrationId", "secretName"]),
  integrationSecretAuditEvents: defineTable({
    integrationId: v.string(),
    action: v.string(),
    actor: v.string(),
    createdAt: v.number(),
    success: v.boolean(),
  })
    .index("by_integration_id_and_created_at", ["integrationId", "createdAt"])
    .index("by_actor_and_created_at", ["actor", "createdAt"]),
  integrationUsageBuckets: defineTable({
    integrationId: v.string(),
    bucket: v.string(),
    count: v.number(),
    resetAt: v.number(),
  }).index("by_integration_id_and_bucket", ["integrationId", "bucket"]),
  nodeIdentities: defineTable({
    nodeId: v.string(),
    ed25519PublicKey: v.string(),
    x25519PublicKey: v.string(),
    transportKeySignature: v.string(),
    installIdHash: v.string(),
    protocolVersion: v.number(),
    keyVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_node_id", ["nodeId"]),
  nodeRegistrations: defineTable({
    nodeId: v.string(),
    connectionCode: v.optional(v.string()),
    status: nodeVerificationStatusValidator,
    enrollmentCredentialHash: v.optional(v.string()),
    advertisedCapabilities: v.optional(v.array(v.string())),
    endpointUrl: v.optional(v.string()),
    gatewayConnectionId: v.optional(v.string()),
    region: v.optional(v.string()),
    registeredAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_node_id", ["nodeId"])
    .index("by_connection_code", ["connectionCode"])
    .index("by_status", ["status"]),
  nodeHeartbeatsV2: defineTable({
    nodeId: v.string(),
    gatewayAttestedAt: v.number(),
    expiresAt: v.number(),
    capacityClass: v.string(),
    region: v.optional(v.string()),
    protocolVersion: v.number(),
  })
    .index("by_node_id", ["nodeId"])
    .index("by_expires_at", ["expiresAt"]),
  nodeCapabilityHealth: defineTable({
    nodeId: v.string(),
    capability: v.string(),
    status: nodeVerificationStatusValidator,
    successCount: v.number(),
    failureCount: v.number(),
    medianLatencyMs: v.optional(v.number()),
    p95LatencyMs: v.optional(v.number()),
    lastVerifiedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_node_and_capability", ["nodeId", "capability"])
    .index("by_capability_and_status", ["capability", "status"]),
  nodeAttestations: defineTable({
    attestationId: v.string(),
    nodeId: v.string(),
    kind: v.string(),
    challengeHash: v.string(),
    gatewaySignature: v.string(),
    status: v.union(v.literal("pending"), v.literal("passed"), v.literal("failed")),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_attestation_id", ["attestationId"])
    .index("by_node_id", ["nodeId"]),
  nodeRevocations: defineTable({
    nodeId: v.string(),
    keyVersion: v.optional(v.number()),
    reason: v.string(),
    revokedAt: v.number(),
    revokedBy: v.string(),
  }).index("by_node_id", ["nodeId"]),
  spillshareAvailabilityV2: defineTable({
    contentId: v.string(),
    nodeId: v.string(),
    renditionClass: v.string(),
    verifiedAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_content_id", ["contentId"])
    .index("by_content_id_and_node_id", ["contentId", "nodeId"])
    .index("by_node_id", ["nodeId"])
    .index("by_expires_at", ["expiresAt"]),
  capabilityTicketAudit: defineTable({
    ticketId: v.string(),
    nodeId: v.string(),
    principalKind: v.string(),
    capability: v.string(),
    action: v.string(),
    issuedAt: v.number(),
    expiresAt: v.number(),
    outcome: v.string(),
  })
    .index("by_ticket_id", ["ticketId"])
    .index("by_node_id", ["nodeId"])
    .index("by_node_id_and_issued_at", ["nodeId", "issuedAt"])
    .index("by_expires_at", ["expiresAt"]),
  providerReleases: defineTable({
    providerId: v.string(),
    version: v.string(),
    artifactSha256: v.string(),
    artifactUrl: v.string(),
    publisherKeyId: v.string(),
    signature: v.string(),
    status: v.union(v.literal("active"), v.literal("revoked"), v.literal("disabled")),
    publishedAt: v.number(),
  })
    .index("by_provider_id", ["providerId"])
    .index("by_provider_and_version", ["providerId", "version"]),
  operatorSecurityEvents: defineTable({
    actorTokenIdentifier: v.string(),
    action: v.string(),
    target: v.optional(v.string()),
    success: v.boolean(),
    createdAt: v.number(),
    details: v.optional(v.string()),
  })
    .index("by_actor", ["actorTokenIdentifier"])
    .index("by_created_at", ["createdAt"]),
  operatorRoles: defineTable({
    tokenIdentifier: v.string(),
    role: v.union(v.literal("operator"), v.literal("security-admin")),
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_token_identifier", ["tokenIdentifier"]),
});
