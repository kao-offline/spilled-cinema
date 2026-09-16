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

const verificationStatusValidator = v.union(
  v.literal("pending"),
  v.literal("verified"),
  v.literal("degraded"),
  v.literal("quarantined"),
  v.literal("disabled"),
  v.literal("legacy-unverified"),
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
  return node.verificationStatus === "verified" && policy.visibility === "public";
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
    verificationStatus: "pending",
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

export const setNodeVerificationStatus = internalMutation({
  args: {
    nodeId: v.string(),
    status: verificationStatusValidator,
  },
  handler: async (ctx, args) => {
    const node = await ctx.db
      .query("nodes")
      .withIndex("by_node_id", (q) => q.eq("nodeId", args.nodeId))
      .unique();
    if (!node) {
      throw new Error("Node not found.");
    }
    const now = Date.now();
    await ctx.db.patch(node._id, {
      verificationStatus: args.status,
      verifiedAt: args.status === "verified" ? now : node.verifiedAt,
      quarantinedAt: args.status === "quarantined" ? now : node.quarantinedAt,
      updatedAt: now,
    });
    return { ok: true, nodeId: args.nodeId, status: args.status };
  },
});

export const getVerifiedNodeForTicket = internalQuery({
  args: {
    nodeId: v.string(),
    capability: capabilityValidator,
  },
  handler: async (ctx, args) => {
    const node = await ctx.db
      .query("nodes")
      .withIndex("by_node_id", (q) => q.eq("nodeId", args.nodeId))
      .unique();
    if (!node || !supportsPublicCapability(node, args.capability)) {
      return null;
    }
    const heartbeat = await ctx.db
      .query("nodeHeartbeats")
      .withIndex("by_node_id", (q) => q.eq("nodeId", args.nodeId))
      .unique();
    return heartbeat && heartbeat.expiresAt > Date.now()
      ? { nodeId: node.nodeId, protocolVersion: node.protocolVersion }
      : null;
  },
});

export const recordCapabilityTicket = internalMutation({
  args: {
    ticketId: v.string(),
    nodeId: v.string(),
    principalKind: v.string(),
    capability: v.string(),
    action: v.string(),
    issuedAt: v.number(),
    expiresAt: v.number(),
    outcome: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("capabilityTicketAudit", args);
  },
});

export const publishVerifiedSpillshareAvailability = internalMutation({
  args: {
    contentId: v.string(),
    nodeId: v.string(),
    renditionClass: v.string(),
    verifiedAt: v.number(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("spillshareAvailabilityV2")
      .withIndex("by_content_id_and_node_id", (q) => q.eq("contentId", args.contentId).eq("nodeId", args.nodeId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("spillshareAvailabilityV2", args);
  },
});

export const listVerifiedSpillshareAvailability = internalQuery({
  args: {
    contentId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("spillshareAvailabilityV2")
      .withIndex("by_content_id", (q) => q.eq("contentId", args.contentId))
      .take(Math.min(args.limit ?? 20, 100));
    return rows
      .filter((row) => row.expiresAt > Date.now())
      .map(({ contentId, nodeId, renditionClass, verifiedAt, expiresAt }) => ({
        contentId,
        nodeId,
        renditionClass,
        verifiedAt,
        expiresAt,
      }));
  },
});

export const enrollV2Node = internalMutation({
  args: {
    nodeId: v.string(),
    ed25519PublicKey: v.string(),
    x25519PublicKey: v.string(),
    transportKeySignature: v.string(),
    installIdHash: v.string(),
    protocolVersion: v.number(),
    keyVersion: v.number(),
    enrollmentCredentialHash: v.string(),
    advertisedCapabilities: v.array(v.string()),
    endpointUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const identity = await ctx.db
      .query("nodeIdentities")
      .withIndex("by_node_id", (q) => q.eq("nodeId", args.nodeId))
      .unique();
    const identityPayload = {
      nodeId: args.nodeId,
      ed25519PublicKey: args.ed25519PublicKey,
      x25519PublicKey: args.x25519PublicKey,
      transportKeySignature: args.transportKeySignature,
      installIdHash: args.installIdHash,
      protocolVersion: args.protocolVersion,
      keyVersion: args.keyVersion,
      updatedAt: now,
    };
    if (identity) {
      await ctx.db.patch(identity._id, identityPayload);
    } else {
      await ctx.db.insert("nodeIdentities", { ...identityPayload, createdAt: now });
    }
    const registration = await ctx.db
      .query("nodeRegistrations")
      .withIndex("by_node_id", (q) => q.eq("nodeId", args.nodeId))
      .unique();
    if (registration) {
      await ctx.db.patch(registration._id, {
        enrollmentCredentialHash: args.enrollmentCredentialHash,
        advertisedCapabilities: args.advertisedCapabilities,
        endpointUrl: args.endpointUrl,
        status: registration.status === "verified" ? "verified" : "pending",
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("nodeRegistrations", {
        nodeId: args.nodeId,
        status: "pending",
        enrollmentCredentialHash: args.enrollmentCredentialHash,
        advertisedCapabilities: args.advertisedCapabilities,
        endpointUrl: args.endpointUrl,
        registeredAt: now,
        updatedAt: now,
      });
    }
    return { ok: true, nodeId: args.nodeId, status: registration?.status ?? "pending" };
  },
});

export const listV2VerificationCandidates = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query("nodeRegistrations")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(Math.min(Math.max(Math.floor(args.limit), 1), 50));
    const remaining = Math.max(0, Math.min(Math.floor(args.limit), 50) - pending.length);
    const degraded = remaining
      ? await ctx.db
          .query("nodeRegistrations")
          .withIndex("by_status", (q) => q.eq("status", "degraded"))
          .take(remaining)
      : [];
    const verifiedRemaining = Math.max(0, remaining - degraded.length);
    const verified = verifiedRemaining
      ? await ctx.db
          .query("nodeRegistrations")
          .withIndex("by_status", (q) => q.eq("status", "verified"))
          .take(verifiedRemaining)
      : [];
    // Verified nodes must remain eligible for periodic capability probes. A
    // node can be globally verified while one advertised capability is stale
    // or degraded; excluding it here made that capability impossible to
    // recover without manually changing the whole node status.
    const registrations = pending.concat(degraded, verified);
    const candidates: Array<{
      nodeId: string;
      advertisedCapabilities: string[];
      identity: Doc<"nodeIdentities">;
      online: boolean;
    }> = [];
    for (const registration of registrations) {
      const identity = await ctx.db
        .query("nodeIdentities")
        .withIndex("by_node_id", (q) => q.eq("nodeId", registration.nodeId))
        .unique();
      const heartbeat = await ctx.db
        .query("nodeHeartbeatsV2")
        .withIndex("by_node_id", (q) => q.eq("nodeId", registration.nodeId))
        .unique();
      if (identity) {
        candidates.push({
          nodeId: registration.nodeId,
          advertisedCapabilities: registration.advertisedCapabilities ?? [],
          identity,
          online: Boolean(heartbeat && heartbeat.expiresAt > Date.now()),
        });
      }
    }
    return candidates;
  },
});

export const verifyGatewayNodeCredential = internalQuery({
  args: {
    nodeId: v.string(),
    enrollmentCredentialHash: v.string(),
  },
  handler: async (ctx, args) => {
    const registration = await ctx.db
      .query("nodeRegistrations")
      .withIndex("by_node_id", (q) => q.eq("nodeId", args.nodeId))
      .unique();
    if (!registration || registration.status === "disabled" || registration.status === "quarantined") {
      return false;
    }
    const revocation = await ctx.db
      .query("nodeRevocations")
      .withIndex("by_node_id", (q) => q.eq("nodeId", args.nodeId))
      .first();
    return !revocation && registration.enrollmentCredentialHash === args.enrollmentCredentialHash;
  },
});

export const verifyGatewayTicket = internalQuery({
  args: {
    ticketId: v.string(),
    nodeId: v.string(),
    capability: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const audit = await ctx.db
      .query("capabilityTicketAudit")
      .withIndex("by_ticket_id", (q) => q.eq("ticketId", args.ticketId))
      .unique();
    return Boolean(
      audit &&
      audit.nodeId === args.nodeId &&
      audit.capability === args.capability &&
      audit.expiresAt === args.expiresAt &&
      audit.expiresAt > Date.now() &&
      audit.outcome === "issued",
    );
  },
});

export const allowCapabilityTicketIssue = internalQuery({
  args: {
    nodeId: v.string(),
    windowMs: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const recent = await ctx.db
      .query("capabilityTicketAudit")
      .withIndex("by_node_id", (q) => q.eq("nodeId", args.nodeId))
      .order("desc")
      .take(Math.min(Math.max(Math.floor(args.limit), 1), 200));
    const cutoff = Date.now() - Math.min(Math.max(args.windowMs, 1_000), 60 * 60_000);
    return recent.filter((entry) => entry.issuedAt >= cutoff).length < args.limit;
  },
});

export const recordGatewayHeartbeatV2 = internalMutation({
  args: {
    nodeId: v.string(),
    protocolVersion: v.number(),
    capacityClass: v.string(),
    ttlMs: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("nodeHeartbeatsV2")
      .withIndex("by_node_id", (q) => q.eq("nodeId", args.nodeId))
      .unique();
    const payload = {
      nodeId: args.nodeId,
      gatewayAttestedAt: now,
      expiresAt: now + Math.min(Math.max(args.ttlMs, 30_000), 300_000),
      capacityClass: args.capacityClass,
      protocolVersion: args.protocolVersion,
    };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }
    return await ctx.db.insert("nodeHeartbeatsV2", payload);
  },
});

export const setV2NodeVerification = internalMutation({
  args: {
    nodeId: v.string(),
    status: verificationStatusValidator,
    capabilities: v.array(v.object({
      capability: v.string(),
      status: verificationStatusValidator,
    })),
  },
  handler: async (ctx, args) => {
    const registration = await ctx.db
      .query("nodeRegistrations")
      .withIndex("by_node_id", (q) => q.eq("nodeId", args.nodeId))
      .unique();
    if (!registration) throw new Error("V2 node registration not found.");
    const now = Date.now();
    await ctx.db.patch(registration._id, { status: args.status, updatedAt: now });
    for (const capability of args.capabilities) {
      const existing = await ctx.db
        .query("nodeCapabilityHealth")
        .withIndex("by_node_and_capability", (q) => q.eq("nodeId", args.nodeId).eq("capability", capability.capability))
        .unique();
      const payload = {
        nodeId: args.nodeId,
        capability: capability.capability,
        status: capability.status,
        successCount: existing?.successCount ?? 0,
        failureCount: existing?.failureCount ?? 0,
        lastVerifiedAt: capability.status === "verified" ? now : existing?.lastVerifiedAt,
        updatedAt: now,
      };
      if (existing) await ctx.db.patch(existing._id, payload);
      else await ctx.db.insert("nodeCapabilityHealth", payload);
    }
    return { ok: true, nodeId: args.nodeId, status: args.status };
  },
});

export const getVerifiedV2NodeForTicket = internalQuery({
  args: {
    nodeId: v.string(),
    capability: v.string(),
  },
  handler: async (ctx, args) => {
    const registration = await ctx.db
      .query("nodeRegistrations")
      .withIndex("by_node_id", (q) => q.eq("nodeId", args.nodeId))
      .unique();
    if (registration?.status !== "verified") return null;
    const capability = await ctx.db
      .query("nodeCapabilityHealth")
      .withIndex("by_node_and_capability", (q) => q.eq("nodeId", args.nodeId).eq("capability", args.capability))
      .unique();
    if (capability?.status !== "verified") return null;
    const heartbeat = await ctx.db
      .query("nodeHeartbeatsV2")
      .withIndex("by_node_id", (q) => q.eq("nodeId", args.nodeId))
      .unique();
    return heartbeat && heartbeat.expiresAt > Date.now()
      ? { nodeId: args.nodeId, protocolVersion: heartbeat.protocolVersion }
      : null;
  },
});

export const listVerifiedV2Nodes = internalQuery({
  args: {
    capability: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(Math.floor(args.limit), 1), 50);
    const healthRows = await ctx.db
      .query("nodeCapabilityHealth")
      .withIndex("by_capability_and_status", (q) =>
        q.eq("capability", args.capability).eq("status", "verified"))
      .order("desc")
      .take(limit * 3);
    const candidates: Array<{
      nodeId: string;
      region?: string;
      endpointUrl?: string;
      capacityClass: string;
      protocolVersion: number;
      identity: {
        ed25519PublicKey: string;
        x25519PublicKey: string;
        transportKeySignature: string;
        keyVersion: number;
        protocolVersion: number;
      };
    }> = [];
    for (const health of healthRows) {
      if (candidates.length >= limit) break;
      const registration = await ctx.db
        .query("nodeRegistrations")
        .withIndex("by_node_id", (q) => q.eq("nodeId", health.nodeId))
        .unique();
      if (registration?.status !== "verified") continue;
      const heartbeat = await ctx.db
        .query("nodeHeartbeatsV2")
        .withIndex("by_node_id", (q) => q.eq("nodeId", health.nodeId))
        .unique();
      if (!heartbeat || heartbeat.expiresAt <= Date.now()) continue;
      const identity = await ctx.db
        .query("nodeIdentities")
        .withIndex("by_node_id", (q) => q.eq("nodeId", health.nodeId))
        .unique();
      if (!identity) continue;
      candidates.push({
        nodeId: health.nodeId,
        ...((registration.region ?? heartbeat.region)
          ? { region: registration.region ?? heartbeat.region }
          : {}),
        ...(registration.endpointUrl
          ? { endpointUrl: registration.endpointUrl }
          : {}),
        capacityClass: heartbeat.capacityClass,
        protocolVersion: heartbeat.protocolVersion,
        identity: {
          ed25519PublicKey: identity.ed25519PublicKey,
          x25519PublicKey: identity.x25519PublicKey,
          transportKeySignature: identity.transportKeySignature,
          keyVersion: identity.keyVersion,
          protocolVersion: identity.protocolVersion,
        },
      });
    }
    return candidates;
  },
});

export const getReachablePrivateV2Node = internalQuery({
  args: { nodeId: v.string() },
  handler: async (ctx, args) => {
    const registration = await ctx.db
      .query("nodeRegistrations")
      .withIndex("by_node_id", (q) => q.eq("nodeId", args.nodeId))
      .unique();
    if (!registration || ["disabled", "quarantined"].includes(registration.status)) return null;
    const heartbeat = await ctx.db
      .query("nodeHeartbeatsV2")
      .withIndex("by_node_id", (q) => q.eq("nodeId", args.nodeId))
      .unique();
    return heartbeat && heartbeat.expiresAt > Date.now() ? { nodeId: args.nodeId } : null;
  },
});

/** Resolve a human-friendly private-node name without exposing any credentials. */
export const resolvePrivateV2NodeNetworkName = internalQuery({
  args: { networkName: v.string() },
  handler: async (ctx, args) => {
    const claim = await ctx.db
      .query("nodeNetworkNames")
      .withIndex("by_network_name", (q) => q.eq("networkName", args.networkName))
      .unique();
    if (!claim) return null;
    const registration = await ctx.db
      .query("nodeRegistrations")
      .withIndex("by_node_id", (q) => q.eq("nodeId", claim.nodeId))
      .unique();
    if (!registration || ["disabled", "quarantined"].includes(registration.status) || !registration.connectionCode) return null;
    const [heartbeat, identity] = await Promise.all([
      ctx.db.query("nodeHeartbeatsV2").withIndex("by_node_id", (q) => q.eq("nodeId", registration.nodeId)).unique(),
      ctx.db.query("nodeIdentities").withIndex("by_node_id", (q) => q.eq("nodeId", registration.nodeId)).unique(),
    ]);
    if (!identity) return null;
    return {
      nodeId: registration.nodeId,
      connectionCode: registration.connectionCode,
      networkName: claim.networkName,
      online: Boolean(heartbeat && heartbeat.expiresAt > Date.now()),
      identity: { x25519PublicKey: identity.x25519PublicKey },
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
