import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(root, "main.js"), "utf8");
const scenarios = [
  ["loopback bind", /HOST:\s*"127\.0\.0\.1"/],
  ["local node mode", /SPILLED_NODE_MODE:\s*"local"/],
  ["automatic tunnels disabled", /SPILLED_DISABLE_AUTO_TUNNEL:\s*"1"/],
  ["anonymous public capabilities empty", /SPILLED_PUBLIC_CAPABILITIES:\s*""/],
];

let failed = false;
for (const [name, pattern] of scenarios) {
  if (pattern.test(source)) console.log(`PASS privacy/${name}`);
  else {
    failed = true;
    console.error(`FAIL privacy/${name}`);
  }
}
if (failed) process.exitCode = 1;
