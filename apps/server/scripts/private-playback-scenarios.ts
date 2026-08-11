import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { decideCapability } from "../../node/src/capability-policy";
import { getPrivatePlaybackOperation } from "../../dashboard/src/lib/private-playback-operation";
import { resolvePlaybackStream, setPlaybackProxyEndpointUrl } from "../../dashboard/src/server/full-download";

const controlledFailure = process.argv.includes("--self-test-failure");
let failures = 0;

function check(name: string, condition: boolean, detail: string) {
  if (condition) {
    console.log(`PASS ${name}`);
    return;
  }
  failures += 1;
  console.error(`FAIL ${name}: ${detail}`);
}

const operations = [
  ["/api/player/resolve", "player.embed.resolve"],
  ["/api/player/clean-resolve", "player.clean.resolve"],
  ["/api/player/playback-resolve", "player.playback.resolve"],
] as const;
for (const [path, method] of operations) {
  check(`route ${path}`, getPrivatePlaybackOperation(path, {})?.method === method, `expected ${method}`);
}
check("route scope", getPrivatePlaybackOperation("/api/provider-search", {}) === null, "non-player route was captured");

const decision = decideCapability({
  principal: { kind: "owner", accountId: "watcher", sessionId: "session" },
  capability: "player.resolve",
  enabledCapabilities: new Set(["player.resolve"]),
});
const expectedDuration = controlledFailure ? 30_000 : 90_000;
check(
  "player resolver budget",
  decision.allow && decision.limits.maxDurationMs === expectedDuration,
  `expected ${expectedDuration}ms`,
);

const originalFetch = global.fetch;
try {
  setPlaybackProxyEndpointUrl("https://private-node.example");
  global.fetch = async () => new Response("#EXTM3U\n#EXT-X-VERSION:3", {
    status: 200,
    headers: { "content-type": "application/vnd.apple.mpegurl" },
  });
  const result = await resolvePlaybackStream({
    episodeId: "scenario-episode",
    activePlayerAlias: "direct",
    players: [{
      alias: "direct",
      provider: "fixture",
      label: "Fixture",
      sourcePageUrl: "https://provider.example/watch",
      embedUrl: "https://provider.example/embed",
      streamUrl: "https://cdn.example/master.m3u8",
    }],
  });
  check(
    "absolute node playback URL",
    result.playbackUrl.startsWith("https://private-node.example/api/download-full/browser-file?"),
    "resolver returned a relative or non-node URL",
  );
} finally {
  global.fetch = originalFetch;
  setPlaybackProxyEndpointUrl(undefined);
}

const root = resolve(import.meta.dirname, "../../..");
const convexHttp = await readFile(resolve(root, "convex/http.ts"), "utf8");
const rpc = await readFile(resolve(root, "apps/server/src/v2-rpc.ts"), "utf8");
const resolver = await readFile(resolve(root, "apps/dashboard/src/server/full-download.ts"), "utf8");
const standalone = await readFile(resolve(root, "apps/server/src/standalone.ts"), "utf8");
check("private ticket whitelist", /privateCapabilities[^;]+player\.resolve/s.test(convexHttp), "player.resolve private ticket is missing");
check("private ticket duration", /body\.capability === "player\.resolve" \? 90_000 : 30_000/.test(convexHttp), "private player ticket is not 90 seconds");
check("public ticket duration", /isPlaybackResolve \? 90_000 : 30_000/.test(convexHttp), "public player ticket is not 90 seconds");
check("resolver has no short global deadline", !/PLAYBACK_DEADLINE_MS|Playback resolution exceeded/.test(resolver), "resolver still contains the 9.5-second global cutoff");
check("cloudflared uses native binary", /spawn\(cloudflaredBinaryPath, \["tunnel"/.test(standalone), "cloudflared still launches through the output-swallowing JavaScript wrapper");
check("cloudflared timeout cleanup", /if \(!child\.killed\) child\.kill\(\)/.test(standalone), "timed-out cloudflared children are not stopped");
check("watcher session validation", /validatePrivateSession[\s\S]+"library"/.test(rpc), "private player RPC does not validate the watcher session");

if (controlledFailure) {
  check("controlled failure detected", failures === 1, `expected exactly one deliberate failure, saw ${failures}`);
  process.exit(failures === 1 ? 0 : 1);
}
process.exit(failures === 0 ? 0 : 1);
