import type {
  DiscoveryCandidate,
  DiscoveryQuery,
  DiscoveryResult,
  NodeCapability,
  NodeRecord,
  SpillshareSource,
} from "../../node-protocol/src";
import { verifyPayload } from "../../security/src";

export type NodeObservation = {
  nodeId: string;
  latencyMs?: number;
  successRate?: number;
  loadPercent?: number;
};

export function verifyNodeRecord(record: NodeRecord) {
  const { signature, ...unsigned } = record;
  return verifyPayload(unsigned, signature, record.publicKey);
}

export function scoreNodeCandidate(
  candidate: DiscoveryCandidate,
  query: DiscoveryQuery,
  observation?: NodeObservation,
) {
  const capability = candidate.record.capabilities[query.capability];
  if (!capability) {
    return -Infinity;
  }

  const latency = observation?.latencyMs ?? candidate.latencyMs ?? 10_000;
  const successRate = observation?.successRate ?? candidate.successRate ?? 0.5;
  const loadPercent = observation?.loadPercent ?? candidate.record.load?.relayPercent ?? 0.5;
  const regionBonus = query.regionHint && candidate.record.regionHint === query.regionHint ? 25 : 0;
  const visibilityBonus = capability.visibility === "public" ? 20 : capability.visibility === "paired" ? 10 : 0;

  const latencyScore = Math.max(0, 300 - latency);
  const successScore = Math.round(successRate * 100);
  const loadScore = Math.max(0, 100 - Math.round(loadPercent * 100));
  return latencyScore + successScore + loadScore + regionBonus + visibilityBonus;
}

export function rankDiscoveryCandidates(
  query: DiscoveryQuery,
  candidates: DiscoveryCandidate[],
  observations: NodeObservation[] = [],
): DiscoveryResult {
  const observationMap = new Map(observations.map((entry) => [entry.nodeId, entry]));
  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreNodeCandidate(candidate, query, observationMap.get(candidate.record.nodeId)),
    }))
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0));

  return {
    query,
    candidates: typeof query.limit === "number" ? ranked.slice(0, query.limit) : ranked,
  };
}

export class MemoryDiscoveryRegistry {
  private readonly records = new Map<string, NodeRecord>();
  private readonly spillshare = new Map<string, SpillshareSource[]>();

  publish(record: NodeRecord) {
    this.records.set(record.nodeId, record);
  }

  list(capability?: NodeCapability) {
    const all = Array.from(this.records.values());
    if (!capability) {
      return all;
    }
    return all.filter((record) => Boolean(record.capabilities[capability]));
  }

  publishSpillshare(source: SpillshareSource) {
    const existing = this.spillshare.get(source.contentId) ?? [];
    this.spillshare.set(
      source.contentId,
      existing.filter((entry) => entry.nodeId !== source.nodeId).concat(source),
    );
  }

  lookupSpillshare(contentId: string) {
    return this.spillshare.get(contentId) ?? [];
  }
}

export type MdnsAnnouncement = {
  serviceName: string;
  record: NodeRecord;
};

export class MdnsService {
  private readonly announcements = new Map<string, MdnsAnnouncement>();

  announce(serviceName: string, record: NodeRecord) {
    this.announcements.set(serviceName, { serviceName, record });
  }

  discover() {
    return Array.from(this.announcements.values());
  }
}
