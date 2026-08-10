import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = resolve(repoRoot, "apps/server-windows");
const payloadRoot = resolve(packageRoot, "server");
await rm(payloadRoot, { recursive: true, force: true });
await mkdir(payloadRoot, { recursive: true });
await cp(resolve(repoRoot, "apps/server/dist"), payloadRoot, { recursive: true });
await cp(resolve(repoRoot, "apps/icon-dark-rounded.png"), resolve(packageRoot, "icon.png"));
console.log("Prepared the self-contained Windows server payload.");
