import type {
  Capability,
  PolicyDecision,
  Principal,
  ResourceLimits,
} from "../../../packages/node-protocol/src";

const LIGHTWEIGHT_LIMITS: ResourceLimits = {
  maxRequestBytes: 256 * 1024,
  maxResponseBytes: 4 * 1024 * 1024,
  maxDurationMs: 30_000,
  maxConcurrentJobs: 4,
  maxTemporaryBytes: 0,
};

const PLAYER_RESOLVE_LIMITS: ResourceLimits = {
  ...LIGHTWEIGHT_LIMITS,
  maxDurationMs: 90_000,
};

const BULK_LIMITS: ResourceLimits = {
  maxRequestBytes: 256 * 1024,
  maxResponseBytes: 10 * 1024 * 1024 * 1024,
  maxDurationMs: 90 * 60 * 1_000,
  maxConcurrentJobs: 2,
  maxTemporaryBytes: 10 * 1024 * 1024 * 1024,
};

const PUBLIC_CAPABILITIES = new Set<Capability>([
  "provider.search",
  "provider.feed",
  "provider.import",
  "player.resolve",
  "download.transient",
  "spillshare.read",
  "relay.stream",
]);

const WATCHER_CAPABILITIES = new Set<Capability>([
  "provider.search",
  "provider.feed",
  "provider.import",
  "player.resolve",
  "download.private",
  "spillshare.read",
  "library.read",
  "library.write",
]);

export type PolicyRequest = {
  principal: Principal;
  capability: Capability;
  enabledCapabilities: ReadonlySet<Capability>;
  ticketCapability?: Capability;
  resourceAvailable?: boolean;
};

function limitsFor(capability: Capability) {
  if (capability === "player.resolve") return PLAYER_RESOLVE_LIMITS;
  return capability === "download.transient" || capability === "spillshare.read" || capability === "relay.stream"
    ? BULK_LIMITS
    : LIGHTWEIGHT_LIMITS;
}

export function decideCapability(request: PolicyRequest): PolicyDecision {
  if (request.resourceAvailable === false) {
    return { allow: false, reason: "resource-unavailable" };
  }
  if (!request.enabledCapabilities.has(request.capability)) {
    return { allow: false, reason: "capability-disabled" };
  }

  const { principal, capability } = request;
  if (principal.kind === "local-install" || principal.kind === "owner") {
    return { allow: true, limits: limitsFor(capability), auditClass: `${principal.kind}:${capability}` };
  }
  if (principal.kind === "watcher") {
    return WATCHER_CAPABILITIES.has(capability)
      ? { allow: true, limits: limitsFor(capability), auditClass: `watcher:${capability}` }
      : { allow: false, reason: "principal-not-allowed" };
  }
  if (principal.kind === "public") {
    if (request.ticketCapability !== capability) {
      return { allow: false, reason: "capability-mismatch" };
    }
    return PUBLIC_CAPABILITIES.has(capability)
      ? { allow: true, limits: limitsFor(capability), auditClass: `public:${capability}` }
      : { allow: false, reason: "principal-not-allowed" };
  }
  if (principal.kind === "gateway-verifier") {
    return request.ticketCapability === capability
      ? { allow: true, limits: LIGHTWEIGHT_LIMITS, auditClass: `verifier:${capability}` }
      : { allow: false, reason: "capability-mismatch" };
  }
  return { allow: false, reason: "principal-not-allowed" };
}
