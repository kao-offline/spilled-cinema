import { createServer } from "node:http";
import { ManagedGatewayLink } from "../src/gateway-link";

const originalRandom = Math.random;
const originalLog = console.log;
const originalWarn = console.warn;
let requests = 0;
let refreshes = 0;

const gateway = createServer((_request, response) => {
  requests += 1;
  response.writeHead(429, { "Content-Type": "text/plain" });
  response.end("synthetic quota exhaustion");
});

function fail(message: string) {
  console.error(JSON.stringify({ ok: false, message, requests, refreshes }, null, 2));
  process.exitCode = 1;
}

await new Promise<void>((resolve, reject) => {
  gateway.once("error", reject);
  gateway.listen(0, "127.0.0.1", resolve);
});
const address = gateway.address();
if (!address || typeof address === "string") throw new Error("Probe gateway did not bind to TCP.");

let link: ManagedGatewayLink;
try {
  Math.random = () => 0;
  console.log = () => {};
  console.warn = () => {};
  link = new ManagedGatewayLink({
    gatewayUrl: `ws://127.0.0.1:${address.port}`,
    enrollmentCredential: "probe-only",
    jwksUrl: `http://127.0.0.1:${address.port}/jwks`,
    runtime: {
      getTransportIdentityRecord: async () => ({ nodeId: "node_gateway_backoff_probe" }),
    } as never,
    execute: async () => ({ ok: true }) as never,
    onReconnectStalled: () => {
      refreshes += 1;
      link.reconnectNow("Synthetic enrollment refresh.");
    },
  });
  link.start();

  const deadline = Date.now() + 13_000;
  while (refreshes < 2 && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }

  if (refreshes !== 1) {
    fail("A sustained gateway failure triggered repeated immediate enrollment refreshes.");
  } else if (requests > 6) {
    fail("Gateway retry count exceeded the bounded backoff envelope.");
  } else {
    originalLog(JSON.stringify({
      ok: true,
      scenario: "persistent-handshake-failure",
      requests,
      enrollmentRefreshes: refreshes,
      observationMs: 13_000,
    }, null, 2));
  }
} finally {
  link?.stop();
  Math.random = originalRandom;
  console.log = originalLog;
  console.warn = originalWarn;
  await new Promise<void>((resolve) => gateway.close(() => resolve()));
}
