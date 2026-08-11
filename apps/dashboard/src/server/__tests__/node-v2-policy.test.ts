import { describe, expect, it } from "vitest";
import { decideCapability } from "../../../../node/src/capability-policy";
import { decidePublicWork } from "../../../../node/src/resource-governor";
import { SpilledCinemaNodeRuntime } from "../../../../node/src/runtime";
import type { NodeStateFile, NodeStorage } from "../../../../../packages/storage/src";

describe("node v2 capability policy", () => {
  const enabled = new Set(["player.resolve", "download.transient", "library.read"] as const);

  it("does not allow a public ticket to broaden its capability", () => {
    expect(decideCapability({
      principal: { kind: "public", ticketId: "t1", ephemeralKey: "key" },
      capability: "download.transient",
      ticketCapability: "player.resolve",
      enabledCapabilities: enabled,
    })).toEqual({ allow: false, reason: "capability-mismatch" });
  });

  it("keeps node administration private", () => {
    expect(decideCapability({
      principal: { kind: "public", ticketId: "t1", ephemeralKey: "key" },
      capability: "node.admin",
      ticketCapability: "node.admin",
      enabledCapabilities: new Set(["node.admin"]),
    })).toEqual({ allow: false, reason: "principal-not-allowed" });
  });

  it("reserves the full playback resolver budget", () => {
    const decision = decideCapability({
      principal: { kind: "owner", accountId: "watcher", sessionId: "session" },
      capability: "player.resolve",
      enabledCapabilities: enabled,
    });
    expect(decision.allow).toBe(true);
    if (decision.allow) expect(decision.limits.maxDurationMs).toBe(90_000);
  });

  it("preempts public bulk work for local playback", () => {
    expect(decidePublicWork({
      cpuPercent: 20,
      eventLoopP95Ms: 10,
      localPlaybackActive: true,
      privateWorkActive: false,
      networkLatencyIncreaseMs: 0,
      freeDiskBytes: 100,
      diskReserveBytes: 10,
      onBattery: false,
      meteredNetwork: false,
    }, "bulk")).toBe("throttled");
  });

  it("starts as a local-only node with no advertised public endpoint", async () => {
    let state: NodeStateFile = {
      pendingPairings: [],
      pairedDevices: [],
      sessions: [],
      importedShows: [],
      downloads: { updatedAt: 0, episodeIds: [], files: [] },
      spillshareSources: [],
      passkeys: [],
      adminAccounts: [],
      watcherAccounts: [],
      watcherProfiles: [],
      privateAccounts: [],
      privateProfiles: [],
      privateDownloads: [],
      privateAuthChallenges: [],
      refreshSessions: [],
      watcherInvitations: [],
      recoveryStates: [],
      securityEvents: [],
    };
    const storage: NodeStorage = {
      read: async () => structuredClone(state),
      write: async (next) => {
        state = structuredClone(next);
      },
    };
    const runtime = new SpilledCinemaNodeRuntime({ storage, mode: "local" });
    const record = await runtime.getNodeRecord();
    expect(record.endpoints).toEqual([{ protocol: "local", url: "native-ipc" }]);
    expect(Object.values(record.capabilities).every((policy) => policy.visibility === "private")).toBe(true);
  });
});
