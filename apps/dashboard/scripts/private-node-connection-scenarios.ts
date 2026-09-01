import { formatNodeConnectionCode, normalizeNodeConnectionCode } from "../../../packages/node-protocol/src/index.ts";
import { readFile } from "node:fs/promises";

type Scenario = {
  name: string;
  input: string;
  expected: string | null;
  run: (input: string) => string | null;
};

const scenarios: Scenario[] = [
  {
    name: "format/stable-opaque-locator",
    input: "7a3f19c288b4d0e1f9a11111",
    expected: "7A3F-19C2-88B4-D0E1",
    run: formatNodeConnectionCode,
  },
  {
    name: "normalize/compact-lowercase",
    input: "7a3f19c288b4d0e1",
    expected: "7A3F-19C2-88B4-D0E1",
    run: normalizeNodeConnectionCode,
  },
  {
    name: "normalize/prefixed-and-spaced",
    input: "spilled 7a3f 19c2 88b4 d0e1",
    expected: "7A3F-19C2-88B4-D0E1",
    run: normalizeNodeConnectionCode,
  },
  {
    name: "normalize/incomplete",
    input: "7A3F-19C2",
    expected: null,
    run: normalizeNodeConnectionCode,
  },
  {
    name: "normalize/rejects-non-hex",
    input: "ZZZZ-ZZZZ-ZZZZ-ZZZZ",
    expected: null,
    run: normalizeNodeConnectionCode,
  },
];

const args = process.argv.slice(2);
const filterIndex = args.indexOf("--filter");
const filter = filterIndex >= 0 ? args[filterIndex + 1] ?? "" : "";
const json = args.includes("--format=json");
const proveFailure = args.includes("--self-test-failure");
const selected = scenarios.filter((scenario) => scenario.name.includes(filter));

if (selected.length === 0) {
  console.error(`No private-node connection scenarios match ${JSON.stringify(filter)}.`);
  process.exit(2);
}

const results = selected.map((scenario, index) => {
  const observed = scenario.run(scenario.input);
  const expected = proveFailure && index === 0 ? "CONTROLLED-WRONG-ORACLE" : scenario.expected;
  return { name: scenario.name, input: scenario.input, expected, observed, passed: observed === expected };
});

if (json) console.log(JSON.stringify({ scenarios: results }, null, 2));
else for (const result of results) {
  console.log(`${result.passed ? "PASS" : "FAIL"} ${result.name}: ${JSON.stringify(result.observed)}`);
}

const failed = results.filter((result) => !result.passed);
if (proveFailure) {
  if (failed.length !== 1 || failed[0]?.name !== selected[0]?.name) {
    console.error("Controlled failure self-test did not fail exactly where expected.");
    process.exit(1);
  }
  console.log("PASS runner/self-test: controlled wrong oracle was detected and no source was modified.");
  process.exit(0);
}
if (failed.length > 0) process.exit(1);

const mobileDockSource = await readFile(new URL("../src/components/MobileDock.tsx", import.meta.url), "utf8");
const privateNodeConnectSource = await readFile(new URL("../src/components/PrivateNodeConnectView.tsx", import.meta.url), "utf8");
const mobileEntryAssertions = [
  [mobileDockSource.includes('label: "Server"'), "labeled Server destination"],
  [mobileDockSource.includes('window.location.assign("/connect")'), "direct connection route"],
  [mobileDockSource.includes("grid-cols-5"), "five-item mobile navigation"],
] as const;
for (const [passed, label] of mobileEntryAssertions) {
  console.log(`${passed ? "PASS" : "FAIL"} mobile-entry/${label}`);
  if (!passed) process.exitCode = 1;
}

const privateNodeInputAssertions = [
  [privateNodeConnectSource.includes("value={code}"), "preserves the locator draft while typing"],
  [!privateNodeConnectSource.includes("value={displayLocator(code)}"), "does not rewrite each keystroke as a recovery code"],
  [privateNodeConnectSource.includes('autoCapitalize="none"'), "disables mobile auto-capitalization"],
  [privateNodeConnectSource.includes('spellCheck={false}'), "disables locator spellcheck"],
] as const;
for (const [passed, label] of privateNodeInputAssertions) {
  console.log(`${passed ? "PASS" : "FAIL"} private-node-input/${label}`);
  if (!passed) process.exitCode = 1;
}
