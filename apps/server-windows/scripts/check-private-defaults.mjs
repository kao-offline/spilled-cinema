import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(root, "main.js"), "utf8");
const scenarios = [
  ["loopback bind", /HOST:\s*"127\.0\.0\.1"/, true],
  ["node mode is derived from private config", /SPILLED_NODE_MODE\s*:/, false],
  ["playback tunnel is not disabled by the Windows host", /SPILLED_DISABLE_AUTO_TUNNEL\s*:/, false],
  ["public capabilities are not overridden outside private config", /SPILLED_PUBLIC_CAPABILITIES\s*:/, false],
];

let failed = false;
for (const [name, pattern, expected] of scenarios) {
  if (pattern.test(source) === expected) console.log(`PASS privacy/${name}`);
  else {
    failed = true;
    console.error(`FAIL privacy/${name}`);
  }
}
if (failed) process.exitCode = 1;
