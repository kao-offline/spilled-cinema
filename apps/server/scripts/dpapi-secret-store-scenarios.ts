import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DpapiSecretStore } from "../../../packages/storage/src/index";

if (process.platform !== "win32") {
  console.log("SKIP DPAPI scenarios require Windows");
  process.exit(0);
}

const directory = await mkdtemp(join(tmpdir(), "spilled-dpapi-test-"));
const protectedKeyFile = join(directory, "master-key.dpapi");
const recordsFile = join(directory, "secrets.json");

try {
  const store = new DpapiSecretStore(protectedKeyFile, recordsFile);
  await Promise.all(Array.from({ length: 12 }, (_, index) => store.set(`key-${index}`, `value-${index}`)));
  const values = await Promise.all(Array.from({ length: 120 }, (_, index) => store.get(`key-${index % 12}`)));
  if (values.some((value, index) => value !== `value-${index % 12}`)) {
    throw new Error("Concurrent DPAPI reads returned the wrong value.");
  }

  const restartedStore = new DpapiSecretStore(protectedKeyFile, recordsFile);
  if (await restartedStore.get("key-7") !== "value-7") {
    throw new Error("A restarted DPAPI store could not decrypt existing records.");
  }
  if ((await readdir(directory)).some((name) => name.endsWith(".active"))) {
    throw new Error("The DPAPI store left a plaintext master-key file behind.");
  }
  console.log("PASS DPAPI cached master key/concurrent reads");
  console.log("PASS DPAPI restart/persisted records");
  console.log("PASS DPAPI no plaintext key file");
} finally {
  await rm(directory, { recursive: true, force: true });
}
