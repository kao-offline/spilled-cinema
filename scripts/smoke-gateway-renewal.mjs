import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";

const tempRoot = await mkdtemp(join(tmpdir(), "spilled-gateway-renewal-"));
const privateConfigPath = join(tempRoot, "spilled.private.json");
await writeFile(privateConfigPath, JSON.stringify({ privateNode: { enabled: false } }), "utf8");
const fakeNetwork = createServer((request, response) => {
  if (request.url?.endsWith("/v2/nodes/apply")) {
    applyAttempts += 1;
    request.resume();
    response.writeHead(applyAttempts <= 3 ? 503 : 200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(applyAttempts <= 3 ? { error: "temporary" } : { ok: true }));
    return;
  }
  response.writeHead(404).end();
});
const gateway = new WebSocketServer({ noServer: true });
let applyAttempts = 0;
let connections = 0;
let latestSocket;

fakeNetwork.on("upgrade", (request, socket, head) => {
  gateway.handleUpgrade(request, socket, head, (webSocket) => gateway.emit("connection", webSocket, request));
});
gateway.on("connection", (socket) => {
  connections += 1;
  latestSocket = socket;
});

await new Promise((resolve) => fakeNetwork.listen(0, "127.0.0.1", resolve));
const address = fakeNetwork.address();
if (!address || typeof address === "string") throw new Error("Fake gateway did not bind.");
const baseUrl = `http://127.0.0.1:${address.port}`;
const serverPort = address.port + 1;
const child = spawn(process.execPath, ["apps/server/dist/standalone.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(serverPort),
    SPILLED_CONTROL_PLANE_URL: `${baseUrl}/server`,
    SPILLED_CONTROL_PLANE_JWKS_URL: `${baseUrl}/server/v2/jwks`,
    SPILLED_GATEWAY_URL: baseUrl,
    SPILLED_NODE_DATABASE: join(tempRoot, "node.db"),
    SPILLED_SECRET_RECORDS_FILE: join(tempRoot, "secrets.json"),
    SPILLED_VAULT_PATH: join(tempRoot, "vault"),
    SPILLED_PUBLIC_TEMP_PATH: join(tempRoot, "temp"),
    SPILLED_NODE_MODE: "local",
    SPILLED_PRIVATE_CONFIG: privateConfigPath,
    SPILLED_DISABLE_AUTO_TUNNEL: "1",
    SPILLED_DISABLE_PRIVATE_SETUP: "1",
    SPILLED_OPEN_SETUP_BROWSER: "0",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });

const waitFor = async (predicate, timeoutMs, label) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} timed out.\n${output.slice(-4000)}`);
};

try {
  await waitFor(() => applyAttempts >= 3, 15_000, "initial bounded enrollment attempts");
  if (connections !== 0) throw new Error("Node connected before enrollment was accepted.");
  await waitFor(() => applyAttempts >= 4 && connections >= 1, 40_000, "watchdog enrollment recovery");
  latestSocket?.close(1012, "smoke reconnect");
  await waitFor(() => connections >= 2, 10_000, "gateway reconnect");
  console.log(`gateway renewal smoke passed (applications=${applyAttempts}, connections=${connections})`);
} finally {
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ]);
  }
  for (const socket of gateway.clients) socket.terminate();
  gateway.close();
  await new Promise((resolve) => fakeNetwork.close(resolve));
  await rm(tempRoot, { recursive: true, force: true });
}
