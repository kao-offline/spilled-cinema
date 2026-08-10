import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

if (process.platform !== "win32") {
  console.log("Native named-pipe smoke test skipped outside Windows.");
  process.exit(0);
}
const id = randomUUID();
const pipe = `\\\\.\\pipe\\spilled-node-${id}`;
const stateFile = join(tmpdir(), `spilled-native-smoke-${id}.json`);
const child = spawn(process.execPath, ["apps/server/dist/standalone.mjs"], {
  cwd: process.cwd(),
  windowsHide: true,
  stdio: "ignore",
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: "18788",
    HOST: "127.0.0.1",
    SPILLED_NATIVE_PIPE: pipe,
    SPILLEDCINEMA_NODE_STATE_FILE: stateFile,
    SPILLED_DISABLE_PRIVATE_SETUP: "1",
  },
});

async function request() {
  return await new Promise((resolve, reject) => {
    const socket = createConnection(pipe);
    let body = "";
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.end(`${JSON.stringify({
      version: 2,
      requestId: randomUUID(),
      path: "/api/status",
      method: "GET",
    })}\n`));
    socket.on("data", (chunk) => { body += chunk; });
    socket.once("end", () => {
      try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
    });
    socket.once("error", reject);
  });
}

try {
  let result;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      result = await request();
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!result?.ok || result.status !== 200) throw new Error("Native pipe did not return node status.");
  console.log("Native v2 named-pipe smoke test passed.");
} finally {
  child.kill("SIGTERM");
  await rm(stateFile, { force: true });
}
