// src/index.ts
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

// ../../packages/security/src/index.ts
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  timingSafeEqual,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  scryptSync,
  sign as cryptoSign,
  verify as cryptoVerify
} from "node:crypto";
import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { hash as hashArgon2, verify as verifyArgon2 } from "@node-rs/argon2";
function base64UrlEncode(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64UrlDecode(value) {
  const pad = "===".slice((value.length + 3) % 4);
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}
function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(",")}}`;
}
function deriveTransportKey(sharedSecret, requestId, ticketId) {
  return Buffer.from(hkdfSync(
    "sha256",
    sharedSecret,
    Buffer.from(requestId, "utf8"),
    Buffer.from(`spilled-node-v2:${ticketId}`, "utf8"),
    32
  ));
}
function encryptChaCha20Poly1305(key, nonce, aad, plaintext) {
  const sealed = chacha20poly1305(key, nonce, aad).encrypt(plaintext);
  return {
    ciphertext: Buffer.from(sealed.subarray(0, -16)),
    authenticationTag: Buffer.from(sealed.subarray(-16))
  };
}
function decryptChaCha20Poly1305(key, nonce, aad, ciphertext, authenticationTag) {
  return Buffer.from(chacha20poly1305(key, nonce, aad).decrypt(Buffer.concat([
    ciphertext,
    authenticationTag
  ])));
}
function transportAad(envelope) {
  return Buffer.from(stableStringify(envelope), "utf8");
}
function createEncryptedNodeRequest(input) {
  const ephemeral = generateKeyPairSync("x25519");
  const ephemeralPublicKey = ephemeral.publicKey.export({ type: "spki", format: "pem" }).toString();
  const nonce = randomBytes(24);
  const envelopeHeader = {
    version: 2,
    requestId: input.requestId,
    ticketId: input.ticketId,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    nonce: base64UrlEncode(nonce),
    clientEphemeralKey: ephemeralPublicKey
  };
  const sharedSecret = diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: createPublicKey(input.nodeTransportPublicKey)
  });
  const key = deriveTransportKey(sharedSecret, input.requestId, input.ticketId);
  const cipherNonce = createHash("sha256").update(nonce).digest().subarray(0, 12);
  const plaintext = typeof input.plaintext === "string" ? Buffer.from(input.plaintext, "utf8") : input.plaintext;
  const encrypted = encryptChaCha20Poly1305(key, cipherNonce, transportAad(envelopeHeader), plaintext);
  const envelope = {
    ...envelopeHeader,
    ciphertext: base64UrlEncode(encrypted.ciphertext),
    authenticationTag: base64UrlEncode(encrypted.authenticationTag)
  };
  return {
    envelope,
    clientEphemeralPrivateKey: ephemeral.privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  };
}
function responseAad(response) {
  return Buffer.from(stableStringify(response), "utf8");
}
function decryptNodeResponse(input) {
  if (input.response.version !== 2 || input.response.requestId !== input.request.requestId || input.response.ticketId !== input.request.ticketId) {
    throw new Error("Encrypted response does not match its request.");
  }
  const sharedSecret = diffieHellman({
    privateKey: createPrivateKey(input.clientEphemeralPrivateKey),
    publicKey: createPublicKey(input.nodeTransportPublicKey)
  });
  const key = deriveTransportKey(sharedSecret, input.request.requestId, input.request.ticketId);
  const nonce = base64UrlDecode(input.response.nonce);
  if (nonce.length !== 24) {
    throw new Error("Encrypted response nonce must be 192 bits.");
  }
  const ciphertext = base64UrlDecode(input.response.ciphertext);
  const cipherNonce = createHash("sha256").update(nonce).digest().subarray(0, 12);
  return decryptChaCha20Poly1305(key, cipherNonce, responseAad({
    version: input.response.version,
    requestId: input.response.requestId,
    ticketId: input.response.ticketId,
    issuedAt: input.response.issuedAt,
    nonce: input.response.nonce
  }), ciphertext, base64UrlDecode(input.response.authenticationTag));
}
function verifyPayload(payload, signature, publicKeyPem) {
  const body = stableStringify(payload);
  return cryptoVerify(null, Buffer.from(body), publicKeyPem, base64UrlDecode(signature));
}

// src/index.ts
var baseUrl = process.env.SPILLED_CONTROL_PLANE_URL?.replace(/\/$/, "");
var gatewayUrl = process.env.SPILLED_GATEWAY_URL?.replace(/\/$/, "").replace(/^http/, "ws");
var adminSecret = process.env.SPILLED_CONTROL_PLANE_SECRET;
if (!baseUrl || !gatewayUrl || !adminSecret) {
  throw new Error("SPILLED_CONTROL_PLANE_URL, SPILLED_GATEWAY_URL, and SPILLED_CONTROL_PLANE_SECRET are required.");
}
var configuredProbes = JSON.parse(process.env.SPILLED_VERIFIER_PROBES_JSON || "{}");
var defaultProbes = {
  "provider.search": {
    method: "provider.search",
    params: { moduleId: "bombuj", query: "Silo", limit: 1 }
  },
  "provider.feed": {
    method: "provider.feed",
    params: { moduleId: "bombuj", feedId: "latest-movies", limit: 1 }
  }
};
var actions = {
  "provider.search": "search",
  "provider.feed": "feed",
  "provider.import": "import",
  "player.resolve": "resolve",
  "download.transient": "create",
  "spillshare.read": "manifest",
  "relay.stream": "stream"
};
async function controlPlane(path, init = {}) {
  return await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Spilled-Control-Plane-Secret": adminSecret,
      ...init.headers ?? {}
    },
    signal: AbortSignal.timeout(3e4)
  });
}
async function issueTicket(candidate, capability, contentId) {
  const response = await controlPlane("/v2/tickets", {
    method: "POST",
    body: JSON.stringify({
      nodeId: candidate.nodeId,
      capability,
      action: actions[capability],
      principalKind: "verifier",
      ...contentId ? { contentId } : {}
    })
  });
  if (!response.ok) throw new Error(`Verifier ticket failed: ${response.status}.`);
  return await response.json();
}
async function probe(candidate, capability) {
  const template = configuredProbes[capability] ?? defaultProbes[capability];
  if (!template) return "degraded";
  const ticket = await issueTicket(candidate, capability, template.contentId);
  const requestId = randomUUID();
  const encrypted = createEncryptedNodeRequest({
    nodeTransportPublicKey: candidate.identity.x25519PublicKey,
    requestId,
    ticketId: ticket.ticketId,
    issuedAt: Date.now(),
    expiresAt: ticket.expiresAt,
    plaintext: JSON.stringify({ method: template.method, params: template.params })
  });
  const protocol = `ticket.${Buffer.from(JSON.stringify(ticket)).toString("base64url")}`;
  const socket = new WebSocket(
    `${gatewayUrl}/v2/nodes/${encodeURIComponent(candidate.nodeId)}/connect?role=client`,
    ["spilled-v2", protocol],
    { handshakeTimeout: 15e3, maxPayload: ticket.maxResponseBytes + 64 * 1024 }
  );
  const response = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Capability probe timed out."));
    }, 3e4);
    socket.once("open", () => socket.send(JSON.stringify({
      version: 2,
      requestId,
      ticketId: ticket.ticketId,
      ticket,
      body: JSON.stringify(encrypted.envelope)
    })));
    socket.once("message", (raw) => {
      clearTimeout(timeout);
      try {
        const frame = JSON.parse(raw.toString());
        resolve(JSON.parse(frame.body));
      } catch (error) {
        reject(error);
      } finally {
        socket.close();
      }
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.once("close", (code, reason) => {
      clearTimeout(timeout);
      reject(new Error(`Gateway closed the probe (${code}: ${reason.toString() || "no reason"}).`));
    });
  });
  const payload = JSON.parse(decryptNodeResponse({
    response,
    request: encrypted.envelope,
    clientEphemeralPrivateKey: encrypted.clientEphemeralPrivateKey,
    nodeTransportPublicKey: candidate.identity.x25519PublicKey
  }).toString("utf8"));
  return payload.ok ? "verified" : "degraded";
}
async function verifyCandidate(candidate) {
  const identityValid = candidate.identity.protocolVersion === 2 && verifyPayload({
    nodeId: candidate.nodeId,
    transportPublicKey: candidate.identity.x25519PublicKey,
    keyVersion: candidate.identity.keyVersion
  }, candidate.identity.transportKeySignature, candidate.identity.ed25519PublicKey);
  const results = await Promise.all(candidate.advertisedCapabilities.map(async (capability) => {
    let status2 = "degraded";
    if (identityValid && candidate.online) {
      try {
        status2 = await probe(candidate, capability);
      } catch (error) {
        console.error(
          `[verifier] ${candidate.nodeId} ${capability}:`,
          error instanceof Error ? error.message : String(error)
        );
        status2 = "degraded";
      }
    }
    return { capability, status: status2 };
  }));
  const status = identityValid && candidate.online && results.some((entry) => entry.status === "verified") ? "verified" : identityValid ? "degraded" : "quarantined";
  const response = await controlPlane("/v2/nodes/verification", {
    method: "POST",
    body: JSON.stringify({ nodeId: candidate.nodeId, status, capabilities: results })
  });
  if (!response.ok) throw new Error(`Verification update failed: ${response.status}.`);
}
async function runOnce() {
  const response = await controlPlane("/v2/nodes/verification-candidates?limit=20");
  if (!response.ok) throw new Error(`Candidate request failed: ${response.status}.`);
  const payload = await response.json();
  await Promise.allSettled((payload.candidates ?? []).map((candidate) => verifyCandidate(candidate)));
}
await runOnce();
if (process.env.SPILLED_VERIFIER_ONCE !== "1") {
  setInterval(() => void runOnce().catch((error) => console.error("[verifier]", error)), 6e4);
}
