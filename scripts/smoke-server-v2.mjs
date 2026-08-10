import { spawn } from "node:child_process";

const port = 18787;
const child = spawn(process.execPath, ["apps/server/dist/standalone.mjs"], {
  cwd: process.cwd(),
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    HOST: "127.0.0.1",
    SPILLED_DISABLE_PRIVATE_SETUP: "1",
    SPILLED_ENABLE_LEGACY_CONTROL_PLANE: "0",
  },
});

try {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v2/health/ready`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // Retry while the compiled process starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("Compiled v2 server did not become ready.");
  const protocol = await fetch(`http://127.0.0.1:${port}/v2/protocol`, {
    headers: { Origin: "http://127.0.0.1:5173" },
  });
  if (!protocol.ok || protocol.headers.get("access-control-allow-origin") !== "http://127.0.0.1:5173") {
    throw new Error("Approved dashboard origin failed.");
  }
  const malicious = await fetch(`http://127.0.0.1:${port}/v2/protocol`, {
    headers: { Origin: "https://malicious.example" },
  });
  if (malicious.status !== 403) throw new Error("Unapproved origin was not rejected.");
  console.log("Compiled v2 server smoke test passed.");
} finally {
  child.kill("SIGTERM");
}
