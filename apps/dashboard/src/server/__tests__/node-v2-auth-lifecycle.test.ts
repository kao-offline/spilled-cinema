import { describe, expect, it } from "vitest";
import { SpilledCinemaNodeRuntime } from "../../../../node/src/runtime";
import { hashPassword } from "../../../../../packages/security/src";
import type { NodeStateFile, NodeStorage } from "../../../../../packages/storage/src";

async function runtimeFixture() {
  const now = Date.now();
  let state: NodeStateFile = {
    pendingPairings: [],
    pairedDevices: [],
    sessions: [],
    importedShows: [],
    downloads: { updatedAt: 0, episodeIds: [], files: [] },
    spillshareSources: [],
    passkeys: [],
    adminAccounts: [{
      adminId: "owner",
      displayName: "Owner",
      passwordHash: await hashPassword("correct horse battery staple"),
      passkeys: [],
      createdAt: now,
      updatedAt: now,
    }],
    watcherAccounts: [{
      watcherId: "watcher",
      displayName: "Watcher",
      passwordHash: await hashPassword("watcher password long"),
      passkeys: [],
      quotaBytes: 1024 * 1024,
      createdAt: now,
      updatedAt: now,
    }],
    watcherProfiles: [{
      watcherId: "watcher",
      profileId: "main",
      displayName: "Main",
      avatar: "default",
      createdAt: now,
      updatedAt: now,
    }],
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
    write: async (next) => { state = structuredClone(next); },
  };
  const runtime = new SpilledCinemaNodeRuntime({
    storage,
    mode: "full",
    privateConfig: {
      configPath: "memory",
      storageRoot: "memory",
      privateNode: { enabled: true, nodeName: "Test" },
      accounts: [],
      publicCapabilities: {},
      oidcProviders: [],
      storage: { root: "memory", defaultAccountQuotaBytes: 1024 * 1024 },
    },
  });
  return { runtime, readState: () => state };
}

describe("node v2 authentication lifecycle", () => {
  it("rotates refresh tokens and revokes the chain on reuse", async () => {
    const { runtime, readState } = await runtimeFixture();
    const login = await runtime.loginWatcherPassword({
      watcherId: "watcher",
      password: "watcher password long",
    });
    expect(login.session.expiresAt - login.session.issuedAt).toBe(15 * 60 * 1000);
    const refreshed = await runtime.rotateRefreshSession(login.refreshToken);
    expect(refreshed.refreshToken).not.toBe(login.refreshToken);
    await expect(runtime.rotateRefreshSession(login.refreshToken)).rejects.toThrow(/reuse detected/i);
    expect(readState().securityEvents.at(-1)?.eventType).toBe("refresh-token-reuse");
    expect(readState().refreshSessions.every((entry) => entry.revokedAt)).toBe(true);
  });

  it("creates ten-minute single-use invitations without storing their secret", async () => {
    const { runtime, readState } = await runtimeFixture();
    const login = await runtime.loginAdminPassword({
      adminId: "owner",
      password: "correct horse battery staple",
    });
    const invite = await runtime.createWatcherInvitation(login.accessToken, {
      watcherId: "guest",
      displayName: "Guest",
      quotaBytes: 1024,
    });
    expect(invite.invitationSecret).toHaveLength(22);
    expect(readState().watcherInvitations[0]?.secretHash).not.toContain(invite.invitationSecret);
    await expect(runtime.inspectWatcherInvitation({
      invitationSecret: invite.invitationSecret,
      confirmationCode: "000000",
    })).rejects.toThrow();
    const inspected = await runtime.inspectWatcherInvitation({
      invitationSecret: invite.invitationSecret,
      confirmationCode: invite.confirmationCode,
    });
    expect(inspected.watcherId).toBe("guest");
  });

  it("exports a one-time Argon2id recovery kit and revokes sessions on restore", async () => {
    const { runtime, readState } = await runtimeFixture();
    const login = await runtime.loginAdminPassword({
      adminId: "owner",
      password: "correct horse battery staple",
    });
    const kit = await runtime.exportRecoveryKit(login.accessToken);
    expect(kit.words.split(" ")).toHaveLength(32);
    const restored = await runtime.restoreRecoveryKit({
      recoveryId: kit.recoveryId,
      words: kit.words,
    });
    expect(restored.requiresNewOwnerPasskey).toBe(true);
    expect(readState().sessions).toHaveLength(0);
    await expect(runtime.restoreRecoveryKit({
      recoveryId: kit.recoveryId,
      words: kit.words,
    })).rejects.toThrow(/invalid or already used/i);
  });
});
