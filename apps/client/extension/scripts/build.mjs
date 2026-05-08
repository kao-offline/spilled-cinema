import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of ["manifest.json", "background.js", "content.js", "popup.html", "popup.js", "README.md"]) {
  await cp(resolve(root, file), resolve(dist, file), { recursive: true });
}

console.log(`Built Chrome extension into ${dist}`);
