const PROBE_COOLDOWN_MS = 30000;

let lastProbeAttemptedAt = 0;
let lastProbeFailedAt = 0;

export function markLocalhostProbeAttempted() {
  lastProbeAttemptedAt = Date.now();
}

export function markLocalhostProbeFailure() {
  lastProbeFailedAt = Date.now();
}

export function isLocalhostProbeOnCooldown() {
  if (lastProbeFailedAt === 0) {
    return false;
  }
  return Date.now() - lastProbeFailedAt < PROBE_COOLDOWN_MS;
}

export function isLocalhostProbeAttempted() {
  return lastProbeAttemptedAt > 0;
}

export function resetLocalhostProbeCache() {
  lastProbeAttemptedAt = 0;
  lastProbeFailedAt = 0;
}
