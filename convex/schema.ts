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
    updatedAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_content_id", ["contentId"])
    .index("by_node_id", ["nodeId"])
    .index("by_content_id_and_node_id", ["contentId", "nodeId"])
    .index("by_expires_at", ["expiresAt"]),
});
