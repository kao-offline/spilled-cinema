import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const moduleArgument = process.argv[2] || "dist/index.mjs";
const modulePath = resolve(process.cwd(), moduleArgument);
const scheduled = [];
let candidateRequests = 0;
const originalSetInterval = globalThis.setInterval;

function fail(message, details = {}) {
  console.error(JSON.stringify({ ok: false, message, ...details }, null, 2));
  process.exitCode = 1;
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  }
  return true;
}

const server = createServer((request, response) => {
  if (request.url?.startsWith("/server/v2/nodes/verification-candidates")) {
    candidateRequests += 1;
    const shouldFail = candidateRequests === 2;
    response.writeHead(shouldFail ? 503 : 200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(shouldFail ? { error: "synthetic outage" } : { candidates: [] }));
    return;
  }
  response.writeHead(404, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: "not found" }));
});

try {
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Probe server did not bind to TCP.");

  process.env.SPILLED_CONTROL_PLANE_URL = `http://127.0.0.1:${address.port}/server`;
  process.env.SPILLED_GATEWAY_URL = "ws://127.0.0.1:1";
  process.env.SPILLED_CONTROL_PLANE_SECRET = "scheduler-probe-only";
  process.env.SPILLED_VERIFIER_INTERVAL_MS = "60000";
  delete process.env.SPILLED_VERIFIER_ONCE;

  globalThis.setInterval = (callback, delay, ...args) => {
    const handle = { callback, delay, args };
    scheduled.push(handle);
    return handle;
  };

  await import(`${pathToFileURL(modulePath).href}?probe=${Date.now()}`);
  if (scheduled.length !== 1) {
    fail("Expected exactly one periodic timer after startup.", { timers: scheduled.length });
  } else {
    scheduled[0].callback(...scheduled[0].args);
    await waitFor(() => candidateRequests >= 2, 250);
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    if (scheduled.length !== 1) {
      fail("A completed verifier pass registered another periodic timer.", {
        timersAfterStartup: 1,
        timersAfterOneTick: scheduled.length,
      });
    } else {
      scheduled[0].callback(...scheduled[0].args);
      const recovered = await waitFor(() => candidateRequests >= 3, 250);
      if (!recovered || scheduled.length !== 1) {
        fail("Verifier did not recover cleanly after a failed pass.", {
          candidateRequests,
          timers: scheduled.length,
        });
      } else {
        console.log(JSON.stringify({
          ok: true,
          scenarios: ["startup", "failed-pass", "recovery-pass"],
          candidateRequests,
          timersAfterStartup: 1,
          timersAfterRecovery: 1,
        }, null, 2));
      }
    }
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  globalThis.setInterval = originalSetInterval;
  await new Promise((resolveClose) => server.close(resolveClose));
}
