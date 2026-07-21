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
});
