import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";

type PublicCapability = "provider.search" | "provider.feed" | "provider.import" | "player.resolve";
export type PrivateCapability = "library.read" | "library.write" | "node.admin" | "player.resolve";
type Capability = PublicCapability | PrivateCapability;

type CapabilityTicketV2 = {
  version: 2;
  ticketId: string;
  nodeId: string;
  principalKind: "public" | "private" | "verifier";
  capability: Capability;
  action: string;
  maxRequestBytes: number;
  maxResponseBytes: number;
  maxDurationMs: number;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  keyId: string;
  signature: string;
};

export type V2Candidate = {
  nodeId: string;
  endpointUrl?: string;
  connectionCode?: string;
  identity: {
    x25519PublicKey: string;
  };
};

type EncryptedRequestEnvelopeV2 = {
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

type EncryptedResponseEnvelopeV2 = {
  version: 2;
  requestId: string;
  ticketId: string;
  issuedAt: number;
  nonce: string;
  contentEncoding?: "gzip";
  ciphertext: string;
  authenticationTag: string;
};

type BrowserEncryptedRequest = {
  envelope: EncryptedRequestEnvelopeV2;
  privateKey: Uint8Array;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const X25519_SPKI_PREFIX = Uint8Array.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x03, 0x21, 0x00]);
const GATEWAY_URL = (import.meta.env?.VITE_SPILLED_GATEWAY_URL as string | undefined)
  ?? "https://spilled-node-gateway.hrdykrystof.workers.dev";

// Capability tickets are signed and scoped to a node/capability/action but are
// not single-use. Reusing the last known node + still-valid ticket for the same
// capability avoids the discovery + ticket HTTP round trips (through Vercel and
// Convex) on every gateway call, which matters most for search where each
// keystroke hits the gateway. A failed cached attempt falls through to fresh
// discovery, so a node going offline never wedges a session.
type GatewayCachedSession = {
  candidate: V2Candidate;
  ticket: CapabilityTicketV2;
};

export class GatewayRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayRemoteError";
  }
}

const gatewaySessionCache = new Map<string, GatewayCachedSession>();
const GATEWAY_TICKET_REUSE_MARGIN_MS = 10_000;

function gatewaySessionCacheKey(capability: Capability, action: string, nodeId = "public") {
  return `${nodeId}:${capability}:${action}`;
}

function isGatewayTicketUsable(ticket: CapabilityTicketV2) {
  return ticket.expiresAt - Date.now() > GATEWAY_TICKET_REUSE_MARGIN_MS;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

function concatBytes(...values: Uint8Array[]) {
  const output = new Uint8Array(values.reduce((total, value) => total + value.length, 0));
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
}

function bytesToBase64Url(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function pemToRawX25519(value: string) {
  const base64 = value
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  if (
    der.length !== X25519_SPKI_PREFIX.length + 32 ||
    !X25519_SPKI_PREFIX.every((byte, index) => der[index] === byte)
  ) {
    throw new Error("Node transport key is not a valid X25519 public key.");
  }
  return der.slice(X25519_SPKI_PREFIX.length);
}

function rawX25519ToPem(value: Uint8Array) {
  const der = concatBytes(X25519_SPKI_PREFIX, value);
  let base64 = "";
  for (const byte of der) base64 += String.fromCharCode(byte);
  const encoded = btoa(base64).match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN PUBLIC KEY-----\n${encoded}\n-----END PUBLIC KEY-----\n`;
}

function deriveKey(sharedSecret: Uint8Array, requestId: string, ticketId: string) {
  return hkdf(
    sha256,
    sharedSecret,
    textEncoder.encode(requestId),
    textEncoder.encode(`spilled-node-v2:${ticketId}`),
    32,
  );
}

export function createBrowserEncryptedNodeRequest(input: {
  nodeTransportPublicKey: string;
  requestId: string;
  ticketId: string;
  issuedAt: number;
  expiresAt: number;
  plaintext: string;
  acceptEncoding?: "gzip";
}): BrowserEncryptedRequest {
  const privateKey = x25519.utils.randomPrivateKey();
  const publicKey = x25519.getPublicKey(privateKey);
  const nonce = crypto.getRandomValues(new Uint8Array(24));
  const header = {
    version: 2 as const,
    requestId: input.requestId,
    ticketId: input.ticketId,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    nonce: bytesToBase64Url(nonce),
    clientEphemeralKey: rawX25519ToPem(publicKey),
    ...(input.acceptEncoding ? { acceptEncoding: input.acceptEncoding } : {}),
  };
  const sharedSecret = x25519.getSharedSecret(privateKey, pemToRawX25519(input.nodeTransportPublicKey));
  const key = deriveKey(sharedSecret, input.requestId, input.ticketId);
  const cipherNonce = sha256(nonce).slice(0, 12);
  const encrypted = chacha20poly1305(
    key,
    cipherNonce,
    textEncoder.encode(stableStringify({
      version: header.version,
      requestId: header.requestId,
      ticketId: header.ticketId,
      issuedAt: header.issuedAt,
      expiresAt: header.expiresAt,
      nonce: header.nonce,
      clientEphemeralKey: header.clientEphemeralKey,
    })),
  ).encrypt(textEncoder.encode(input.plaintext));
  return {
    privateKey,
    envelope: {
      ...header,
      ciphertext: bytesToBase64Url(encrypted.slice(0, -16)),
      authenticationTag: bytesToBase64Url(encrypted.slice(-16)),
    },
  };
}

function decryptBrowserNodeResponseBytes(input: {
  response: EncryptedResponseEnvelopeV2;
  request: EncryptedRequestEnvelopeV2;
  privateKey: Uint8Array;
  nodeTransportPublicKey: string;
}) {
  if (
    input.response.version !== 2 ||
    input.response.requestId !== input.request.requestId ||
    input.response.ticketId !== input.request.ticketId
  ) {
    throw new Error("Encrypted node response does not match its request.");
  }
  const sharedSecret = x25519.getSharedSecret(
    input.privateKey,
    pemToRawX25519(input.nodeTransportPublicKey),
  );
  const key = deriveKey(sharedSecret, input.request.requestId, input.request.ticketId);
  const nonce = base64UrlToBytes(input.response.nonce);
  if (nonce.length !== 24) throw new Error("Node response nonce is invalid.");
  const header = {
    version: input.response.version,
    requestId: input.response.requestId,
    ticketId: input.response.ticketId,
    issuedAt: input.response.issuedAt,
    nonce: input.response.nonce,
    ...(input.response.contentEncoding ? { contentEncoding: input.response.contentEncoding } : {}),
  };
  const plaintext = chacha20poly1305(
    key,
    sha256(nonce).slice(0, 12),
    textEncoder.encode(stableStringify(header)),
  ).decrypt(concatBytes(
    base64UrlToBytes(input.response.ciphertext),
    base64UrlToBytes(input.response.authenticationTag),
  ));
  return plaintext;
}

export function decryptBrowserNodeResponse(input: {
  response: EncryptedResponseEnvelopeV2;
  request: EncryptedRequestEnvelopeV2;
  privateKey: Uint8Array;
  nodeTransportPublicKey: string;
}) {
  if (input.response.contentEncoding) {
    throw new Error("Compressed node responses require asynchronous decoding.");
  }
  return textDecoder.decode(decryptBrowserNodeResponseBytes(input));
}

export async function decodeBrowserNodeResponse(input: {
  response: EncryptedResponseEnvelopeV2;
  request: EncryptedRequestEnvelopeV2;
  privateKey: Uint8Array;
  nodeTransportPublicKey: string;
}) {
  const plaintext = decryptBrowserNodeResponseBytes(input);
  if (input.response.contentEncoding !== "gzip") return textDecoder.decode(plaintext);
  const compressed = new Uint8Array(plaintext.byteLength);
  compressed.set(plaintext);
  const decompressed = new Response(
    new Blob([compressed.buffer]).stream().pipeThrough(new DecompressionStream("gzip")),
  );
  return await decompressed.text();
}

function gatewayWebSocketUrl(nodeId: string) {
  const url = new URL(GATEWAY_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/v2/nodes/${encodeURIComponent(nodeId)}/connect`;
  url.search = "?role=client";
  return url.toString();
}

async function discoverCandidates(capability: PublicCapability) {
  const response = await fetch(
    `/api/server?path=v2%2Fdiscovery%2Fnodes&capability=${encodeURIComponent(capability)}&limit=12`,
    { headers: { Accept: "application/json" } },
  );
  if (!response.ok) return [];
  const payload = await response.json() as { candidates?: V2Candidate[] };
  return payload.candidates ?? [];
}

async function issueTicket(candidate: V2Candidate, capability: PublicCapability, action: string) {
  const response = await fetch("/api/server?path=v2%2Ftickets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nodeId: candidate.nodeId,
      capability,
      action,
    }),
  });
  if (!response.ok) throw new Error(`Capability ticket request failed (${response.status}).`);
  return await response.json() as CapabilityTicketV2;
}

async function issuePrivateTicket(candidate: V2Candidate, capability: PrivateCapability, action: string) {
  const response = await fetch("/api/server?path=v2%2Fprivate-tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nodeId: candidate.nodeId,
      connectionCode: candidate.connectionCode,
      capability,
      action,
    }),
  });
  const payload = await response.json().catch(() => null) as CapabilityTicketV2 & { error?: string };
  if (!response.ok) throw new Error(payload?.error ?? `Private routing ticket request failed (${response.status}).`);
  return payload;
}

export async function resolvePrivateGatewayCandidate(connectionCode: string) {
  const response = await fetch(
    `/api/server?path=v2%2Fprivate-nodes%2Fresolve&code=${encodeURIComponent(connectionCode)}`,
    { headers: { Accept: "application/json" } },
  );
  const payload = await response.json().catch(() => null) as {
    candidate?: V2Candidate & { connectionCode: string; online: boolean };
    error?: string;
  } | null;
  if (!response.ok || !payload?.candidate) {
    if (response.status >= 500) {
      throw new Error("The private-node connection service is temporarily unavailable. Try again in a moment.");
    }
    throw new Error(payload?.error ?? `Private node lookup failed (${response.status}).`);
  }
  return payload.candidate;
}

async function sendGatewayRpc(
  candidate: V2Candidate,
  ticket: CapabilityTicketV2,
  method: string,
  params: Record<string, unknown>,
) {
  const requestId = crypto.randomUUID();
  const encrypted = createBrowserEncryptedNodeRequest({
    nodeTransportPublicKey: candidate.identity.x25519PublicKey,
    requestId,
    ticketId: ticket.ticketId,
    issuedAt: Date.now(),
    expiresAt: ticket.expiresAt,
    plaintext: JSON.stringify({ method, params }),
    acceptEncoding: "gzip",
  });
  const ticketProtocol = `ticket.${bytesToBase64Url(textEncoder.encode(JSON.stringify(ticket)))}`;
  const socket = new WebSocket(gatewayWebSocketUrl(candidate.nodeId), ["spilled-v2", ticketProtocol]);
  const response = await new Promise<EncryptedResponseEnvelopeV2>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      socket.close();
      reject(new Error("Gateway request timed out."));
    }, Math.min(ticket.maxDurationMs + 5_000, 95_000));
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        version: 2,
        requestId,
        ticketId: ticket.ticketId,
        ticket,
        body: JSON.stringify(encrypted.envelope),
      }));
    }, { once: true });
    socket.addEventListener("message", (event) => {
      window.clearTimeout(timeout);
      try {
        const frame = JSON.parse(String(event.data)) as { body?: string };
        if (!frame.body) throw new Error("Gateway response body is missing.");
        resolve(JSON.parse(frame.body) as EncryptedResponseEnvelopeV2);
      } catch (error) {
        reject(error);
      } finally {
        socket.close();
      }
    }, { once: true });
    socket.addEventListener("error", () => {
      window.clearTimeout(timeout);
      reject(new Error("Gateway connection failed."));
    }, { once: true });
    socket.addEventListener("close", (event) => {
      if (event.code !== 1000 && event.code !== 1005) {
        window.clearTimeout(timeout);
        reject(new Error(event.reason || `Gateway closed the connection (${event.code}).`));
      }
    }, { once: true });
  });
  const payload = JSON.parse(await decodeBrowserNodeResponse({
    response,
    request: encrypted.envelope,
    privateKey: encrypted.privateKey,
    nodeTransportPublicKey: candidate.identity.x25519PublicKey,
  })) as { ok?: boolean; result?: unknown; error?: string };
  if (!payload.ok) throw new GatewayRemoteError(payload.error || "Node rejected the gateway request.");
  return payload.result;
}

async function tryCachedGatewayRequest(
  cacheKey: string,
  method: string,
  params: Record<string, unknown>,
) {
  const cached = gatewaySessionCache.get(cacheKey);
  if (!cached || !isGatewayTicketUsable(cached.ticket)) return null;
  try {
    return {
      candidate: cached.candidate,
      data: await sendGatewayRpc(cached.candidate, cached.ticket, method, params),
    };
  } catch (error) {
    if (error instanceof GatewayRemoteError) throw error;
    gatewaySessionCache.delete(cacheKey);
    console.warn(`[gateway] cached ${cached.candidate.nodeId} ${method} failed, requesting a fresh route:`, error);
    return null;
  }
}

async function requestFreshGatewayCandidate(
  cacheKey: string,
  candidate: V2Candidate,
  issue: () => Promise<CapabilityTicketV2>,
  method: string,
  params: Record<string, unknown>,
) {
  const ticket = await issue();
  gatewaySessionCache.set(cacheKey, { candidate, ticket });
  try {
    return await sendGatewayRpc(candidate, ticket, method, params);
  } catch (error) {
    if (error instanceof GatewayRemoteError) throw error;
    gatewaySessionCache.delete(cacheKey);
    throw error;
  }
}


export async function requestPublicGateway(
  capability: PublicCapability,
  action: string,
  method: string,
  params: Record<string, unknown>,
) {
  const cacheKey = gatewaySessionCacheKey(capability, action);
  const cached = await tryCachedGatewayRequest(cacheKey, method, params);
  if (cached) {
    return {
      nodeId: cached.candidate.nodeId,
      endpointUrl: cached.candidate.endpointUrl ?? null,
      data: cached.data,
    };
  }

  const candidates = await discoverCandidates(capability);
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return {
        nodeId: candidate.nodeId,
        endpointUrl: candidate.endpointUrl ?? null,
        data: await requestFreshGatewayCandidate(
          cacheKey,
          candidate,
          () => issueTicket(candidate, capability, action),
          method,
          params,
        ),
      };
    } catch (error) {
      lastError = error;
      console.warn(`[gateway] ${candidate.nodeId} ${method} failed:`, error);
    }
  }
  if (lastError) throw lastError;
  return null;
}

export async function requestPrivateGateway(
  candidate: V2Candidate,
  capability: PrivateCapability,
  action: string,
  method: string,
  params: Record<string, unknown>,
) {
  const cacheKey = gatewaySessionCacheKey(capability, action, candidate.nodeId);
  const cached = await tryCachedGatewayRequest(cacheKey, method, params);
  if (cached) return cached.data;

  let lastError: unknown = null;
  // Public requests can fall through to another verified node. A private code
  // intentionally resolves to one node, so give that same route one fresh
  // retry instead of making the user repeat the action manually.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await requestFreshGatewayCandidate(
        cacheKey,
        candidate,
        () => issuePrivateTicket(candidate, capability, action),
        method,
        params,
      );
    } catch (error) {
      if (error instanceof GatewayRemoteError) throw error;
      lastError = error;
      if (attempt === 0) {
        console.warn(`[gateway] private ${candidate.nodeId} ${method} failed, retrying with a fresh ticket:`, error);
      }
    }
  }
  throw lastError;
}
