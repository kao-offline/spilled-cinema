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
  verify as cryptoVerify,
} from "node:crypto";
import { chacha20poly1305 } from "@noble/ciphers/chacha";
import type {
  AnonymousSessionGrant,
  PairingApproval,
  PairingRequest,
  PrivateSessionGrant,
  SessionScope,
  Capability,
  CapabilityTicketV2,
  EncryptedRequestEnvelopeV2,
  EncryptedResponseEnvelopeV2,
} from "../../node-protocol/src";

type Serializable = Record<string, unknown>;

export type NodeIdentity = {
  nodeId: string;
  publicKey: string;
  privateKey: string;
  algorithm: "ed25519";
};

export type NodeTransportIdentity = {
  publicKey: string;
  privateKey: string;
  algorithm: "x25519";
  keyVersion: number;
  identitySignature: string;
};

export type StoredSession = {
  sessionId: string;
  kind: "anonymous" | "private" | "watcher" | "admin";
  token: string;
  expiresAt: number;
  scope: SessionScope;
  pairedDeviceId?: string;
};

export type PasswordHash = {
  algorithm: "argon2id";
  encoded: string;
} | {
  algorithm: "scrypt";
  salt: string;
  key: string;
  N: number;
  r: number;
  p: number;
  keyLength: number;
};

export type PairedDevice = {
  pairedDeviceId: string;
  deviceName: string;
  pairedAt: number;
  token: string;
};

export function base64UrlEncode(buffer: Buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlDecode(value: string) {
  const pad = "===".slice((value.length + 3) % 4);
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(",")}}`;
}

export function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function randomId(prefix: string) {
  return `${prefix}_${base64UrlEncode(randomBytes(12))}`;
}

export async function hashPassword(password: string): Promise<PasswordHash> {
  const { hash: hashArgon2 } = await import("@node-rs/argon2");
  return {
    algorithm: "argon2id",
    encoded: await hashArgon2(password, {
      algorithm: 2,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    }),
  };
}

export async function verifyPassword(password: string, hash: PasswordHash): Promise<boolean> {
  if (hash.algorithm === "argon2id") {
    const { verify: verifyArgon2 } = await import("@node-rs/argon2");
    return await verifyArgon2(hash.encoded, password);
  }
  if (hash.algorithm !== "scrypt") {
    return false;
  }
  const expected = base64UrlDecode(hash.key);
  const actual = scryptSync(password, hash.salt, hash.keyLength, {
    N: hash.N,
    r: hash.r,
    p: hash.p,
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function generateNodeIdentity(): NodeIdentity {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const nodeId = `node_${sha256(publicPem).slice(0, 24)}`;

  return {
    nodeId,
    publicKey: publicPem,
    privateKey: privatePem,
    algorithm: "ed25519",
  };
}

export function generateNodeTransportIdentity(identity: NodeIdentity, keyVersion = 1): NodeTransportIdentity {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return {
    publicKey: publicPem,
    privateKey: privatePem,
    algorithm: "x25519",
    keyVersion,
    identitySignature: signPayload({
      nodeId: identity.nodeId,
      transportPublicKey: publicPem,
      keyVersion,
    }, identity.privateKey),
  };
}

function deriveTransportKey(sharedSecret: Buffer, requestId: string, ticketId: string) {
  return Buffer.from(hkdfSync(
    "sha256",
    sharedSecret,
    Buffer.from(requestId, "utf8"),
    Buffer.from(`spilled-node-v2:${ticketId}`, "utf8"),
    32,
  ));
}

function encryptChaCha20Poly1305(key: Buffer, nonce: Buffer, aad: Buffer, plaintext: Buffer) {
  const sealed = chacha20poly1305(key, nonce, aad).encrypt(plaintext);
  return {
    ciphertext: Buffer.from(sealed.subarray(0, -16)),
    authenticationTag: Buffer.from(sealed.subarray(-16)),
  };
}

function decryptChaCha20Poly1305(
  key: Buffer,
  nonce: Buffer,
  aad: Buffer,
  ciphertext: Buffer,
  authenticationTag: Buffer,
) {
  return Buffer.from(chacha20poly1305(key, nonce, aad).decrypt(Buffer.concat([
    ciphertext,
    authenticationTag,
  ])));
}

function transportAad(envelope: Pick<
  EncryptedRequestEnvelopeV2,
  "version" | "requestId" | "ticketId" | "issuedAt" | "expiresAt" | "nonce" | "clientEphemeralKey"
>) {
  return Buffer.from(stableStringify(envelope), "utf8");
}

export function encryptNodeRequest(input: {
  nodeTransportPublicKey: string;
  requestId: string;
  ticketId: string;
  issuedAt: number;
  expiresAt: number;
  plaintext: Buffer | string;
}): EncryptedRequestEnvelopeV2 {
  return createEncryptedNodeRequest(input).envelope;
}

export function createEncryptedNodeRequest(input: {
  nodeTransportPublicKey: string;
  requestId: string;
  ticketId: string;
  issuedAt: number;
  expiresAt: number;
  plaintext: Buffer | string;
}) {
  const ephemeral = generateKeyPairSync("x25519");
  const ephemeralPublicKey = ephemeral.publicKey.export({ type: "spki", format: "pem" }).toString();
  const nonce = randomBytes(24);
  const envelopeHeader = {
    version: 2 as const,
    requestId: input.requestId,
    ticketId: input.ticketId,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    nonce: base64UrlEncode(nonce),
    clientEphemeralKey: ephemeralPublicKey,
  };
  const sharedSecret = diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: createPublicKey(input.nodeTransportPublicKey),
  });
  const key = deriveTransportKey(sharedSecret, input.requestId, input.ticketId);
  const cipherNonce = createHash("sha256").update(nonce).digest().subarray(0, 12);
  const plaintext = typeof input.plaintext === "string" ? Buffer.from(input.plaintext, "utf8") : input.plaintext;
  const encrypted = encryptChaCha20Poly1305(key, cipherNonce, transportAad(envelopeHeader), plaintext);
  const envelope: EncryptedRequestEnvelopeV2 = {
    ...envelopeHeader,
    ciphertext: base64UrlEncode(encrypted.ciphertext),
    authenticationTag: base64UrlEncode(encrypted.authenticationTag),
  };
  return {
    envelope,
    clientEphemeralPrivateKey: ephemeral.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

export function decryptNodeRequest(
  envelope: EncryptedRequestEnvelopeV2,
  nodeTransportPrivateKey: string,
  now = Date.now(),
) {
  if (envelope.version !== 2 || envelope.issuedAt > now + 30_000 || envelope.expiresAt < now) {
    throw new Error("Encrypted request envelope is outside its validity window.");
  }
  const sharedSecret = diffieHellman({
    privateKey: createPrivateKey(nodeTransportPrivateKey),
    publicKey: createPublicKey(envelope.clientEphemeralKey),
  });
  const key = deriveTransportKey(sharedSecret, envelope.requestId, envelope.ticketId);
  const nonce = base64UrlDecode(envelope.nonce);
  if (nonce.length !== 24) {
    throw new Error("Encrypted request nonce must be 192 bits.");
  }
  const cipherNonce = createHash("sha256").update(nonce).digest().subarray(0, 12);
  const ciphertext = base64UrlDecode(envelope.ciphertext);
  return decryptChaCha20Poly1305(key, cipherNonce, transportAad({
    version: envelope.version,
    requestId: envelope.requestId,
    ticketId: envelope.ticketId,
    issuedAt: envelope.issuedAt,
    expiresAt: envelope.expiresAt,
    nonce: envelope.nonce,
    clientEphemeralKey: envelope.clientEphemeralKey,
  }), ciphertext, base64UrlDecode(envelope.authenticationTag));
}

function responseAad(response: Pick<
  EncryptedResponseEnvelopeV2,
  "version" | "requestId" | "ticketId" | "issuedAt" | "nonce"
>) {
  return Buffer.from(stableStringify(response), "utf8");
}

export function encryptNodeResponse(input: {
  request: EncryptedRequestEnvelopeV2;
  nodeTransportPrivateKey: string;
  plaintext: Buffer | string;
  issuedAt?: number;
}): EncryptedResponseEnvelopeV2 {
  const sharedSecret = diffieHellman({
    privateKey: createPrivateKey(input.nodeTransportPrivateKey),
    publicKey: createPublicKey(input.request.clientEphemeralKey),
  });
  const key = deriveTransportKey(sharedSecret, input.request.requestId, input.request.ticketId);
  const nonce = randomBytes(24);
  const header = {
    version: 2 as const,
    requestId: input.request.requestId,
    ticketId: input.request.ticketId,
    issuedAt: input.issuedAt ?? Date.now(),
    nonce: base64UrlEncode(nonce),
  };
  const plaintext = typeof input.plaintext === "string" ? Buffer.from(input.plaintext, "utf8") : input.plaintext;
  const cipherNonce = createHash("sha256").update(nonce).digest().subarray(0, 12);
  const encrypted = encryptChaCha20Poly1305(key, cipherNonce, responseAad(header), plaintext);
  return {
    ...header,
    ciphertext: base64UrlEncode(encrypted.ciphertext),
    authenticationTag: base64UrlEncode(encrypted.authenticationTag),
  };
}

export function decryptNodeResponse(input: {
  response: EncryptedResponseEnvelopeV2;
  request: EncryptedRequestEnvelopeV2;
  clientEphemeralPrivateKey: string;
  nodeTransportPublicKey: string;
}) {
  if (
    input.response.version !== 2 ||
    input.response.requestId !== input.request.requestId ||
    input.response.ticketId !== input.request.ticketId
  ) {
    throw new Error("Encrypted response does not match its request.");
  }
  const sharedSecret = diffieHellman({
    privateKey: createPrivateKey(input.clientEphemeralPrivateKey),
    publicKey: createPublicKey(input.nodeTransportPublicKey),
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
    nonce: input.response.nonce,
  }), ciphertext, base64UrlDecode(input.response.authenticationTag));
}

export class TicketReplayWindow {
  private readonly accepted = new Map<string, number>();

  accept(ticketId: string, nonce: string, expiresAt: number, now = Date.now()) {
    for (const [key, expiry] of this.accepted) {
      if (expiry <= now) {
        this.accepted.delete(key);
      }
    }
    const key = `${ticketId}:${nonce}`;
    if (this.accepted.has(key)) {
      return false;
    }
    this.accepted.set(key, expiresAt);
    return true;
  }
}

export function verifyCapabilityTicket(input: {
  ticket: CapabilityTicketV2;
  controlPlanePublicKey: string;
  expectedNodeId: string;
  expectedCapability: Capability;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const { signature, ...payload } = input.ticket;
  if (
    input.ticket.version !== 2 ||
    input.ticket.nodeId !== input.expectedNodeId ||
    input.ticket.capability !== input.expectedCapability ||
    input.ticket.issuedAt > now + 30_000 ||
    input.ticket.expiresAt <= now
  ) {
    return false;
  }
  return verifyPayload(payload, signature, input.controlPlanePublicKey);
}

export function signPayload(payload: Serializable, privateKeyPem: string) {
  const body = stableStringify(payload);
  return base64UrlEncode(cryptoSign(null, Buffer.from(body), privateKeyPem));
}

export function verifyPayload(payload: Serializable, signature: string, publicKeyPem: string) {
  const body = stableStringify(payload);
  return cryptoVerify(null, Buffer.from(body), publicKeyPem, base64UrlDecode(signature));
}

export function createSignedToken(payload: Serializable, privateKeyPem: string) {
  const encodedPayload = base64UrlEncode(Buffer.from(stableStringify(payload), "utf8"));
  const signature = signPayload({ payload: encodedPayload }, privateKeyPem);
  return `${encodedPayload}.${signature}`;
}

export function verifySignedToken<T extends Serializable>(token: string, publicKeyPem: string): T | null {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  if (!verifyPayload({ payload: encodedPayload }, signature, publicKeyPem)) {
    return null;
  }

  try {
    return JSON.parse(base64UrlDecode(encodedPayload).toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function issueAnonymousSession(input: {
  nodeId: string;
  scope: SessionScope;
  ttlMs: number;
  privateKeyPem: string;
}): AnonymousSessionGrant {
  const sessionId = randomId("anon");
  const expiresAt = Date.now() + input.ttlMs;
  const token = createSignedToken(
    {
      kind: "anonymous",
      sessionId,
      nodeId: input.nodeId,
      scope: input.scope,
      expiresAt,
    },
    input.privateKeyPem,
  );

  return {
    kind: "anonymous",
    sessionId,
    token,
    expiresAt,
    scope: input.scope,
    nodeId: input.nodeId,
  };
}

export function createPairingRequest(input: { deviceName: string; ttlMs: number }): PairingRequest {
  const pairingId = randomId("pair");
  const code = randomBytes(3).toString("hex").toUpperCase();
  const requestedAt = Date.now();
  return {
    pairingId,
    deviceName: input.deviceName,
    requestedAt,
    expiresAt: requestedAt + input.ttlMs,
    code,
  };
}

export function approvePairing(input: {
  nodeId: string;
  pairing: PairingRequest;
  privateKeyPem: string;
}): PairingApproval & { device: PairedDevice } {
  const pairedDeviceId = randomId("device");
  const approvedAt = Date.now();
  const token = createSignedToken(
    {
      kind: "paired-device",
      nodeId: input.nodeId,
      pairedDeviceId,
      deviceName: input.pairing.deviceName,
      approvedAt,
    },
    input.privateKeyPem,
  );

  return {
    pairingId: input.pairing.pairingId,
    pairedDeviceId,
    approvedAt,
    token,
    device: {
      pairedDeviceId,
      deviceName: input.pairing.deviceName,
      pairedAt: approvedAt,
      token,
    },
  };
}

export function issuePrivateSession(input: {
  nodeId: string;
  pairedDeviceId: string;
  scope: SessionScope;
  ttlMs: number;
  privateKeyPem: string;
}): PrivateSessionGrant {
  const sessionId = randomId("priv");
  const expiresAt = Date.now() + input.ttlMs;
  const token = createSignedToken(
    {
      kind: "private",
      sessionId,
      nodeId: input.nodeId,
      pairedDeviceId: input.pairedDeviceId,
      scope: input.scope,
      expiresAt,
    },
    input.privateKeyPem,
  );

  return {
    kind: "private",
    sessionId,
    token,
    expiresAt,
    pairedDeviceId: input.pairedDeviceId,
    scope: input.scope,
    nodeId: input.nodeId,
  };
}

export function createPasskeyRegistrationChallenge() {
  return {
    challenge: base64UrlEncode(randomBytes(32)),
    userVerification: "preferred" as const,
    attestation: "none" as const,
  };
}

export function createPasskeyAuthenticationChallenge() {
  return {
    challenge: base64UrlEncode(randomBytes(32)),
    userVerification: "preferred" as const,
  };
}
