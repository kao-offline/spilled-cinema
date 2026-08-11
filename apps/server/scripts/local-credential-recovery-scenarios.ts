import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SpilledCinemaNodeRuntime } from "../../node/src/runtime";
import { JsonNodeStorage } from "../../../packages/storage/src";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function rejects(action: () => Promise<unknown>, expected: string) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof Error && error.message.includes(expected), `Expected rejection containing "${expected}".`);
    return;
  }
  throw new Error(`Expected rejection containing "${expected}".`);
}

const root = await mkdtemp(join(tmpdir(), "spilled-local-recovery-"));
try {
  const runtime = new SpilledCinemaNodeRuntime({
    storage: new JsonNodeStorage(join(root, "state.json")),
    privateSetupEnabled: true,
    privateConfigPath: join(root, "private-node.json"),
  });
  const setup = await runtime.getSetupCodeForTerminal();
  assert(setup?.setupCode, "Expected a one-time setup code.");
  await runtime.completePrivateSetup({
    setupCode: setup!.setupCode,
    dashboardOrigin: "http://127.0.0.1:8787",
    nodeName: "Recovery Test",
    admin: { adminId: "owner", displayName: "Owner", password: "old-owner-password" },
    initialWatchers: [{
      watcherId: "watcher_owner",
      displayName: "Owner",
      quotaBytes: 1024,
      profiles: [{ profileId: "prof_owner", displayName: "Owner" }],
    }],
    publicCapabilities: { fetch: false, search: false, import: false, stream: false, download: false, spillshare: false, relay: false },
  });

  const before = await runtime.getStatus();
  assert(before.auth.adminPasswordEnabled, "Owner password should exist after setup.");
  assert(!before.auth.watcherPasswordEnabled, "Fixture should reproduce a viewing account without a password.");
  assert(Object.values(before.node.capabilities).every((capability) => capability.visibility === "private"), "Recovery fixture must remain entirely private.");

  const recovery = await runtime.createLocalCredentialRecovery();
  assert(recovery.admin.adminId === "owner", "Recovery should expose the exact settings username locally.");
  assert(recovery.watchers.length === 1 && !recovery.watchers[0]?.hasPassword, "Recovery should identify the missing viewing password.");
  await rejects(() => runtime.resetLocalCredentials({ token: "wrong", adminPassword: "new-owner-password" }), "expired");

  const result = await runtime.resetLocalCredentials({
    token: recovery.token,
    adminPassword: "new-owner-password",
    watcherId: "watcher_owner",
    watcherPassword: "new-viewer-password",
  });
  assert(result.ownerPasswordReset && result.watcherPasswordReset, "Both credential classes should be reset together.");
  await runtime.loginAdminPassword({ adminId: "owner", password: "new-owner-password" });
  await runtime.loginWatcherPassword({ watcherId: "watcher_owner", password: "new-viewer-password", profileId: "prof_owner" });
  await rejects(() => runtime.loginAdminPassword({ adminId: "owner", password: "old-owner-password" }), "Invalid username");
  await rejects(() => runtime.resetLocalCredentials({ token: recovery.token, adminPassword: "another-password" }), "expired");

  const after = await runtime.getStatus();
  assert(after.auth.adminPasswordEnabled && after.auth.watcherPasswordEnabled, "Both password methods should be enabled after recovery.");
  assert(Object.values(after.node.capabilities).every((capability) => capability.visibility === "private"), "Credential recovery must not enable sharing.");

  if (process.argv.includes("--self-test-failure")) {
    assert(after.node.capabilities.fetch.visibility === "public", "Controlled failure: sharing unexpectedly stayed private.");
  }
  console.log("PASS local recovery/missing viewing password");
  console.log("PASS local recovery/owner and viewing reset");
  console.log("PASS local recovery/one-time token");
  console.log("PASS local recovery/privacy unchanged");
} finally {
  await rm(root, { recursive: true, force: true });
}
