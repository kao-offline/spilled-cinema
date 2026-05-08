import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

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
    const result = await ctx.runMutation(internal.controlPlane.registerNode, {
      record: body.record as never,
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
    const result = await ctx.runMutation(internal.controlPlane.heartbeatNode, {
      record: body.record as never,
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
    const capability = (url.searchParams.get("capability") || "relay") as
      | "fetch"
      | "relay"
      | "library"
      | "spillshare"
      | "stream"
      | "download";
    const regionHint = url.searchParams.get("regionHint") || undefined;
    const limit = Number.parseInt(url.searchParams.get("limit") || "10", 10);
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
    const capability = (url.searchParams.get("capability") || "relay") as
      | "fetch"
      | "relay"
      | "library"
      | "spillshare"
      | "stream"
      | "download";
    const regionHint = url.searchParams.get("regionHint") || undefined;
    const limit = Number.parseInt(url.searchParams.get("limit") || "10", 10);
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
    const limit = Number.parseInt(url.searchParams.get("limit") || "20", 10);
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
    const capability = body.capability || "relay";
    const selection = await ctx.runQuery(internal.controlPlane.selectRelay, {
      capability,
      contentId: body.contentId,
      regionHint: body.regionHint,
      limit: body.limit ?? 10,
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

export default http;
