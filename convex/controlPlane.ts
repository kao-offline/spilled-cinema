import { v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { type Doc } from "./_generated/dataModel";

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

const nodeRecordValidator = v.object({
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
});

const spillshareSourceValidator = v.object({
  contentId: v.string(),
  nodeId: v.string(),
  fileName: v.string(),
  manifestId: v.string(),
  size: v.number(),
  mimeType: v.string(),
  sha256: v.optional(v.string()),
});

const capabilityValidator = v.union(
  v.literal("fetch"),
  v.literal("relay"),
  v.literal("library"),
  v.literal("spillshare"),
  v.literal("stream"),
  v.literal("download"),
);

const relaySelectRequestValidator = {
  capability: capabilityValidator,
  contentId: v.optional(v.string()),
  regionHint: v.optional(v.string()),
  limit: v.optional(v.number()),
};

type NodeRecordInput = {
  nodeId: string;
  publicKey: string;
  protocolVersion: number;
  endpoints: Array<{ protocol: "https" | "http" | "noise" | "local"; url: string }>;
  capabilities: Doc<"nodes">["capabilities"];
  regionHint?: string;
  load?: Doc<"nodes">["load"];
  publishedAt: number;
  ttlMs: number;
  signature: string;
};

type SpillshareInput = {
  contentId: string;
  nodeId: string;
  fileName: string;
  manifestId: string;
  size: number;
  mimeType: string;
  sha256?: string;
};

function supportsPublicCapability(node: Doc<"nodes">, capability: keyof Doc<"nodes">["capabilities"]) {
  const policy = node.capabilities[capability];
  return policy.visibility === "public";
}

function scoreNode(node: Doc<"nodes">, heartbeat: Doc<"nodeHeartbeats">, regionHint?: string) {
  let score = 0;
  if (regionHint && node.regionHint && regionHint.toLowerCase() === node.regionHint.toLowerCase()) {
    score += 30;
  }
  score -= heartbeat.load?.relayPercent ?? node.load?.relayPercent ?? 0;
  score -= (heartbeat.load?.activeDownloads ?? node.load?.activeDownloads ?? 0) * 2;
  score += Math.max(0, 60_000 - (Date.now() - heartbeat.lastSeenAt)) / 1_000;
  return score;
}

async function upsertNodeDocument(ctx: MutationCtx, record: NodeRecordInput, now: number) {
  const existing = await ctx.db
    .query("nodes")
    .withIndex("by_node_id", (q) => q.eq("nodeId", record.nodeId))
    .unique();

  const payload = {
    nodeId: record.nodeId,
    publicKey: record.publicKey,
    protocolVersion: record.protocolVersion,
    endpoints: record.endpoints,
    capabilities: record.capabilities,
    regionHint: record.regionHint,
    load: record.load,
    publishedAt: record.publishedAt,
    ttlMs: record.ttlMs,
    signature: record.signature,
    updatedAt: now,
  };

  if (existing) {
    await ctx.db.patch(existing._id, payload);
    return existing._id;
  }

  return await ctx.db.insert("nodes", {
    ...payload,
    registeredAt: now,
  });
}

async function upsertHeartbeat(ctx: MutationCtx, record: NodeRecordInput, now: number, isRegistration: boolean) {
  const existing = await ctx.db
    .query("nodeHeartbeats")
    .withIndex("by_node_id", (q) => q.eq("nodeId", record.nodeId))
    .unique();

  const payload = {
    nodeId: record.nodeId,
    lastSeenAt: now,
    expiresAt: now + record.ttlMs,
    load: record.load,
    regionHint: record.regionHint,
    ...(isRegistration ? { lastRegistrationAt: now } : {}),
  };

  if (existing) {
    await ctx.db.patch(existing._id, payload);
    return existing._id;
  }

  return await ctx.db.insert("nodeHeartbeats", payload);
}

async function syncSpillshareSources(
  ctx: MutationCtx,
  nodeId: string,
  sources: SpillshareInput[],
  expiresAt: number,
  now: number,
) {
  const existing = await ctx.db
    .query("spillshareSources")
    .withIndex("by_node_id", (q) => q.eq("nodeId", nodeId))
    .collect();

  const nextKeys = new Set(sources.map((source) => `${source.contentId}:${source.nodeId}`));
  for (const row of existing) {
    if (!nextKeys.has(`${row.contentId}:${row.nodeId}`)) {
      await ctx.db.delete(row._id);
    }
  }

  for (const source of sources) {
    const row = await ctx.db
      .query("spillshareSources")
      .withIndex("by_content_id_and_node_id", (q) => q.eq("contentId", source.contentId).eq("nodeId", source.nodeId))
      .unique();

    const payload = {
      contentId: source.contentId,
      nodeId: source.nodeId,
      fileName: source.fileName,
      manifestId: source.manifestId,
      size: source.size,
      mimeType: source.mimeType,
      sha256: source.sha256,
      updatedAt: now,
      expiresAt,
    };

    if (row) {
      await ctx.db.patch(row._id, payload);
    } else {
      await ctx.db.insert("spillshareSources", payload);
    }
  }
}

async function collectActiveNodes(ctx: QueryCtx, args: {
  capability: "fetch" | "relay" | "library" | "spillshare" | "stream" | "download";
  contentId?: string;
  regionHint?: string;
  limit?: number;
}) {
  const now = Date.now();
  const nodes: Array<{
    record: {
      nodeId: string;
      publicKey: string;
      protocolVersion: number;
      endpoints: Array<{ protocol: "https" | "http" | "noise" | "local"; url: string }>;
      capabilities: Doc<"nodes">["capabilities"];
      regionHint?: string;
      load?: Doc<"nodes">["load"];
      publishedAt: number;
      ttlMs: number;
      signature: string;
    };
    score: number;
  }> = [];
  const heartbeats = await ctx.db
    .query("nodeHeartbeats")
    .withIndex("by_expires_at", (q) => q.gt("expiresAt", now))
    .collect();

  for (const heartbeat of heartbeats) {
    const node = await ctx.db
      .query("nodes")
      .withIndex("by_node_id", (q) => q.eq("nodeId", heartbeat.nodeId))
      .unique();
    if (!node || !supportsPublicCapability(node, args.capability)) {
      continue;
    }
    nodes.push({
      record: {
        nodeId: node.nodeId,
        publicKey: node.publicKey,
        protocolVersion: node.protocolVersion,
        endpoints: node.endpoints,
        capabilities: node.capabilities,
        regionHint: node.regionHint,
        load: heartbeat.load ?? node.load,
        publishedAt: node.publishedAt,
        ttlMs: Math.max(0, heartbeat.expiresAt - now),
        signature: node.signature,
      },
      score: scoreNode(node, heartbeat, args.regionHint),
    });
  }

  return nodes.sort((left, right) => right.score - left.score).slice(0, args.limit ?? 10);
}

export const registerNode = internalMutation({
  args: {
    record: nodeRecordValidator,
    spillshareSources: v.array(spillshareSourceValidator),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await upsertNodeDocument(ctx, args.record, now);
    await upsertHeartbeat(ctx, args.record, now, true);
    await syncSpillshareSources(ctx, args.record.nodeId, args.spillshareSources, now + args.record.ttlMs, now);
    return {
      ok: true,
      nodeId: args.record.nodeId,
      expiresAt: now + args.record.ttlMs,
    };
  },
});

export const heartbeatNode = internalMutation({
  args: {
    record: nodeRecordValidator,
    spillshareSources: v.array(spillshareSourceValidator),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await upsertNodeDocument(ctx, args.record, now);
    await upsertHeartbeat(ctx, args.record, now, false);
    await syncSpillshareSources(ctx, args.record.nodeId, args.spillshareSources, now + args.record.ttlMs, now);
    return {
      ok: true,
      nodeId: args.record.nodeId,
      expiresAt: now + args.record.ttlMs,
    };
  },
});

export const listActiveNodes = internalQuery({
  args: relaySelectRequestValidator,
  handler: async (ctx, args) => {
    return await collectActiveNodes(ctx, args);
  },
});

export const listSpillshareSources = internalQuery({
  args: {
    contentId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("spillshareSources")
      .withIndex("by_content_id", (q) => q.eq("contentId", args.contentId))
      .collect();

    return rows
      .filter((row) => row.expiresAt > now)
      .slice(0, args.limit ?? 20)
      .map((row) => ({
        contentId: row.contentId,
        nodeId: row.nodeId,
        fileName: row.fileName,
        manifestId: row.manifestId,
        size: row.size,
        mimeType: row.mimeType,
        sha256: row.sha256,
      }));
  },
});

export const selectRelay = internalQuery({
  args: relaySelectRequestValidator,
  handler: async (ctx, args) => {
    const candidates = await collectActiveNodes(ctx, args);
    return {
      selected: candidates[0] ?? null,
      candidates,
    };
  },
});

export const getStatus = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const [nodes, activeHeartbeats, spillshare] = await Promise.all([
      ctx.db.query("nodes").collect(),
      ctx.db
        .query("nodeHeartbeats")
        .withIndex("by_expires_at", (q) => q.gt("expiresAt", now))
        .collect(),
      ctx.db
        .query("spillshareSources")
        .withIndex("by_expires_at", (q) => q.gt("expiresAt", now))
        .collect(),
    ]);

    return {
      status: "ok",
      totals: {
        nodes: nodes.length,
        activeNodes: activeHeartbeats.length,
        spillshareSources: spillshare.length,
      },
      deployment: process.env.CONVEX_DEPLOYMENT ?? null,
      siteUrl: process.env.CONVEX_SITE_URL ?? null,
    };
  },
});
