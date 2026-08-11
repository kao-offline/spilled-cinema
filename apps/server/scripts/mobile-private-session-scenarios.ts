import { readFile } from "node:fs/promises";
import { getV2GatewayOperation } from "../../dashboard/src/lib/gateway-operation";
import { privateSessionScopeForRemoteMethod } from "../src/v2-rpc";

const cases = [
  ["search", "/api/provider-search", "provider.search", "provider.search"],
  ["feed", "/api/provider-feed", "provider.feed", "provider.feed"],
  ["import", "/api/provider-import", "provider.import", "provider.import"],
  ["playback", "/api/player/playback-resolve", "player.resolve", "player.playback.resolve"],
] as const;

const controlledFailure = process.argv.includes("--self-test-failure");
let failures = 0;
for (const [name, path, capability, method] of cases) {
  const operation = getV2GatewayOperation(path, { fixture: name });
  const expectedCapability = controlledFailure && name === "search" ? "wrong.capability" : capability;
  const passed = operation?.capability === expectedCapability && operation.method === method && privateSessionScopeForRemoteMethod(method) === "library";
  console.log(`${passed ? "PASS" : "FAIL"} mobile-private/${name}`);
  if (!passed) failures += 1;
}

const root = new URL("../../../", import.meta.url);
const [controlPlane, connectView, mobileHome] = await Promise.all([
  readFile(new URL("convex/http.ts", root), "utf8"),
  readFile(new URL("apps/dashboard/src/components/PrivateNodeConnectView.tsx", root), "utf8"),
  readFile(new URL("apps/dashboard/src/components/MobileHomePage.tsx", root), "utf8"),
]);
const privateCapabilityBlock = controlPlane.match(/const privateCapabilities = \[([\s\S]*?)\];/)?.[1] ?? "";
const invariants = [
  [cases.every(([, , capability]) => privateCapabilityBlock.includes(`"${capability}"`)), "control-plane private capability whitelist"],
  [connectView.includes("logoutPrivateNodeViaGateway") && connectView.includes("Log out"), "mobile logout"],
  [mobileHome.includes('activeTab === "home" && !privateNodeConnected'), "connected Home banner hidden"],
] as const;
for (const [passed, name] of invariants) {
  console.log(`${passed ? "PASS" : "FAIL"} mobile-private/${name}`);
  if (!passed) failures += 1;
}

if (controlledFailure) {
  if (failures !== 1) throw new Error(`Controlled failure expected exactly one failure, observed ${failures}.`);
  console.log("PASS mobile-private/controlled failure detected");
} else if (failures) {
  process.exitCode = 1;
}
