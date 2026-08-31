import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const moduleArgument = process.argv[2] || "dist/index.mjs";
const modulePath = resolve(process.cwd(), moduleArgument);
const scheduled = [];
let candidateRequests = 0;
const originalSetTimeout = globalThis.setTimeout;

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
  process.env.SPILLED_VERIFIER_INTERVAL_MS = "300000";
  process.env.SPILLED_VERIFIER_RECOVERY_INTERVAL_MS = "60000";
  process.env.SPILLED_VERIFIER_MAX_BACKOFF_MS = "1800000";
  process.env.SPILLED_VERIFIER_DISABLE_JITTER = "1";
  delete process.env.SPILLED_VERIFIER_ONCE;

  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay < 60_000) return originalSetTimeout(callback, delay, ...args);
    const handle = { callback, delay, args };
    scheduled.push(handle);
    return handle;
  };

  await import(`${pathToFileURL(modulePath).href}?probe=${Date.now()}`);
  if (scheduled.length !== 1) {
    fail("Expected exactly one scheduled verifier pass after startup.", { timers: scheduled.length });
  } else if (scheduled[0].delay !== 300_000) {
    fail("A healthy pass did not select the steady-state interval.", { delay: scheduled[0].delay });
  } else {
    const failedPass = scheduled.shift();
    failedPass.callback(...failedPass.args);
    await waitFor(() => candidateRequests >= 2, 250);
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    if (scheduled.length !== 1) {
      fail("A failed verifier pass did not leave exactly one recovery timer.", { timers: scheduled.length });
    } else if (scheduled[0].delay !== 60_000) {
      fail("The first failed pass did not select the bounded recovery interval.", { delay: scheduled[0].delay });
    } else {
      const recoveryPass = scheduled.shift();
      recoveryPass.callback(...recoveryPass.args);
      const recovered = await waitFor(() => candidateRequests >= 3, 250);
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
      if (!recovered || scheduled.length !== 1 || scheduled[0].delay !== 300_000) {
        fail("Verifier did not recover cleanly after a failed pass.", {
          candidateRequests,
          timers: scheduled.length,
          recoveryDelay: scheduled[0]?.delay,
        });
      } else {
        console.log(JSON.stringify({
          ok: true,
          scenarios: ["startup", "failed-pass", "recovery-pass"],
          candidateRequests,
          steadyDelayMs: scheduled[0].delay,
          failureDelayMs: recoveryPass.delay,
        }, null, 2));
      }
    }
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  globalThis.setTimeout = originalSetTimeout;
  await new Promise((resolveClose) => server.close(resolveClose));
}
