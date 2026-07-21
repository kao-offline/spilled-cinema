import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";

const http = httpRouter();
const NODE_CAPABILITIES = ["fetch", "relay", "library", "spillshare", "stream", "download"] as const;
type NodeCapability = (typeof NODE_CAPABILITIES)[number];

type NodeRecordCandidate = {
  nodeId: string;
  publicKey: string;
  protocolVersion: number;
  endpoints: unknown;
  capabilities: unknown;
  regionHint?: string;
  load?: unknown;
  publishedAt: number;
  ttlMs: number;
  signature: string;
};

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

function toHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}

function base64ToArrayBuffer(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function base64UrlToArrayBuffer(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return base64ToArrayBuffer(normalized + padding);
}

function pemToDer(pem: string) {
  const body = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  return base64ToArrayBuffer(body);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(",")}}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNodeRecordCandidate(value: unknown): value is NodeRecordCandidate {
  return (
    isRecord(value) &&
    typeof value.nodeId === "string" &&
    typeof value.publicKey === "string" &&
    typeof value.protocolVersion === "number" &&
    typeof value.publishedAt === "number" &&
    typeof value.ttlMs === "number" &&
    typeof value.signature === "string"
  );
}

async function verifyNodeRecordSignature(record: NodeRecordCandidate) {
  const { signature, ...unsigned } = record;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(record.publicKey));
  const expectedNodeId = `node_${toHex(digest).slice(0, 24)}`;
  if (record.nodeId !== expectedNodeId) {
    return false;
  }

  const publicKey = await crypto.subtle.importKey(
    "spki",
    pemToDer(record.publicKey),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  return await crypto.subtle.verify(
    { name: "Ed25519" },
    publicKey,
    base64UrlToArrayBuffer(signature),
    new TextEncoder().encode(stableStringify(unsigned)),
  );
}

async function requireVerifiedNodeRecord(record: unknown) {
  if (!isNodeRecordCandidate(record)) {
    return { ok: false as const, error: "Invalid node record." };
  }
  try {
    if (await verifyNodeRecordSignature(record)) {
      return { ok: true as const, record };
    }
  } catch {
    // Fall through to a consistent auth failure.
  }
  return { ok: false as const, error: "Invalid node record signature." };
}

function parseCapability(value: string | null | undefined, fallback: NodeCapability = "relay") {
  const capability = value || fallback;
  return NODE_CAPABILITIES.includes(capability as NodeCapability) ? (capability as NodeCapability) : null;
}

function clampLimit(value: string | number | null | undefined, fallback: number, max: number) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

async function signControlPlanePayload(payload: unknown) {
  const secret = process.env.SPILLED_CONTROL_PLANE_SECRET || process.env.CONVEX_DEPLOYMENT || "spilled-dev-secret";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return toHex(signature);
}

async function parseJson(req: Request) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function isAuthorizedControlPlaneRequest(req: Request) {
  const configuredSecret = process.env.SPILLED_CONTROL_PLANE_SECRET;
  return !configuredSecret || req.headers.get("x-spilled-control-plane-secret") === configuredSecret;
}

function isAuthorizedConfiguredControlPlaneRequest(req: Request) {
  const configuredSecret = process.env.SPILLED_CONTROL_PLANE_SECRET;
  return Boolean(configuredSecret && req.headers.get("x-spilled-control-plane-secret") === configuredSecret);
}

http.route({
  path: "/server/status",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const status = await ctx.runQuery(internal.controlPlane.getStatus, {});
    return json(status);
  }),
});

http.route({
  path: "/server/node/register",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = (await parseJson(req)) as { record?: unknown; spillshareSources?: unknown[] };
    if (!body.record || !Array.isArray(body.spillshareSources)) {
      return json({ error: "Missing node registration payload." }, { status: 400 });
    }
    const verified = await requireVerifiedNodeRecord(body.record);
    if (!verified.ok) {
      return json({ error: verified.error }, { status: 401 });
    }
    const result = await ctx.runMutation(internal.controlPlane.registerNode, {
      record: verified.record as never,
      spillshareSources: body.spillshareSources as never,
    });
    const envelope = {
      kind: "node-register",
      nodeId: result.nodeId,
      expiresAt: result.expiresAt,
      issuedAt: Date.now(),
    };
    return json({
      ok: true,
      ...envelope,
      signature: await signControlPlanePayload(envelope),
    });
  }),
});

http.route({
  path: "/server/node/heartbeat",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = (await parseJson(req)) as { record?: unknown; spillshareSources?: unknown[] };
    if (!body.record || !Array.isArray(body.spillshareSources)) {
      return json({ error: "Missing node heartbeat payload." }, { status: 400 });
    }
    const verified = await requireVerifiedNodeRecord(body.record);
    if (!verified.ok) {
      return json({ error: verified.error }, { status: 401 });
    }
    const result = await ctx.runMutation(internal.controlPlane.heartbeatNode, {
      record: verified.record as never,
      spillshareSources: body.spillshareSources as never,
    });
    const envelope = {
      kind: "node-heartbeat",
      nodeId: result.nodeId,
      expiresAt: result.expiresAt,
      issuedAt: Date.now(),
    };
    return json({
      ok: true,
      ...envelope,
      signature: await signControlPlanePayload(envelope),
    });
  }),
});

http.route({
  path: "/server/discovery/nodes",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const capability = parseCapability(url.searchParams.get("capability"));
    if (!capability) {
      return json({ error: "Unsupported capability." }, { status: 400 });
    }
    const regionHint = url.searchParams.get("regionHint") || undefined;
    const limit = clampLimit(url.searchParams.get("limit"), 10, 50);
    const candidates = await ctx.runQuery(internal.controlPlane.listActiveNodes, {
      capability,
      regionHint,
      limit,
    });
    return json({ capability, regionHint, candidates });
  }),
});

http.route({
  path: "/server/auth/connection/discovery",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const capability = parseCapability(url.searchParams.get("capability"));
    if (!capability) {
      return json({ error: "Unsupported capability." }, { status: 400 });
    }
    const regionHint = url.searchParams.get("regionHint") || undefined;
    const limit = clampLimit(url.searchParams.get("limit"), 10, 50);
    const candidates = await ctx.runQuery(internal.controlPlane.listActiveNodes, {
      capability,
      regionHint,
      limit,
    });
    const envelope = {
      capability,
      regionHint,
      candidates,
      issuedAt: Date.now(),
    };
    return json({
      ...envelope,
      signature: await signControlPlanePayload(envelope),
    });
  }),
});

http.route({
  path: "/server/discovery/spillshare",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const contentId = url.searchParams.get("contentId");
    if (!contentId) {
      return json({ error: "contentId is required." }, { status: 400 });
    }
    const limit = clampLimit(url.searchParams.get("limit"), 20, 100);
    const sources = await ctx.runQuery(internal.controlPlane.listSpillshareSources, {
      contentId,
      limit,
    });
    return json({ contentId, sources });
  }),
});

http.route({
  path: "/server/relay/select",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = (await parseJson(req)) as {
      capability?: "fetch" | "relay" | "library" | "spillshare" | "stream" | "download";
      contentId?: string;
      regionHint?: string;
      limit?: number;
    };
    const capability = parseCapability(body.capability);
    if (!capability) {
      return json({ error: "Unsupported capability." }, { status: 400 });
    }
    const selection = await ctx.runQuery(internal.controlPlane.selectRelay, {
      capability,
      contentId: body.contentId,
      regionHint: body.regionHint,
      limit: clampLimit(body.limit, 10, 50),
    });
    const envelope = {
      capability,
      contentId: body.contentId ?? null,
      selected: selection.selected,
      issuedAt: Date.now(),
    };
    return json({
      ...selection,
      signature: await signControlPlanePayload(envelope),
    });
  }),
});

http.route({
  path: "/server/auth/verify/getSignature",
  method: "POST",
  handler: httpAction(async (_ctx, req) => {
    const body = (await parseJson(req)) as { payload?: unknown };
    if (body.payload === undefined) {
      return json({ error: "payload is required." }, { status: 400 });
    }
    const envelope = {
      payload: body.payload,
      issuedAt: Date.now(),
    };
    return json({
      ...envelope,
      signature: await signControlPlanePayload(envelope),
    });
  }),
});

http.route({
  path: "/server/provider-modules",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const modules = await ctx.runQuery(api.providerModules.listActiveProviderModules, {});
    return json({ modules });
  }),
});

http.route({
  path: "/server/provider-modules/seed",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!isAuthorizedControlPlaneRequest(req)) {
      return json({ error: "Unauthorized." }, { status: 401 });
    }
    const result = await ctx.runMutation(internal.providerModules.ensureDefaultProviderModules, {});
    return json({ ok: true, ...result });
  }),
});

http.route({
  path: "/server/integrations/shared-artwork-api-keys",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    if (!isAuthorizedConfiguredControlPlaneRequest(req)) {
      return json({ error: "Unauthorized." }, { status: 401 });
    }
    const keys = await ctx.runAction(internal.integrations.internalResolveSharedArtworkApiKeys, {});
    return json({
      keys,
      available: {
        tmdb: Boolean(keys.tmdbApiKey),
        fanart: Boolean(keys.fanartApiKey),
        tvdb: Boolean(keys.tvdbApiKey),
      },
    });
  }),
});

http.route({
  path: "/server/integrations/shared-artwork-api-keys/seed",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!isAuthorizedConfiguredControlPlaneRequest(req)) {
      return json({ error: "Unauthorized." }, { status: 401 });
    }
    const body = (await parseJson(req)) as {
      keys?: {
        tmdbApiKey?: unknown;
        fanartApiKey?: unknown;
        tvdbApiKey?: unknown;
      };
    };
    const result = await ctx.runAction(internal.integrations.internalSeedSharedArtworkApiKeys, {
      keys: {
        tmdbApiKey: typeof body.keys?.tmdbApiKey === "string" ? body.keys.tmdbApiKey : undefined,
        fanartApiKey: typeof body.keys?.fanartApiKey === "string" ? body.keys.fanartApiKey : undefined,
        tvdbApiKey: typeof body.keys?.tvdbApiKey === "string" ? body.keys.tvdbApiKey : undefined,
      },
      updatedBy: "control-plane",
    });
    return json(result);
  }),
});

export default http;
