import {
  createHash,
  timingSafeEqual,
  generateKeyPairSync,
  randomBytes,
  scryptSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";
import type {
  AnonymousSessionGrant,
  PairingApproval,
  PairingRequest,
  PrivateSessionGrant,
  SessionScope,
} from "../../node-protocol/src";

type Serializable = Record<string, unknown>;

export type NodeIdentity = {
  nodeId: string;
  publicKey: string;
  privateKey: string;
  algorithm: "ed25519";
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
  algorithm: "scrypt";
  salt: string;
  key: string;
  N: number;
  r: number;
  p: number;
  keyLength: number;
};

const DEFAULT_PASSWORD_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  keyLength: 64,
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
  const salt = base64UrlEncode(randomBytes(16));
  const key = scryptSync(password, salt, DEFAULT_PASSWORD_PARAMS.keyLength, {
    N: DEFAULT_PASSWORD_PARAMS.N,
    r: DEFAULT_PASSWORD_PARAMS.r,
    p: DEFAULT_PASSWORD_PARAMS.p,
  });
  return {
    algorithm: "scrypt",
    salt,
    key: base64UrlEncode(key),
    ...DEFAULT_PASSWORD_PARAMS,
  };
}

export async function verifyPassword(password: string, hash: PasswordHash): Promise<boolean> {
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
