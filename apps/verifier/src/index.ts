import { randomUUID } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import WebSocket from "ws";
import {
  createEncryptedNodeRequest,
  decryptNodeResponse,
  verifyPayload,
} from "../../../packages/security/src/index";
import type {
  Capability,
  CapabilityTicketV2,
  EncryptedResponseEnvelopeV2,
} from "../../../packages/node-protocol/src/index";

type Candidate = {
  nodeId: string;
  online: boolean;
  advertisedCapabilities: Capability[];
  identity: {
    ed25519PublicKey: string;
    x25519PublicKey: string;
    transportKeySignature: string;
    keyVersion: number;
    protocolVersion: number;
  };
};

const baseUrl = process.env.SPILLED_CONTROL_PLANE_URL?.replace(/\/$/, "");
const gatewayUrl = process.env.SPILLED_GATEWAY_URL?.replace(/\/$/, "").replace(/^http/, "ws");
const adminSecret = process.env.SPILLED_CONTROL_PLANE_SECRET;
if (!baseUrl || !gatewayUrl || !adminSecret) {
  throw new Error("SPILLED_CONTROL_PLANE_URL, SPILLED_GATEWAY_URL, and SPILLED_CONTROL_PLANE_SECRET are required.");
}

const configuredProbes = JSON.parse(process.env.SPILLED_VERIFIER_PROBES_JSON || "{}") as Record<
  string,
  { method: string; params: Record<string, unknown>; contentId?: string }
>;
const defaultProbes: typeof configuredProbes = {
  "provider.search": {
    method: "provider.search",
    params: { moduleId: "bombuj", query: "Silo", limit: 1 },
  },
  "provider.feed": {
    method: "provider.feed",
    params: { moduleId: "bombuj", feedId: "latest-movies", limit: 1 },
  },
  "provider.import": {
    method: "provider.import",
    params: { moduleId: "svetserialu", slug: "silo" },
  },
  "player.resolve": {
    method: "player.embed.resolve",
    params: { embedUrl: "https://example.com/spilled-verifier", provider: "verifier" },
  },
};
const actions: Record<string, string> = {
  "provider.search": "search",
  "provider.feed": "feed",
  "provider.import": "import",
  "player.resolve": "resolve",
  "download.transient": "create",
  "spillshare.read": "manifest",
  "relay.stream": "stream",
};

async function controlPlane(path: string, init: RequestInit = {}) {
  return await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Spilled-Control-Plane-Secret": adminSecret!,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
}

async function issueTicket(candidate: Candidate, capability: Capability, contentId?: string) {
  const response = await controlPlane("/v2/tickets", {
    method: "POST",
    body: JSON.stringify({
      nodeId: candidate.nodeId,
      capability,
      action: actions[capability],
      principalKind: "verifier",
      ...(contentId ? { contentId } : {}),
    }),
  });
  if (!response.ok) throw new Error(`Verifier ticket failed: ${response.status}.`);
  return await response.json() as CapabilityTicketV2;
}

async function probe(candidate: Candidate, capability: Capability) {
  const template = configuredProbes[capability] ?? defaultProbes[capability];
  if (!template) return "degraded" as const;
  const ticket = await issueTicket(candidate, capability, template.contentId);
  const requestId = randomUUID();
  const encrypted = createEncryptedNodeRequest({
    nodeTransportPublicKey: candidate.identity.x25519PublicKey,
    requestId,
    ticketId: ticket.ticketId,
    issuedAt: Date.now(),
    expiresAt: ticket.expiresAt,
    plaintext: JSON.stringify({ method: template.method, params: template.params }),
  });
  const protocol = `ticket.${Buffer.from(JSON.stringify(ticket)).toString("base64url")}`;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
    try {
      return await probeOnce(candidate, ticket, requestId, encrypted, protocol);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!lastError.message.includes("4003")) throw lastError;
    }
  }
  throw lastError;
}

async function probeOnce(
  candidate: Candidate,
  ticket: CapabilityTicketV2,
  requestId: string,
  encrypted: ReturnType<typeof createEncryptedNodeRequest>,
  protocol: string,
) {
  const socket = new WebSocket(
    `${gatewayUrl}/v2/nodes/${encodeURIComponent(candidate.nodeId)}/connect?role=client`,
    ["spilled-v2", protocol],
    { handshakeTimeout: 15_000, maxPayload: ticket.maxResponseBytes + 64 * 1024 },
  );
  const response = await new Promise<EncryptedResponseEnvelopeV2>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Capability probe timed out."));
    }, 30_000);
    socket.once("open", () => socket.send(JSON.stringify({
      version: 2,
      requestId,
      ticketId: ticket.ticketId,
      ticket,
      body: JSON.stringify(encrypted.envelope),
    })));
    socket.once("message", (raw) => {
      clearTimeout(timeout);
      try {
        const frame = JSON.parse(raw.toString()) as { body: string };
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
    nodeTransportPublicKey: candidate.identity.x25519PublicKey,
  }).toString("utf8")) as { ok?: boolean };
  return payload.ok ? "verified" as const : "degraded" as const;
}

type PassSummary = {
  lastRunAt: number;
  nodes: number;
  verified: number;
  degraded: number;
  quarantined: number;
  capabilitiesVerified: number;
  capabilitiesTotal: number;
  errors: string[];
};

async function writeStatusFile(summary: PassSummary) {
  const target = process.env.SPILLED_VERIFIER_STATUS_FILE;
  if (!target) return;
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(summary, null, 2));
    await rename(temporary, target);
  } catch (error) {
    console.error("[verifier] status write failed:", error instanceof Error ? error.message : String(error));
  }
}

async function verifyCandidate(candidate: Candidate): Promise<{
  nodeId: string;
  status: "verified" | "degraded" | "quarantined";
  capabilities: Array<{ capability: Capability; status: "verified" | "degraded" | "quarantined" }>;
}> {
  const identityValid =
    candidate.identity.protocolVersion === 2 &&
    verifyPayload({
      nodeId: candidate.nodeId,
      transportPublicKey: candidate.identity.x25519PublicKey,
      keyVersion: candidate.identity.keyVersion,
    }, candidate.identity.transportKeySignature, candidate.identity.ed25519PublicKey);
  const results: Array<{
    capability: Capability;
    status: "verified" | "degraded" | "quarantined";
  }> = [];
  // Probes are deliberately sequential. Import probes can perform substantial
  // provider I/O; running every capability simultaneously caused lightweight
  // player and search checks to time out behind the import workload.
  for (const capability of candidate.advertisedCapabilities) {
    let status: "verified" | "degraded" | "quarantined" = "degraded";
    if (identityValid && candidate.online) {
      try {
        status = await probe(candidate, capability);
      } catch (error) {
        console.error(
          `[verifier] ${candidate.nodeId} ${capability}:`,
          error instanceof Error ? error.message : String(error),
        );
        status = "degraded";
      }
    }
    results.push({ capability, status });
  }
  const status = identityValid && candidate.online && results.some((entry) => entry.status === "verified")
    ? "verified"
    : identityValid ? "degraded" : "quarantined";
  const response = await controlPlane("/v2/nodes/verification", {
    method: "POST",
    body: JSON.stringify({ nodeId: candidate.nodeId, status, capabilities: results }),
  });
  if (!response.ok) throw new Error(`Verification update failed: ${response.status}.`);
  return { nodeId: candidate.nodeId, status, capabilities: results };
}

async function runOnce() {
  const response = await controlPlane("/v2/nodes/verification-candidates?limit=20");
  if (!response.ok) throw new Error(`Candidate request failed: ${response.status}.`);
  const payload = await response.json() as { candidates?: Candidate[] };
  const candidates = payload.candidates ?? [];
  const settled = await Promise.allSettled(candidates.map((candidate) => verifyCandidate(candidate)));
  const errors: string[] = [];
  let verified = 0;
  let degraded = 0;
  let quarantined = 0;
  let capabilitiesVerified = 0;
  let capabilitiesTotal = 0;
  for (const result of settled) {
    if (result.status === "rejected") {
      errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
      continue;
    }
    const candidate = result.value;
    if (candidate.status === "verified") verified += 1;
    else if (candidate.status === "degraded") degraded += 1;
    else quarantined += 1;
    for (const capability of candidate.capabilities) {
      capabilitiesTotal += 1;
      if (capability.status === "verified") capabilitiesVerified += 1;
    }
  }
  await writeStatusFile({
    lastRunAt: Date.now(),
    nodes: candidates.length,
    verified,
    degraded,
    quarantined,
    capabilitiesVerified,
    capabilitiesTotal,
    errors,
  });
}

let passInFlight = false;

async function main() {
  if (passInFlight) return;
  passInFlight = true;
  try {
    await runOnce();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[verifier] pass failed:", message);
    await writeStatusFile({
      lastRunAt: Date.now(),
      nodes: 0,
      verified: 0,
      degraded: 0,
      quarantined: 0,
      capabilitiesVerified: 0,
      capabilitiesTotal: 0,
      errors: [message],
    });
  } finally {
    passInFlight = false;
  }
  if (process.env.SPILLED_VERIFIER_ONCE !== "1") {
    const intervalMs = Number.parseInt(process.env.SPILLED_VERIFIER_INTERVAL_MS || "600000", 10);
    setInterval(() => void main().catch((error) => console.error("[verifier]", error)), Math.max(intervalMs, 60_000));
  }
}

await main();
