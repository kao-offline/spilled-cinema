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
  it("scopes progress to the authenticated profile and merges concurrent devices without losing newer entries", async () => {
    const { runtime } = await runtimeFixture();
    const login = await runtime.loginWatcherPassword({ watcherId: "watcher", password: "watcher password long", profileId: "main" });
    const now = Date.now();
    const first = { key: "serial:tmdb:1:1:1", position: 120, duration: 1800, watched: false, updatedAt: now };
    const second = { ...first, key: "movie:tmdb:2:1:movie", position: 300 };
    await Promise.all([
      runtime.putPrivatePlaybackProgress(login.accessToken, "main", [first]),
      runtime.putPrivatePlaybackProgress(login.accessToken, "main", [second]),
    ]);
    const merged = await runtime.putPrivatePlaybackProgress(login.accessToken, "main", [{ ...first, position: 5, updatedAt: now - 100 }]);
    expect(Object.keys(merged)).toHaveLength(2);
    expect(merged[first.key].position).toBe(120);
    await expect(runtime.putPrivatePlaybackProgress(undefined, "main", [first])).rejects.toThrow();
    await expect(runtime.putPrivatePlaybackProgress(login.accessToken, "other-profile", [first])).rejects.toThrow();
    await expect(runtime.putPrivatePlaybackProgress(login.accessToken, "main", [{ ...first, position: -1 }])).rejects.toThrow(/invalid/i);
    await runtime.putPrivateLibrary(login.accessToken, "main", { settings: { test: true } });
    expect((await runtime.getPrivateLibrary(login.accessToken, "main")).playbackProgress?.[first.key].position).toBe(120);
    const third = { ...first, key: "serial:tmdb:1:1:2", position: 45, updatedAt: now + 1 };
    await Promise.all([
      runtime.putPrivatePlaybackProgress(login.accessToken, "main", [third]),
      runtime.putPrivateLibrary(login.accessToken, "main", { settings: { test: "concurrent" } }),
    ]);
    const profile = await runtime.getPrivateLibrary(login.accessToken, "main");
    expect(profile.playbackProgress?.[third.key].position).toBe(45);
    expect(profile.settings).toEqual({ test: "concurrent" });
  });

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
