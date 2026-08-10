import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  JsonNodeStorage,
  SqliteNodeStorage,
  NodeStateRecoveryError,
  type SecretStore,
} from "../../../../../packages/storage/src";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("node state recovery", () => {
  it("creates defaults only when state does not exist", async () => {
    const directory = await mkdtemp(join(tmpdir(), "spilled-storage-"));
    cleanup.push(directory);
    const state = await new JsonNodeStorage(join(directory, "missing.json")).read();
    expect(state.sessions).toEqual([]);
  });

  it("does not silently replace corrupt state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "spilled-storage-"));
    cleanup.push(directory);
    const path = join(directory, "state.json");
    await writeFile(path, "{broken", "utf8");
    await expect(new JsonNodeStorage(path).read()).rejects.toBeInstanceOf(NodeStateRecoveryError);
  });

  it("keeps private identity keys out of SQLite configuration rows", async () => {
    const directory = await mkdtemp(join(tmpdir(), "spilled-storage-"));
    cleanup.push(directory);
    const secretValues = new Map<string, string>();
    const secrets: SecretStore = {
      get: async (key) => secretValues.get(key) ?? null,
      set: async (key, value) => {
        secretValues.set(key, value);
      },
    };
    const databasePath = join(directory, "node.db");
    const storage = new SqliteNodeStorage(databasePath, secrets);
    await storage.write({
      node: {
        nodeId: "node-1",
        publicKey: "public",
        privateKey: "private-ed25519",
        transportPublicKey: "transport-public",
        transportPrivateKey: "private-x25519",
      },
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
    });
    storage.close();
    const databaseBytes = await import("node:fs/promises").then(({ readFile }) => readFile(databasePath));
    expect(databaseBytes.includes(Buffer.from("private-ed25519"))).toBe(false);
    expect(databaseBytes.includes(Buffer.from("private-x25519"))).toBe(false);
    expect(secretValues.get("node.identity.ed25519.private")).toBe("private-ed25519");
    expect(secretValues.get("node.identity.x25519.private")).toBe("private-x25519");
  });
});
