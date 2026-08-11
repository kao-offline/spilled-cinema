import { renderSetupWizard } from "../src/setup-wizard";

type Scenario = {
  name: string;
  html: string;
  expected: string[];
  rejected?: string[];
};

const permanentCode = "7A3F-19C2-88B4-D0E1";
const credentialRecovery = {
  token: "local-only-token",
  expiresAt: Date.now() + 60_000,
  admin: { adminId: "owner", displayName: "Owner", hasPassword: true },
  watchers: [{ watcherId: "watcher_owner", displayName: "Owner", hasPassword: false }],
};
const scenarios: Scenario[] = [
  {
    name: "configured server console",
    html: renderSetupWizard({ setupCode: "", setupRequired: false, suggestedNodeName: "Cinema Server", connectionCode: permanentCode, credentialRecovery }),
    expected: [permanentCode, 'data-console-tab="connect"', 'data-console-tab="accounts"', 'data-console-tab="manage"', 'data-console-tab="diagnostics"', "owner", "password not set", "/api/node/local-credentials", "openAdmin", "/api/status"],
  },
  {
    name: "fresh setup",
    html: renderSetupWizard({ setupCode: "setup-once", setupRequired: true, suggestedNodeName: "Cinema Server", connectionCode: permanentCode, credentialRecovery: null }),
    expected: ["First run", "Finish setup", permanentCode, 'password:document.getElementById("password").value'],
  },
  {
    name: "script-safe bootstrap",
    html: renderSetupWizard({ setupCode: "</script><script>alert(1)</script>", setupRequired: true, suggestedNodeName: "Safe", connectionCode: permanentCode, credentialRecovery: null }),
    expected: ["\\u003c/script>"],
    rejected: ["</script><script>alert(1)</script>"],
  },
];

if (process.argv.includes("--self-test-failure")) {
  scenarios.push({ name: "controlled mismatch", html: "actual", expected: ["intentionally absent"] });
}

let failures = 0;
for (const scenario of scenarios) {
  const missing = scenario.expected.filter((value) => !scenario.html.includes(value));
  const present = (scenario.rejected ?? []).filter((value) => scenario.html.includes(value));
  if (missing.length || present.length) {
    failures += 1;
    console.error(`FAIL ${scenario.name}: missing [${missing.join(", ")}], rejected [${present.join(", ")}]`);
  } else {
    console.log(`PASS ${scenario.name}`);
  }
}

if (failures) process.exitCode = 1;
