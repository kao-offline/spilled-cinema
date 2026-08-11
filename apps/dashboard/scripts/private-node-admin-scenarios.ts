import { isDeepStrictEqual } from "node:util";
import { adminCapabilitiesRpc, adminLoginRpc, adminStatusRpc, adminWatcherCreateRpc } from "../src/lib/private-node-admin-rpc";

const cases = [
  ["login", () => adminLoginRpc("owner", "not-a-real-password"), { capability: "node.admin", action: "admin.login", method: "auth.admin.password.login", params: { adminId: "owner", password: "not-a-real-password" } }],
  ["status", () => adminStatusRpc("fixture-token"), { capability: "node.admin", action: "admin.status", method: "node.admin.status", params: { adminToken: "fixture-token" } }],
  ["capabilities", () => adminCapabilitiesRpc("fixture-token", { fetch: false }), { capability: "node.admin", action: "admin.capabilities", method: "node.admin.capabilities.update", params: { adminToken: "fixture-token", capabilities: { fetch: false } } }],
  ["watcher", () => adminWatcherCreateRpc("fixture-token", { watcherId: "family", displayName: "Family", quotaBytes: 1 }), { capability: "node.admin", action: "admin.watcher.create", method: "node.admin.watcher.create", params: { adminToken: "fixture-token", watcherId: "family", displayName: "Family", quotaBytes: 1 } }],
] as const;

let failed = false;
for (const [name, run, expected] of cases) {
  const observed = run();
  const pass = isDeepStrictEqual(observed, expected);
  console.log(`${pass ? "PASS" : "FAIL"} admin-gateway/${name}`);
  if (!pass) failed = true;
}

for (const [name, run] of [["missing-login", () => adminLoginRpc("", "")], ["missing-token", () => adminStatusRpc("")]] as const) {
  try { run(); console.log(`FAIL admin-gateway/${name}`); failed = true; }
  catch { console.log(`PASS admin-gateway/${name}`); }
}

if (process.argv.includes("--self-test-failure")) {
  const detected = !isDeepStrictEqual(adminStatusRpc("fixture-token"), { method: "wrong.method" });
  console.log(`${detected ? "PASS" : "FAIL"} harness/controlled-mismatch-detected`);
  if (!detected) failed = true;
}

if (failed) process.exitCode = 1;
