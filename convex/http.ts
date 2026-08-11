import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";

const http = httpRouter();
const NODE_CAPABILITIES = ["fetch", "relay", "library", "spillshare", "stream", "download"] as const;
type NodeCapability = (typeof NODE_CAPABILITIES)[number];

const PUBLIC_TICKET_ACTIONS = {
  "provider.search": "search",
  "provider.feed": "feed",
  "provider.import": "import",
  "player.resolve": "resolve",
  "download.transient": "create",
  "spillshare.read": "manifest",
  "relay.stream": "stream",
} as const;
const V2_CAPABILITIES = Object.keys(PUBLIC_TICKET_ACTIONS);

async function connectionCodeForEnrollmentCredential(credential: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credential));
  return toHex(digest).slice(0, 16).toUpperCase().match(/.{1,4}/g)!.join("-");
}

function normalizeConnectionCode(value: string) {
  const compact = value.trim().toUpperCase().replace(/^SPILL(?:ED)?/, "").replace(/[^A-F0-9]/g, "");
  return compact.length === 16 ? compact.match(/.{1,4}/g)!.join("-") : null;
}

type PublicTicketCapability = keyof typeof PUBLIC_TICKET_ACTIONS;

const LEGACY_CAPABILITY_FOR_TICKET: Record<PublicTicketCapability, NodeCapability> = {
  "provider.search": "fetch",
  "provider.feed": "fetch",
  "provider.import": "fetch",
  "player.resolve": "stream",
  "download.transient": "download",
  "spillshare.read": "spillshare",
  "relay.stream": "relay",
};

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

function privatePemToDer(pem: string) {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  return base64ToArrayBuffer(body);
}

function arrayBufferToBase64Url(value: ArrayBuffer) {
  let binary = "";
  for (const byte of new Uint8Array(value)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomBase64Url(byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return arrayBufferToBase64Url(bytes.buffer);
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
  const privateKeyPem = process.env.SPILLED_CONTROL_PLANE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!privateKeyPem || !process.env.SPILLED_CONTROL_PLANE_KEY_ID) {
    throw new Error("SPILLED_CONTROL_PLANE_PRIVATE_KEY and SPILLED_CONTROL_PLANE_KEY_ID are required.");
  }
  const key = await crypto.subtle.importKey(
    "pkcs8",
    privatePemToDer(privateKeyPem),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    key,
    new TextEncoder().encode(stableStringify(payload)),
  );
  return arrayBufferToBase64Url(signature);
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
  return Boolean(configuredSecret && req.headers.get("x-spilled-control-plane-secret") === configuredSecret);
}

function isAuthorizedConfiguredControlPlaneRequest(req: Request) {
  const configuredSecret = process.env.SPILLED_CONTROL_PLANE_SECRET;
  return Boolean(configuredSecret && req.headers.get("x-spilled-control-plane-secret") === configuredSecret);
}

function isAuthorizedGatewayRequest(req: Request) {
  const serviceToken = process.env.SPILLED_GATEWAY_SERVICE_TOKEN;
  return Boolean(serviceToken && req.headers.get("authorization") === `Bearer ${serviceToken}`);
}

async function sha256Base64Url(value: string) {
  return arrayBufferToBase64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
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
  path: "/server/v2/jwks",
  method: "GET",
  handler: httpAction(async () => {
    const encoded = process.env.SPILLED_CONTROL_PLANE_PUBLIC_JWK;
    const keyId = process.env.SPILLED_CONTROL_PLANE_KEY_ID;
    if (!encoded || !keyId) {
      return json({ error: "Control-plane JWKS is not configured." }, { status: 503 });
    }
    try {
      const key = JSON.parse(encoded) as Record<string, unknown>;
      if (key.kty !== "OKP" || key.crv !== "Ed25519" || typeof key.x !== "string") {
        throw new Error("Invalid Ed25519 JWK.");
      }
      return json({
        keys: [{
          ...key,
          kid: keyId,
          use: "sig",
          alg: "EdDSA",
        }],
      }, {
        headers: {
          "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
        },
      });
    } catch {
      return json({ error: "Control-plane JWKS is invalid." }, { status: 503 });
    }
  }),
});

http.route({
  path: "/server/v2/nodes/enroll",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!isAuthorizedConfiguredControlPlaneRequest(req)) {
      return json({ error: "Unauthorized." }, { status: 401 });
    }
    const body = (await parseJson(req)) as Record<string, unknown>;
    const required = [
      "nodeId",
      "ed25519PublicKey",
      "x25519PublicKey",
      "transportKeySignature",
      "installIdHash",
      "enrollmentCredential",
    ];
    if (
      required.some((key) => typeof body[key] !== "string") ||
      body.protocolVersion !== 2 ||
      typeof body.keyVersion !== "number" ||
      !Array.isArray(body.advertisedCapabilities) ||
      body.advertisedCapabilities.some((entry) => typeof entry !== "string")
    ) {
      return json({ error: "Invalid v2 node enrollment." }, { status: 400 });
    }
    const result = await ctx.runMutation(internal.controlPlane.enrollV2Node, {
      nodeId: body.nodeId as string,
      connectionCode: await connectionCodeForEnrollmentCredential(body.enrollmentCredential as string),
      ed25519PublicKey: body.ed25519PublicKey as string,
      x25519PublicKey: body.x25519PublicKey as string,
      transportKeySignature: body.transportKeySignature as string,
      installIdHash: body.installIdHash as string,
      protocolVersion: 2,
      keyVersion: body.keyVersion as number,
      enrollmentCredentialHash: await sha256Base64Url(body.enrollmentCredential as string),
      advertisedCapabilities: body.advertisedCapabilities as string[],
    });
    return json(result);
  }),
});

http.route({
  path: "/server/v2/nodes/apply",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = (await parseJson(req)) as Record<string, unknown>;
    const required = [
      "nodeId",
      "ed25519PublicKey",
      "x25519PublicKey",
      "transportKeySignature",
      "installIdHash",
      "enrollmentCredential",
      "applicationSignature",
    ];
    if (
      required.some((key) => typeof body[key] !== "string") ||
      body.protocolVersion !== 2 ||
      typeof body.keyVersion !== "number" ||
      typeof body.issuedAt !== "number" ||
      Math.abs(Date.now() - body.issuedAt) > 5 * 60_000 ||
      !Array.isArray(body.advertisedCapabilities) ||
      body.advertisedCapabilities.length > V2_CAPABILITIES.length ||
      body.advertisedCapabilities.some((entry) => typeof entry !== "string" || !V2_CAPABILITIES.includes(entry)) ||
      (body.endpointUrl != null && (typeof body.endpointUrl !== "string" || body.endpointUrl.length > 2_000))
    ) {
      return json({ error: "Invalid v2 node application." }, { status: 400 });
    }
    if (
      (body.nodeId as string).length > 80 ||
      (body.installIdHash as string).length > 128 ||
      (body.enrollmentCredential as string).length < 32 ||
      (body.enrollmentCredential as string).length > 256 ||
      (body.ed25519PublicKey as string).length > 2_000 ||
      (body.x25519PublicKey as string).length > 2_000
    ) {
      return json({ error: "Node application fields exceed their limits." }, { status: 400 });
    }
    try {
      const publicKeyPem = body.ed25519PublicKey as string;
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(publicKeyPem));
      if (body.nodeId !== `node_${toHex(digest).slice(0, 24)}`) {
        return json({ error: "Node identity does not match its public key." }, { status: 401 });
      }
      const publicKey = await crypto.subtle.importKey(
        "spki",
        pemToDer(publicKeyPem),
        { name: "Ed25519" },
        false,
        ["verify"],
      );
      const transportValid = await crypto.subtle.verify(
        { name: "Ed25519" },
        publicKey,
        base64UrlToArrayBuffer(body.transportKeySignature as string),
        new TextEncoder().encode(stableStringify({
          nodeId: body.nodeId,
          transportPublicKey: body.x25519PublicKey,
          keyVersion: body.keyVersion,
        })),
      );
      const { applicationSignature, ...application } = body;
      const applicationValid = await crypto.subtle.verify(
        { name: "Ed25519" },
        publicKey,
        base64UrlToArrayBuffer(applicationSignature as string),
        new TextEncoder().encode(stableStringify(application)),
      );
      if (!transportValid || !applicationValid) {
        return json({ error: "Node application signature is invalid." }, { status: 401 });
      }
    } catch {
      return json({ error: "Node application signature is invalid." }, { status: 401 });
    }
    const result = await ctx.runMutation(internal.controlPlane.enrollV2Node, {
      nodeId: body.nodeId as string,
      connectionCode: await connectionCodeForEnrollmentCredential(body.enrollmentCredential as string),
      ed25519PublicKey: body.ed25519PublicKey as string,
      x25519PublicKey: body.x25519PublicKey as string,
      transportKeySignature: body.transportKeySignature as string,
      installIdHash: body.installIdHash as string,
      protocolVersion: 2,
      keyVersion: body.keyVersion as number,
      enrollmentCredentialHash: await sha256Base64Url(body.enrollmentCredential as string),
      advertisedCapabilities: body.advertisedCapabilities as string[],
      endpointUrl: typeof body.endpointUrl === "string" ? body.endpointUrl : undefined,
    });
    return json(result, {
      status: 202,
      headers: { "Cache-Control": "no-store" },
    });
  }),
});

http.route({
  path: "/server/v2/gateway/verify",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!isAuthorizedGatewayRequest(req)) {
      return json({ error: "Unauthorized." }, { status: 401 });
    }
    const body = (await parseJson(req)) as {
      nodeId?: unknown;
      role?: unknown;
      credential?: unknown;
    };
    if (typeof body.nodeId !== "string" || typeof body.credential !== "string") {
      return json({ error: "Invalid gateway verification request." }, { status: 400 });
    }
    if (body.role === "node") {
      const valid = await ctx.runQuery(internal.controlPlane.verifyGatewayNodeCredential, {
        nodeId: body.nodeId,
        enrollmentCredentialHash: await sha256Base64Url(body.credential),
      });
      if (!valid) {
        return json({ error: "Node enrollment rejected." }, { status: 401 });
      }
      await ctx.runMutation(internal.controlPlane.recordGatewayHeartbeatV2, {
        nodeId: body.nodeId,
        protocolVersion: 2,
        capacityClass: "standard",
        ttlMs: 90_000,
      });
      return json({ ok: true });
    }
    if (body.role === "client") {
      try {
        const ticket = JSON.parse(body.credential) as {
          version?: unknown;
          ticketId?: unknown;
          nodeId?: unknown;
          capability?: unknown;
          expiresAt?: unknown;
        };
        if (
          ticket.version !== 2 ||
          typeof ticket.ticketId !== "string" ||
          ticket.nodeId !== body.nodeId ||
          typeof ticket.capability !== "string" ||
          typeof ticket.expiresAt !== "number"
        ) {
          throw new Error("Invalid ticket.");
        }
        const valid = await ctx.runQuery(internal.controlPlane.verifyGatewayTicket, {
          ticketId: ticket.ticketId,
          nodeId: body.nodeId,
          capability: ticket.capability,
          expiresAt: ticket.expiresAt,
        });
        return valid ? json({ ok: true }) : json({ error: "Capability ticket rejected." }, { status: 401 });
      } catch {
        return json({ error: "Capability ticket is malformed." }, { status: 401 });
      }
    }
    return json({ error: "Unsupported gateway role." }, { status: 400 });
  }),
});

http.route({
  path: "/server/v2/gateway/heartbeat",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!isAuthorizedGatewayRequest(req)) {
      return json({ error: "Unauthorized." }, { status: 401 });
    }
    const body = (await parseJson(req)) as { nodeId?: unknown };
    if (typeof body.nodeId !== "string") {
      return json({ error: "nodeId is required." }, { status: 400 });
    }
    await ctx.runMutation(internal.controlPlane.recordGatewayHeartbeatV2, {
      nodeId: body.nodeId,
      protocolVersion: 2,
      capacityClass: "standard",
      ttlMs: 90_000,
    });
    return json({ ok: true });
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
      signatureKeyId: process.env.SPILLED_CONTROL_PLANE_KEY_ID,
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
      signatureKeyId: process.env.SPILLED_CONTROL_PLANE_KEY_ID,
      signature: await signControlPlanePayload(envelope),
    });
  }),
});

http.route({
  path: "/server/node/verification",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!isAuthorizedConfiguredControlPlaneRequest(req)) {
      return json({ error: "Unauthorized." }, { status: 401 });
    }
    const body = (await parseJson(req)) as {
      nodeId?: unknown;
      status?: unknown;
    };
    const statuses = ["pending", "verified", "degraded", "quarantined", "disabled", "legacy-unverified"];
    if (typeof body.nodeId !== "string" || typeof body.status !== "string" || !statuses.includes(body.status)) {
      return json({ error: "Invalid verification update." }, { status: 400 });
    }
    const result = await ctx.runMutation(internal.controlPlane.setNodeVerificationStatus, {
      nodeId: body.nodeId,
      status: body.status as never,
    });
    return json(result);
  }),
});

http.route({
  path: "/server/v2/nodes/verification",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!isAuthorizedConfiguredControlPlaneRequest(req)) {
      return json({ error: "Unauthorized." }, { status: 401 });
    }
    const body = (await parseJson(req)) as {
      nodeId?: unknown;
      status?: unknown;
      capabilities?: unknown;
    };
    const statuses = ["pending", "verified", "degraded", "quarantined", "disabled", "legacy-unverified"];
    if (
      typeof body.nodeId !== "string" ||
      typeof body.status !== "string" ||
      !statuses.includes(body.status) ||
      !Array.isArray(body.capabilities) ||
      body.capabilities.some((entry) => (
        !entry || typeof entry !== "object" ||
        typeof (entry as { capability?: unknown }).capability !== "string" ||
        typeof (entry as { status?: unknown }).status !== "string" ||
        !statuses.includes((entry as { status: string }).status)
      ))
    ) {
      return json({ error: "Invalid v2 verification update." }, { status: 400 });
    }
    const result = await ctx.runMutation(internal.controlPlane.setV2NodeVerification, {
      nodeId: body.nodeId,
      status: body.status as never,
      capabilities: body.capabilities as never,
    });
    return json(result);
  }),
});

http.route({
  path: "/server/v2/nodes/verification-candidates",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    if (!isAuthorizedConfiguredControlPlaneRequest(req)) {
      return json({ error: "Unauthorized." }, { status: 401 });
    }
    const limit = clampLimit(new URL(req.url).searchParams.get("limit"), 20, 50);
    return json({
      candidates: await ctx.runQuery(internal.controlPlane.listV2VerificationCandidates, { limit }),
    }, { headers: { "Cache-Control": "no-store" } });
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
  path: "/server/v2/discovery/nodes",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const capability = url.searchParams.get("capability");
    if (!capability || !V2_CAPABILITIES.includes(capability)) {
      return json({ error: "Unsupported v2 capability." }, { status: 400 });
    }
    const limit = clampLimit(url.searchParams.get("limit"), 10, 50);
    const candidates = await ctx.runQuery(internal.controlPlane.listVerifiedV2Nodes, {
      capability,
      limit,
    });
    return json({ capability, candidates }, {
      headers: { "Cache-Control": "no-store" },
    });
  }),
});

http.route({
  path: "/server/v2/tickets",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = (await parseJson(req)) as {
      nodeId?: unknown;
      capability?: unknown;
      action?: unknown;
      contentId?: unknown;
    };
    if (
      typeof body.nodeId !== "string" ||
      typeof body.capability !== "string" ||
      !(body.capability in PUBLIC_TICKET_ACTIONS)
    ) {
      return json({ error: "Invalid ticket request." }, { status: 400 });
    }
    const capability = body.capability as PublicTicketCapability;
    const expectedAction = PUBLIC_TICKET_ACTIONS[capability];
    if (body.action !== undefined && body.action !== expectedAction) {
      return json({ error: "Action does not match the requested capability." }, { status: 400 });
    }
    if (body.contentId !== undefined && typeof body.contentId !== "string") {
      return json({ error: "contentId must be a string." }, { status: 400 });
    }
    if (capability === "spillshare.read" && typeof body.contentId !== "string") {
      return json({ error: "SpillShare tickets require contentId." }, { status: 400 });
    }
    if (!await ctx.runQuery(internal.controlPlane.allowCapabilityTicketIssue, {
      nodeId: body.nodeId,
      windowMs: 60_000,
      limit: 120,
    })) {
      return json({ error: "Ticket rate limit exceeded." }, { status: 429 });
    }
    const verifierRequest = isAuthorizedConfiguredControlPlaneRequest(req) &&
      (body as { principalKind?: unknown }).principalKind === "verifier";
    if (!verifierRequest) {
      const verifiedNode = await ctx.runQuery(internal.controlPlane.getVerifiedV2NodeForTicket, {
        nodeId: body.nodeId,
        capability,
      });
      if (!verifiedNode) {
        return json({ error: "Node capability is not verified or available." }, { status: 404 });
      }
    }
    const issuedAt = Date.now();
    const isBulk = capability === "download.transient" || capability === "spillshare.read" || capability === "relay.stream";
    const unsignedTicket = {
      version: 2 as const,
      ticketId: crypto.randomUUID(),
      nodeId: body.nodeId,
      principalKind: verifierRequest ? "verifier" as const : "public" as const,
      capability,
      action: expectedAction,
      ...(typeof body.contentId === "string" ? { contentId: body.contentId } : {}),
      maxRequestBytes: 256 * 1024,
      maxResponseBytes: isBulk ? 10 * 1024 * 1024 * 1024 : 4 * 1024 * 1024,
      maxDurationMs: isBulk ? 90 * 60 * 1_000 : 30_000,
      issuedAt,
      expiresAt: issuedAt + 60_000,
      nonce: randomBase64Url(24),
      keyId: process.env.SPILLED_CONTROL_PLANE_KEY_ID ?? "",
    };
    const signature = await signControlPlanePayload(unsignedTicket);
    await ctx.runMutation(internal.controlPlane.recordCapabilityTicket, {
      ticketId: unsignedTicket.ticketId,
      nodeId: unsignedTicket.nodeId,
      principalKind: unsignedTicket.principalKind,
      capability: unsignedTicket.capability,
      action: unsignedTicket.action,
      issuedAt: unsignedTicket.issuedAt,
      expiresAt: unsignedTicket.expiresAt,
      outcome: "issued",
    });
    return json({ ...unsignedTicket, signature }, {
      headers: { "Cache-Control": "no-store" },
    });
  }),
});

http.route({
  path: "/server/v2/private-nodes/resolve",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const code = normalizeConnectionCode(new URL(req.url).searchParams.get("code") ?? "");
    if (!code) return json({ error: "Enter a complete 16-character connection code." }, { status: 400 });
    const candidate = await ctx.runQuery(internal.controlPlane.resolvePrivateV2NodeConnection, {
      connectionCode: code,
    });
    if (!candidate) return json({ error: "No private node matches that connection code." }, { status: 404 });
    if (!candidate.online) return json({ error: "That private node is offline." }, { status: 409 });
    return json({ candidate }, { headers: { "Cache-Control": "no-store" } });
  }),
});

http.route({
  path: "/server/v2/private-tickets",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = (await parseJson(req)) as {
      nodeId?: unknown;
      connectionCode?: unknown;
      capability?: unknown;
      action?: unknown;
    };
    const connectionCode = typeof body.connectionCode === "string"
      ? normalizeConnectionCode(body.connectionCode)
      : null;
    const privateCapabilities = [
      "library.read",
      "library.write",
      "node.admin",
      "provider.search",
      "provider.feed",
      "provider.import",
      "player.resolve",
    ];
    if (
      typeof body.nodeId !== "string" ||
      !connectionCode ||
      typeof body.capability !== "string" ||
      !privateCapabilities.includes(body.capability) ||
      typeof body.action !== "string" ||
      !/^[a-z][a-z0-9.]{1,63}$/.test(body.action)
    ) {
      return json({ error: "Invalid private routing ticket request." }, { status: 400 });
    }
    const reachable = await ctx.runQuery(internal.controlPlane.resolvePrivateV2NodeConnection, {
      connectionCode,
    });
    if (!reachable || !reachable.online || reachable.nodeId !== body.nodeId) {
      return json({ error: "Private node is not reachable." }, { status: 404 });
    }
    if (!await ctx.runQuery(internal.controlPlane.allowCapabilityTicketIssue, {
      nodeId: body.nodeId,
      windowMs: 60_000,
      limit: 30,
    })) {
      return json({ error: "Private routing ticket rate limit exceeded." }, { status: 429 });
    }
    const issuedAt = Date.now();
    const unsignedTicket = {
      version: 2 as const,
      ticketId: crypto.randomUUID(),
      nodeId: body.nodeId,
      principalKind: "private" as const,
      capability: body.capability,
      action: body.action,
      maxRequestBytes: 256 * 1024,
      maxResponseBytes: 4 * 1024 * 1024,
      maxDurationMs: 30_000,
      issuedAt,
      expiresAt: issuedAt + 5 * 60_000,
      nonce: randomBase64Url(24),
      keyId: process.env.SPILLED_CONTROL_PLANE_KEY_ID ?? "",
    };
    const signature = await signControlPlanePayload(unsignedTicket);
    await ctx.runMutation(internal.controlPlane.recordCapabilityTicket, {
      ticketId: unsignedTicket.ticketId,
      nodeId: unsignedTicket.nodeId,
      principalKind: unsignedTicket.principalKind,
      capability: unsignedTicket.capability,
      action: unsignedTicket.action,
      issuedAt,
      expiresAt: unsignedTicket.expiresAt,
      outcome: "issued",
    });
    return json({ ...unsignedTicket, signature }, { headers: { "Cache-Control": "no-store" } });
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
      signatureKeyId: process.env.SPILLED_CONTROL_PLANE_KEY_ID,
      signature: await signControlPlanePayload(envelope),
    });
  }),
});

http.route({
  path: "/server/discovery/spillshare",
  method: "GET",
  handler: httpAction(async () => {
    return json({
      error: "Legacy SpillShare discovery is retired. Use /server/v2/discovery/spillshare.",
    }, { status: 410 });
  }),
});

http.route({
  path: "/server/v2/discovery/spillshare",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const contentId = url.searchParams.get("contentId");
    if (!contentId) {
      return json({ error: "contentId is required." }, { status: 400 });
    }
    const limit = clampLimit(url.searchParams.get("limit"), 20, 100);
    const sources = await ctx.runQuery(internal.controlPlane.listVerifiedSpillshareAvailability, {
      contentId,
      limit,
    });
    return json({ contentId, sources });
  }),
});

http.route({
  path: "/server/v2/spillshare/verify",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!isAuthorizedConfiguredControlPlaneRequest(req)) {
      return json({ error: "Unauthorized." }, { status: 401 });
    }
    const body = (await parseJson(req)) as {
      contentId?: unknown;
      nodeId?: unknown;
      renditionClass?: unknown;
      verifiedAt?: unknown;
      expiresAt?: unknown;
    };
    if (
      typeof body.contentId !== "string" ||
      typeof body.nodeId !== "string" ||
      typeof body.renditionClass !== "string" ||
      typeof body.verifiedAt !== "number" ||
      typeof body.expiresAt !== "number" ||
      body.expiresAt <= body.verifiedAt
    ) {
      return json({ error: "Invalid verified availability." }, { status: 400 });
    }
    const id = await ctx.runMutation(internal.controlPlane.publishVerifiedSpillshareAvailability, {
      contentId: body.contentId,
      nodeId: body.nodeId,
      renditionClass: body.renditionClass,
      verifiedAt: body.verifiedAt,
      expiresAt: body.expiresAt,
    });
    return json({ ok: true, id });
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
      signatureKeyId: process.env.SPILLED_CONTROL_PLANE_KEY_ID,
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
