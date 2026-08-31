const { app, BrowserWindow, ipcMain, Menu, Notification, shell, Tray } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn, execFile } = require("node:child_process");
const {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const path = require("node:path");
const { configureScheduledTask, createRotatingLogSink } = require(
  app.isPackaged
    ? path.join(process.resourcesPath, "windows-runtime-support.cjs")
    : path.join(__dirname, "../../scripts/windows-runtime-support.cjs"),
);

const REPO = { owner: "kao-offline", repo: "spilled-cinema" };
const SCHEDULED_TASK_NAME = "Spilled Verifier Runtime";
const VERIFIER_INTERVAL_MS = 5 * 60_000;
const VERIFIER_RECOVERY_INTERVAL_MS = 60_000;
const VERIFIER_MAX_BACKOFF_MS = 30 * 60_000;
const VERIFIER_STALE_LIMIT_MS = 45 * 60_000;

let verifierProcess = null;
let verifierLog = null;
let tray = null;
let mainWindow = null;
let quitting = false;
let lastLogSize = 0;
let lastStatusSignature = "";
let lastUpdateState = { stage: "idle" };
let verifierDesiredRunning = true;
let verifierWatchdog = null;
let autoStartEnabled = true;

app.setPath("userData", path.join(app.getPath("appData"), "Spilled Verifier"));

const DEFAULT_CONFIG = {
  controlPlaneUrl: process.env.SPILLED_CONTROL_PLANE_URL || "https://spilled-control-plane.hrdykrystof.workers.dev/server",
  gatewayUrl: process.env.SPILLED_GATEWAY_URL || "https://spilled-node-gateway.hrdykrystof.workers.dev",
  controlPlaneSecret: process.env.SPILLED_CONTROL_PLANE_SECRET || "",
  probesJson: process.env.SPILLED_VERIFIER_PROBES_JSON || "{}",
  once: false,
  autoStart: true,
  replaceLegacyOnStart: false,
};

function verifierPaths() {
  const root = app.getPath("userData");
  return {
    root,
    config: path.join(root, "config.json"),
    logs: path.join(root, "logs", "verifier.log"),
    status: path.join(root, "status.json"),
  };
}

function ensureDirectories() {
  const paths = verifierPaths();
  for (const directory of [path.dirname(paths.config), path.dirname(paths.logs)]) {
    mkdirSync(directory, { recursive: true });
  }
  return paths;
}

function verifierLogSink() {
  if (!verifierLog) {
    verifierLog = createRotatingLogSink(verifierPaths().logs);
  }
  return verifierLog;
}

function logHost(message) {
  verifierLogSink().write(`\n[verifier-windows] ${new Date().toISOString()} ${message}\n`);
}

function loadConfig() {
  const paths = ensureDirectories();
  try {
    const parsed = JSON.parse(readFileSync(paths.config, "utf8"));
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(patch) {
  const paths = ensureDirectories();
  const next = { ...loadConfig(), ...patch };
  writeFileSync(paths.config, JSON.stringify(next, null, 2));
  return next;
}

async function configureAutoStart(enabled) {
  const result = await configureScheduledTask({
    taskName: SCHEDULED_TASK_NAME,
    executablePath: process.execPath,
    arguments: ["background"],
    description: "Keeps the Spilled Verifier tray host running and restarts it after failures.",
    enabled,
  });
  saveConfig({ autoStart: enabled });
  if (result.ok) {
    app.setLoginItemSettings({ openAtLogin: false });
    autoStartEnabled = enabled;
  } else {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: process.execPath,
      args: ["background"],
    });
    autoStartEnabled = enabled && app.getLoginItemSettings().openAtLogin;
    logHost(`scheduled-task configuration failed: ${result.stderr || `exit ${result.code}`}`);
  }
  updateTrayMenu();
  return result.ok;
}

function sendToWindow(channel, payload) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

function emitUpdateState(state) {
  lastUpdateState = state;
  sendToWindow("update:state", state);
}

function verifierState() {
  return verifierProcess
    ? { running: true, pid: verifierProcess.pid, startedAt: verifierProcess.spawnedAt }
    : { running: false, pid: null, startedAt: null };
}

function pushVerifierState() {
  sendToWindow("verifier:state", verifierState());
}

function startVerifier() {
  if (verifierProcess) return;
  verifierDesiredRunning = true;
  const paths = ensureDirectories();
  const config = loadConfig();
  const entrypoint = path.join(app.getAppPath(), "verifier", "index.mjs");
  const log = verifierLogSink();
  log.write(`\n[verifier-windows] starting verifier ${new Date().toISOString()}\n`);
  const child = spawn(process.execPath, [entrypoint], {
    cwd: process.resourcesPath,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      SPILLED_CONTROL_PLANE_URL: config.controlPlaneUrl,
      SPILLED_GATEWAY_URL: config.gatewayUrl,
      SPILLED_CONTROL_PLANE_SECRET: config.controlPlaneSecret,
      SPILLED_VERIFIER_PROBES_JSON: config.probesJson || "{}",
      SPILLED_VERIFIER_STATUS_FILE: paths.status,
      SPILLED_VERIFIER_INTERVAL_MS: String(VERIFIER_INTERVAL_MS),
      SPILLED_VERIFIER_RECOVERY_INTERVAL_MS: String(VERIFIER_RECOVERY_INTERVAL_MS),
      SPILLED_VERIFIER_MAX_BACKOFF_MS: String(VERIFIER_MAX_BACKOFF_MS),
      ...(config.once ? { SPILLED_VERIFIER_ONCE: "1" } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.spawnedAt = Date.now();
  verifierProcess = child;
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.once("exit", (code, signal) => {
    if (verifierProcess === child) verifierProcess = null;
    logHost(`runtime exited (${signal ?? code ?? "unknown"})`);
    pushVerifierState();
    if (!quitting && verifierDesiredRunning && !loadConfig().once) {
      const delay = Math.min(30_000, 1_000 + Math.abs(code ?? 1) * 1_000);
      setTimeout(() => startVerifier(), delay);
    }
  });
  child.once("error", (error) => {
    logHost(error.stack || error.message);
  });
  pushVerifierState();
}

function stopVerifier() {
  verifierDesiredRunning = false;
  if (!verifierProcess) return;
  const child = verifierProcess;
  verifierProcess = null;
  child.kill();
  pushVerifierState();
}

function restartVerifier() {
  stopVerifier();
  setTimeout(() => {
    verifierDesiredRunning = true;
    startVerifier();
  }, 500);
}

function startVerifierWatchdog() {
  if (verifierWatchdog) return;
  verifierWatchdog = setInterval(() => {
    if (quitting || loadConfig().once) return;
    if (!verifierProcess) {
      if (verifierDesiredRunning) startVerifier();
      return;
    }
    const status = readStatus();
    const lastProgressAt = Math.max(
      verifierProcess.spawnedAt || 0,
      typeof status?.lastRunAt === "number" ? status.lastRunAt : 0,
    );
    if (Date.now() - lastProgressAt <= VERIFIER_STALE_LIMIT_MS) return;
    logHost("status has not advanced for 45 minutes; restarting runtime");
    verifierProcess.kill();
  }, 60_000);
}

function readLogTail(maxBytes = 256 * 1024) {
  const paths = verifierPaths();
  try {
    const size = statSync(paths.logs).size;
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(size - start);
    if (buffer.length > 0) {
      const fd = openSync(paths.logs, "r");
      try {
        readSync(fd, buffer, 0, buffer.length, start);
      } finally {
        closeSync(fd);
      }
    }
    return buffer.toString("utf8");
  } catch {
    return "";
  }
}

function readStatus() {
  const paths = verifierPaths();
  try {
    return JSON.parse(readFileSync(paths.status, "utf8"));
  } catch {
    return null;
  }
}

function tailLogLoop() {
  const paths = verifierPaths();
  try {
    const size = statSync(paths.logs).size;
    if (size < lastLogSize) lastLogSize = 0;
    if (size > lastLogSize) {
      const buffer = Buffer.alloc(size - lastLogSize);
      const fd = openSync(paths.logs, "r");
      try {
        readSync(fd, buffer, 0, buffer.length, lastLogSize);
      } finally {
        closeSync(fd);
      }
      lastLogSize = size;
      const text = buffer.toString("utf8");
      if (text.trim().length > 0) sendToWindow("logs:append", text);
    }
  } catch {
    lastLogSize = 0;
  }
}

function statusLoop() {
  const current = readStatus();
  if (!current) return;
  const signature = `${current.lastRunAt}|${current.verified}|${current.degraded}|${current.quarantined}|${current.errors?.length ?? 0}`;
  if (signature !== lastStatusSignature) {
    lastStatusSignature = signature;
    sendToWindow("status:update", current);
    updateTrayMenu();
  }
}

function runPowerShell(script) {
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("close", (code) => {
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.once("error", (error) => resolve({ code: -1, stdout: "", stderr: error.message }));
  });
}

async function scanLegacyVerifiers() {
  const dockerResult = await runPowerShell(
    'docker ps -a --filter "name=verifier" --format "{{.Names}}" 2>$null',
  );
  const dockerContainers = dockerResult.code === 0 && dockerResult.stdout
    ? dockerResult.stdout.split(/\r?\n/).filter(Boolean)
    : [];
  const processScript = `
    $self = $PID
    Get-CimInstance Win32_Process -Filter "Name = 'spilled-verifier-windows-x64.exe' OR Name = 'spilled-verifier.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.ProcessId -ne $self } |
      ForEach-Object { "{0}|{1}" -f $_.ProcessId, $_.CommandLine.Replace('|', '/') }
  `;
  const processResult = await runPowerShell(processScript);
  const oldProcesses = processResult.code === 0 && processResult.stdout
    ? processResult.stdout.split(/\r?\n/).filter(Boolean)
    : [];
  return { dockerContainers, oldProcesses };
}

async function replaceLegacyVerifiers() {
  const { dockerContainers, oldProcesses } = await scanLegacyVerifiers();
  const stopped = { docker: [], processes: [] };
  const errors = [];
  for (const container of dockerContainers) {
    const result = await runPowerShell(
      `docker stop ${JSON.stringify(container)} 2>$null; docker rm ${JSON.stringify(container)} 2>$null; "stopped"`,
    );
    if (result.code === 0) stopped.docker.push(container);
    else errors.push(`docker ${container}: ${result.stderr || result.stdout}`);
  }
  if (oldProcesses.length > 0) {
    const script = `
      Get-CimInstance Win32_Process -Filter "Name = 'spilled-verifier-windows-x64.exe' OR Name = 'spilled-verifier.exe'" -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue
      "stopped"
    `;
    const result = await runPowerShell(script);
    if (result.code === 0) {
      stopped.processes = oldProcesses.map((line) => line.split("|")[1] || line);
    } else {
      errors.push(result.stderr || "failed to stop legacy processes");
    }
  }
  return { stopped, errors };
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => emitUpdateState({ stage: "checking" }));
  autoUpdater.on("update-available", (info) => {
    emitUpdateState({ stage: "available", version: info.version });
    if (Notification.isSupported()) {
      new Notification({
        title: "Spilled Verifier update available",
        body: `Version ${info.version} is downloading.`,
      }).show();
    }
  });
  autoUpdater.on("update-not-available", () => emitUpdateState({ stage: "up-to-date" }));
  autoUpdater.on("download-progress", (progress) => {
    emitUpdateState({
      stage: "downloading",
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    emitUpdateState({ stage: "downloaded", version: info.version });
    if (Notification.isSupported()) {
      new Notification({
        title: "Spilled Verifier update ready",
        body: `Version ${info.version} will install on quit.`,
      }).show();
    }
  });
  autoUpdater.on("error", (error) => {
    emitUpdateState({ stage: "error", message: error.message });
  });
}

async function checkForUpdates(silent) {
  try {
    emitUpdateState({ stage: "checking" });
    const result = await autoUpdater.checkForUpdates();
    if (result && !result.updateInfo) {
      emitUpdateState({ stage: "up-to-date" });
    }
    return result?.updateInfo?.version ?? null;
  } catch (error) {
    if (!silent) {
      emitUpdateState({ stage: "error", message: error.message });
    }
    return null;
  }
}

function openWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 860,
    height: 600,
    minWidth: 640,
    minHeight: 480,
    title: "Spilled Verifier",
    backgroundColor: "#0c0d12",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  void mainWindow.loadFile(path.join(__dirname, "ui", "index.html"));
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function openLogsFolder() {
  const paths = ensureDirectories();
  void shell.openPath(path.dirname(paths.logs));
}

function updateTrayMenu() {
  if (!tray) return;
  const state = verifierState();
  const status = readStatus();
  const lastRun = status?.lastRunAt
    ? new Date(status.lastRunAt).toLocaleTimeString()
    : "no pass yet";
  const runningLabel = state.running
    ? `● Verifier running (${new Date(state.startedAt).toLocaleTimeString()})`
    : "○ Verifier stopped";
  tray.setToolTip(runningLabel);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: runningLabel, enabled: false },
    { label: `Last pass: ${lastRun}`, enabled: false },
    status
      ? {
          label: `Checked ${status.nodes} node(s) · ${status.verified} verified · ${status.degraded} degraded · ${status.quarantined} quarantined`,
          enabled: false,
        }
      : null,
    { type: "separator" },
    { label: "Open verifier console", click: openWindow },
    { label: "Open logs folder", click: openLogsFolder },
    { label: "Restart verifier", click: restartVerifier },
    {
      label: "Check for updates",
      click: () => void checkForUpdates(false),
    },
    { label: "Replace legacy verifier…", click: () => void replaceLegacyVerifiers() },
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
      label: "Quit Spilled Verifier",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ].filter(Boolean)));
}

function registerIpc() {
  ipcMain.handle("settings:get", () => loadConfig());
  ipcMain.handle("settings:set", (_event, patch) => saveConfig(patch || {}));
  ipcMain.handle("verifier:start", () => {
    startVerifier();
    return verifierState();
  });
  ipcMain.handle("verifier:stop", () => {
    stopVerifier();
    return verifierState();
  });
  ipcMain.handle("verifier:restart", () => {
    restartVerifier();
    return verifierState();
  });
  ipcMain.handle("logs:tail", () => readLogTail());
  ipcMain.handle("status:get", () => readStatus());
  ipcMain.handle("legacy:scan", () => scanLegacyVerifiers());
  ipcMain.handle("legacy:replace", () => replaceLegacyVerifiers());
  ipcMain.handle("update:check", (_event, silent = true) => checkForUpdates(!!silent));
  ipcMain.handle("update:getState", () => lastUpdateState);
  ipcMain.handle("app:openLogs", () => {
    openLogsFolder();
    return true;
  });
  ipcMain.handle("app:quit", () => {
    quitting = true;
    app.quit();
    return true;
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", openWindow);

  app.whenReady().then(async () => {
    configureAutoUpdater();
    registerIpc();

    const config = loadConfig();
    autoStartEnabled = config.autoStart;
    await configureAutoStart(config.autoStart);

    tray = new Tray(path.join(__dirname, "icon.png"));
    tray.on("click", openWindow);
    tray.on("double-click", openWindow);
    updateTrayMenu();

    const detected = await scanLegacyVerifiers();
    const hasLegacy = detected.dockerContainers.length > 0 || detected.oldProcesses.length > 0;
    if (hasLegacy && config.replaceLegacyOnStart) {
      await replaceLegacyVerifiers();
    } else if (hasLegacy && Notification.isSupported()) {
      new Notification({
        title: "Legacy verifier detected",
        body: "Use Replace legacy verifier in the tray or console to hand over to this version.",
      }).show();
    }

    startVerifier();
    startVerifierWatchdog();
    setInterval(tailLogLoop, 1_000);
    setInterval(statusLoop, 5_000);
    statusLoop();

    if (!process.argv.includes("background")) {
      openWindow();
    }

    if (!app.isPackaged) return;
    try {
      await autoUpdater.checkForUpdates();
    } catch {
      // Silent first-check failures are fine; the menu/console can retry.
    }
  });
}

app.on("window-all-closed", (event) => event.preventDefault());
app.on("before-quit", () => {
  quitting = true;
  if (verifierWatchdog) clearInterval(verifierWatchdog);
  verifierWatchdog = null;
  stopVerifier();
  verifierLog?.end();
});
