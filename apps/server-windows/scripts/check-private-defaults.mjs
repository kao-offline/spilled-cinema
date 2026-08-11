import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(root, "main.js"), "utf8");
const scenarios = [
  ["loopback bind", /HOST:\s*"127\.0\.0\.1"/, true],
  ["local node mode", /SPILLED_NODE_MODE:\s*"local"/, true],
  ["automatic tunnels disabled", /SPILLED_DISABLE_AUTO_TUNNEL:\s*"1"/, true],
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
