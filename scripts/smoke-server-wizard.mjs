import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = await mkdtemp(join(tmpdir(), "spilled-wizard-"));
const port = "8799";
const child = spawn(process.execPath, [resolve("apps/server/dist/standalone.mjs")], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: port,
    HOST: "127.0.0.1",
    SPILLED_NODE_DATABASE: join(root, "node.db"),
    SPILLED_SECRET_RECORDS_FILE: join(root, "secrets.json"),
    SPILLED_PRIVATE_CONFIG: join(root, "private.json"),
    SPILLED_VAULT_PATH: join(root, "vault"),
    SPILLED_PUBLIC_TEMP_PATH: join(root, "temp"),
    SPILLED_OPEN_SETUP_BROWSER: "0",
    SPILLED_DISABLE_PRIVATE_SETUP: "0",
    SPILLED_NODE_MODE: "local",
    SPILLED_DISABLE_MANAGED_GATEWAY: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });

try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v2/health/ready`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // Server is still starting.
    }
  }
  if (!ready) throw new Error(`Server did not become ready.\n${output}`);
  const page = await fetch(`http://127.0.0.1:${port}/setup`);
  const html = await page.text();
  if (!page.ok || !html.includes("Your spare PC just became a Spilled node")) {
    throw new Error("The local setup wizard was not served.");
  }
  const bootstrapMatch = html.match(/const bootstrap=(\{.+?\});\s*let step=/s);
  if (!bootstrapMatch) throw new Error("The wizard bootstrap was not embedded.");
  const bootstrap = JSON.parse(bootstrapMatch[1]);
  if (!bootstrap.setupRequired || typeof bootstrap.setupCode !== "string") {
    throw new Error("The wizard did not receive a first-run setup token.");
  }
  const setupResponse = await fetch(`http://127.0.0.1:${port}/api/node/setup/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: `http://127.0.0.1:${port}`,
    },
    body: JSON.stringify({
      setupCode: bootstrap.setupCode,
      dashboardOrigin: `http://127.0.0.1:${port}`,
      nodeName: "Smoke Server",
      admin: {
        adminId: "owner",
        displayName: "Owner",
        password: "smoke-test-owner-password",
      },
      publicCapabilities: {
        fetch: true,
        search: true,
        import: true,
        stream: true,
        download: false,
        spillshare: false,
        relay: false,
      },
      initialWatchers: [{
        watcherId: "watcher_owner",
        displayName: "Owner",
        quotaBytes: 1024 * 1024 * 1024,
        profiles: [{ profileId: "prof_owner", displayName: "Owner", avatar: "default" }],
      }],
    }),
  });
  if (!setupResponse.ok) {
    throw new Error(`Wizard completion failed: ${await setupResponse.text()}`);
  }
  const completedPage = await fetch(`http://127.0.0.1:${port}/setup`).then((response) => response.text());
  const completedBootstrap = completedPage.match(/const bootstrap=(\{.+?\});\s*let step=/s);
  if (!completedBootstrap || JSON.parse(completedBootstrap[1]).setupRequired !== false) {
    throw new Error("The wizard did not enter the completed state.");
  }
  const protocol = await fetch(`http://127.0.0.1:${port}/v2/protocol`).then((response) => response.json());
  if (protocol.protocolVersion !== 2) throw new Error("Unexpected protocol version.");
  console.log("Spilled Server wizard smoke test passed.");
} finally {
  child.kill("SIGTERM");
  await new Promise((resolvePromise) => {
    child.once("exit", resolvePromise);
    setTimeout(resolvePromise, 2_000).unref();
  });
  await rm(root, { recursive: true, force: true });
}
