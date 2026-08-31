const { app, Menu, Notification, shell, Tray } = require("electron");
const { spawn } = require("node:child_process");
const { mkdirSync } = require("node:fs");
const path = require("node:path");
const { configureScheduledTask, createRotatingLogSink } = require(
  app.isPackaged
    ? path.join(process.resourcesPath, "windows-runtime-support.cjs")
    : path.join(__dirname, "../../scripts/windows-runtime-support.cjs"),
);

const SERVER_PORT = "8787";
const SERVER_ORIGIN = `http://127.0.0.1:${SERVER_PORT}`;
const SCHEDULED_TASK_NAME = "Spilled Server Runtime";
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const HEALTH_FAILURE_LIMIT = 3;
let serverProcess = null;
let serverLog = null;
let tray = null;
let quitting = false;
let autoStartEnabled = true;
let healthMonitor = null;
let healthCheckInFlight = false;
let consecutiveHealthFailures = 0;

app.setPath("userData", path.join(app.getPath("appData"), "Spilled Server"));

function serverDataPaths() {
  const root = app.getPath("userData");
  return {
    root,
    database: path.join(root, "data", "node.db"),
    dpapiKey: path.join(root, "data", "master-key.dpapi"),
    secrets: path.join(root, "data", "secrets.json"),
    privateConfig: path.join(root, "data", "spilled.private.json"),
    vault: path.join(root, "vault"),
    temporary: path.join(root, "temp"),
    logs: path.join(root, "logs"),
  };
}

function ensureDirectories() {
  const paths = serverDataPaths();
  for (const directory of [
    path.dirname(paths.database),
    paths.vault,
    paths.temporary,
    paths.logs,
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  return paths;
}

function serverLogSink() {
  if (!serverLog) {
    const paths = ensureDirectories();
    serverLog = createRotatingLogSink(path.join(paths.logs, "server.log"));
  }
  return serverLog;
}

function logHost(message) {
  serverLogSink().write(`\n[server-host] ${new Date().toISOString()} ${message}\n`);
}

async function configureAutoStart(enabled) {
  const result = await configureScheduledTask({
    taskName: SCHEDULED_TASK_NAME,
    executablePath: process.execPath,
    arguments: ["background"],
    description: "Keeps the Spilled Server tray host running and restarts it after failures.",
    enabled,
  });
  if (result.ok) {
    app.setLoginItemSettings({ openAtLogin: false });
    autoStartEnabled = enabled;
  } else {
    // Retain Electron's login-item fallback if Task Scheduler is unavailable.
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: process.execPath,
      args: ["background"],
    });
    autoStartEnabled = enabled && app.getLoginItemSettings().openAtLogin;
    logHost(`scheduled-task configuration failed: ${result.stderr || `exit ${result.code}`}`);
  }
  updateTrayMenu(await serverIsReady());
  return result.ok;
}

async function serverIsReady() {
  try {
    const response = await fetch(`${SERVER_ORIGIN}/v2/health/ready`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await serverIsReady()) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  return false;
}

function startServer() {
  if (serverProcess) return;
  const paths = ensureDirectories();
  const entrypoint = path.join(app.getAppPath(), "server", "standalone.mjs");
  const log = serverLogSink();
  serverProcess = spawn(process.execPath, [entrypoint], {
    cwd: process.resourcesPath,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: SERVER_PORT,
      SPILLED_NODE_DATABASE: paths.database,
      SPILLED_DPAPI_KEY_FILE: paths.dpapiKey,
      SPILLED_SECRET_RECORDS_FILE: paths.secrets,
      SPILLED_PRIVATE_CONFIG: paths.privateConfig,
      SPILLED_VAULT_PATH: paths.vault,
      SPILLED_PUBLIC_TEMP_PATH: paths.temporary,
      SPILLED_OPEN_SETUP_BROWSER: "0",
      SPILLED_DASHBOARD_URL: "https://spilled.overload.studio",
      SPILLED_CONTROL_PLANE_URL: "https://spilled-control-plane.hrdykrystof.workers.dev/server",
      SPILLED_GATEWAY_URL: "https://spilled-node-gateway.hrdykrystof.workers.dev",
      SPILLED_PASSKEY_ORIGIN: "https://spilled.overload.studio",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  serverProcess.stdout.pipe(log, { end: false });
  serverProcess.stderr.pipe(log, { end: false });
  serverProcess.once("exit", (code, signal) => {
    logHost(`runtime exited (${signal ?? code ?? "unknown"})`);
    serverProcess = null;
    if (!quitting) {
      setTimeout(() => void ensureServer(false), Math.min(30_000, 1_000 + Math.abs(code ?? 1) * 1_000));
    }
  });
  serverProcess.once("error", (error) => {
    logHost(error.stack || error.message);
  });
}

function startHealthMonitor() {
  if (healthMonitor) return;
  healthMonitor = setInterval(() => {
    if (healthCheckInFlight || quitting) return;
    healthCheckInFlight = true;
    void serverIsReady().then((ready) => {
      if (ready) {
        consecutiveHealthFailures = 0;
        updateTrayMenu(true);
        return;
      }
      consecutiveHealthFailures += 1;
      updateTrayMenu(false);
      if (consecutiveHealthFailures < HEALTH_FAILURE_LIMIT) return;
      consecutiveHealthFailures = 0;
      if (serverProcess && serverProcess.exitCode === null) {
        logHost("health endpoint failed three consecutive checks; restarting runtime");
        serverProcess.kill();
      } else {
        serverProcess = null;
        void ensureServer(false);
      }
    }).finally(() => {
      healthCheckInFlight = false;
    });
  }, HEALTH_CHECK_INTERVAL_MS);
}

async function ensureServer(openWizard) {
  if (!(await serverIsReady())) startServer();
  const ready = await waitForServer();
  updateTrayMenu(ready);
  if (ready && openWizard) {
    await shell.openExternal(`${SERVER_ORIGIN}/setup`);
  }
  if (!ready && Notification.isSupported()) {
    new Notification({
      title: "Spilled Server could not start",
      body: "Open the tray menu to view the server logs.",
    }).show();
  }
  return ready;
}

function openLogs() {
  const paths = ensureDirectories();
  void shell.openPath(paths.logs);
}

function updateTrayMenu(ready = false) {
  if (!tray) return;
  tray.setToolTip(ready ? "Spilled Server — running" : "Spilled Server — starting");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: ready ? "● Server running" : "○ Server starting", enabled: false },
    { type: "separator" },
    { label: "Open setup and settings", click: () => void shell.openExternal(`${SERVER_ORIGIN}/setup`) },
    { label: "Check server health", click: () => void shell.openExternal(`${SERVER_ORIGIN}/v2/health/ready`) },
    { label: "Open logs", click: openLogs },
    { type: "separator" },
    {
      label: "Start with Windows",
      type: "checkbox",
      checked: autoStartEnabled,
      click: (item) => {
        void configureAutoStart(item.checked);
      },
    },
    {
      label: "Restart server",
      click: () => {
        serverProcess?.kill();
        serverProcess = null;
        setTimeout(() => void ensureServer(false), 500);
      },
    },
    {
      label: "Quit Spilled Server",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    void ensureServer(true);
  });

  app.whenReady().then(async () => {
    await configureAutoStart(true);
    tray = new Tray(path.join(__dirname, "icon.png"));
    tray.on("double-click", () => void shell.openExternal(`${SERVER_ORIGIN}/setup`));
    updateTrayMenu(false);
    await ensureServer(!process.argv.includes("background"));
    startHealthMonitor();
  });
}

app.on("window-all-closed", (event) => event.preventDefault());
app.on("before-quit", () => {
  quitting = true;
  if (healthMonitor) clearInterval(healthMonitor);
  healthMonitor = null;
  serverProcess?.kill();
  serverProcess = null;
  serverLog?.end();
});
