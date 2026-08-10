import { copyFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import {
  JsonNodeStorage,
  MasterKeyFileSecretStore,
  SqliteNodeStorage,
} from "../packages/storage/src";

function requireArgument(name: string, value: string | undefined) {
  if (!value?.trim()) {
    throw new Error(`${name} is required.`);
  }
  return resolve(value);
}

const jsonPath = requireArgument("SPILLED_LEGACY_STATE_FILE", process.env.SPILLED_LEGACY_STATE_FILE);
const databasePath = requireArgument("SPILLED_NODE_DATABASE", process.env.SPILLED_NODE_DATABASE);
const masterKeyPath = requireArgument("SPILLED_MASTER_KEY_FILE", process.env.SPILLED_MASTER_KEY_FILE);
const secretsPath = resolve(process.env.SPILLED_SECRET_RECORDS_FILE || `${databasePath}.secrets`);
const backupPath = `${jsonPath}.v1-backup-${Date.now()}`;

const sourceBytes = await readFile(jsonPath);
const sourceChecksum = createHash("sha256").update(sourceBytes).digest("hex");
await mkdir(dirname(databasePath), { recursive: true });
await copyFile(jsonPath, backupPath);

const source = await new JsonNodeStorage(jsonPath).read();
const secrets = new MasterKeyFileSecretStore(masterKeyPath, secretsPath);
const destination = new SqliteNodeStorage(databasePath, secrets);

try {
  await destination.write(source);
  const migrated = await destination.read();
  const checks: Array<[string, number, number]> = [
    ["admin accounts", source.adminAccounts.length, migrated.adminAccounts.length],
    ["watcher accounts", source.watcherAccounts.length, migrated.watcherAccounts.length],
    ["profiles", source.privateProfiles.length + source.watcherProfiles.length, migrated.privateProfiles.length + migrated.watcherProfiles.length],
    ["passkeys", source.passkeys.length, migrated.passkeys.length],
    ["sessions", source.sessions.length, migrated.sessions.length],
    ["downloads", source.privateDownloads.length, migrated.privateDownloads.length],
    ["SpillShare records", source.spillshareSources.length, migrated.spillshareSources.length],
  ];
  const mismatch = checks.find(([, before, after]) => before !== after);
  if (mismatch) {
    throw new Error(`Migration verification failed for ${mismatch[0]} (${mismatch[1]} != ${mismatch[2]}).`);
  }
  if (source.node?.nodeId !== migrated.node?.nodeId || source.node?.publicKey !== migrated.node?.publicKey) {
    throw new Error("Migration verification failed for node identity.");
  }
  console.log(JSON.stringify({
    ok: true,
    databasePath,
    secretsPath,
    backupPath,
    sourceChecksum,
    checks: Object.fromEntries(checks.map(([label, before]) => [label, before])),
  }, null, 2));
} finally {
  destination.close();
}
