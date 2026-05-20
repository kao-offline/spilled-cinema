const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, session, shell } = require("electron");
const { spawn } = require("node:child_process");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { readdir, readFile, rm, stat, writeFile } = require("node:fs/promises");
const path = require("node:path");

const SERVER_PORT = process.env.SPILLED_NATIVE_PORT || "8787";
const DASHBOARD_HOST = "127.0.0.1";
const DASHBOARD_PORT = process.env.SPILLED_NATIVE_DASHBOARD_PORT || "4173";
let dashboardUrl = process.env.SPILLED_DASHBOARD_URL || `http://${DASHBOARD_HOST}:${DASHBOARD_PORT}`;

let mainWindow = null;
let serverProcess = null;
let dashboardProcess = null;
const VAULT_SETTINGS_FILE = "vault.json";

function getVaultSettingsPath() {
  return path.join(app.getPath("userData"), VAULT_SETTINGS_FILE);
}

function readVaultSettings() {
  try {
    return JSON.parse(readFileSync(getVaultSettingsPath(), "utf8"));
  } catch {
    return {};
  }
}

function writeVaultSettings(next) {
  const settingsPath = getVaultSettingsPath();
  mkdirSync(path.dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(next, null, 2), "utf8");
}

function getStoredVaultPath() {
  const settings = readVaultSettings();
  return typeof settings.vaultPath === "string" && settings.vaultPath.trim() ? settings.vaultPath : null;
}

function setStoredVaultPath(vaultPath) {
  const settings = readVaultSettings();
  settings.vaultPath = vaultPath || null;
  writeVaultSettings(settings);
}

function getNativeVaultPaths(rootPath) {
  const appDir = path.join(rootPath, "spilled-library");
  return {
    appDir,
    vaultDir: path.join(appDir, "vault"),
    snapshotFile: path.join(appDir, "library-state.json"),
    recordsDir: path.join(appDir, "offline-records"),
  };
}

async function ensureNativeVaultRoot() {
  const rootPath = getStoredVaultPath();
  if (!rootPath) {
    return null;
  }

  const stats = await stat(rootPath).catch(() => null);
  if (!stats?.isDirectory()) {
    return null;
  }

  return rootPath;
}

async function restartLocalServices() {
  console.log("[spilled-native] restarting local services due to vault path change");
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (dashboardProcess) {
    dashboardProcess.kill();
    dashboardProcess = null;
  }
  await startLocalServer();
  await startLocalDashboard();
}

async function registerNativeVaultHandlers() {
  ipcMain.handle("vault:connect", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
      title: "Choose Vault Folder",
    });
    if (result.canceled || result.filePaths.length === 0) {
      throw new Error("Vault folder selection was canceled.");
    }

    const rootPath = result.filePaths[0];
    setStoredVaultPath(rootPath);
    const { appDir, vaultDir, recordsDir } = getNativeVaultPaths(rootPath);
    mkdirSync(appDir, { recursive: true });
    mkdirSync(vaultDir, { recursive: true });
    mkdirSync(recordsDir, { recursive: true });

    // Restart services to pick up the new SPILLED_VAULT_PATH
    void restartLocalServices();

    return { name: path.basename(rootPath), path: rootPath };
  });

  ipcMain.handle("vault:disconnect", async () => {
    setStoredVaultPath(null);
    // Restart services to clear SPILLED_VAULT_PATH
    void restartLocalServices();
    return { ok: true };
  });

  ipcMain.handle("vault:status", async () => {
    const rootPath = await ensureNativeVaultRoot();
    if (!rootPath) {
      return {
        kind: "disconnected",
        supported: true,
        handleStored: Boolean(getStoredVaultPath()),
        folderName: null,
      };
    }

    return {
      kind: "ready",
      supported: true,
      handleStored: true,
      folderName: path.basename(rootPath),
      rootPath,
    };
  });

  ipcMain.handle("vault:readSnapshot", async () => {
    const rootPath = await ensureNativeVaultRoot();
    if (!rootPath) {
      return null;
    }
    const { snapshotFile } = getNativeVaultPaths(rootPath);
    const raw = await readFile(snapshotFile, "utf8").catch(() => "");
    return raw || null;
  });

  ipcMain.handle("vault:writeSnapshot", async (_event, text) => {
    const rootPath = await ensureNativeVaultRoot();
    if (!rootPath) {
      throw new Error("No native vault connected.");
    }
    const { appDir, snapshotFile } = getNativeVaultPaths(rootPath);
    await mkdirSync(appDir, { recursive: true });
    await writeFile(snapshotFile, String(text ?? ""), "utf8");
    return { ok: true };
  });

  ipcMain.handle("vault:listArtifacts", async () => {
    const rootPath = await ensureNativeVaultRoot();
    if (!rootPath) {
      return { episodeIds: [], files: [], filesByEpisodeId: {} };
    }

    const { vaultDir, recordsDir } = getNativeVaultPaths(rootPath);
    const files = await readdir(vaultDir).catch(() => []);
    const recordNames = await readdir(recordsDir).catch(() => []);
    const episodeIds = [];
    const filesByEpisodeId = {};

    for (const name of recordNames) {
      if (!name.endsWith(".json")) {
        continue;
      }
      try {
        const parsed = JSON.parse(await readFile(path.join(recordsDir, name), "utf8"));
        if (typeof parsed.episodeId === "string" && parsed.episodeId) {
          episodeIds.push(parsed.episodeId);
          if (typeof parsed.fileName === "string" && parsed.fileName) {
            filesByEpisodeId[parsed.episodeId] = parsed.fileName;
          }
        }
      } catch {
        // Ignore bad records.
      }
    }

    return { episodeIds, files, filesByEpisodeId };
  });

  ipcMain.handle("vault:writeBlob", async (_event, fileName, bytes) => {
    const rootPath = await ensureNativeVaultRoot();
    if (!rootPath) {
      throw new Error("No native vault connected.");
    }
    const { vaultDir } = getNativeVaultPaths(rootPath);
    mkdirSync(vaultDir, { recursive: true });
    await writeFile(path.join(vaultDir, fileName), Buffer.from(bytes));
    return { ok: true, fileName, folderName: path.basename(rootPath) };
  });

  ipcMain.handle("vault:writeRecord", async (_event, episodeId, payload) => {
    const rootPath = await ensureNativeVaultRoot();
    if (!rootPath) {
      return { ok: false };
    }
    const { recordsDir } = getNativeVaultPaths(rootPath);
    mkdirSync(recordsDir, { recursive: true });
    await writeFile(path.join(recordsDir, `${episodeId}.json`), String(payload), "utf8");
    return { ok: true };
  });

  ipcMain.handle("vault:removeRecord", async (_event, episodeId) => {
    const rootPath = await ensureNativeVaultRoot();
    if (!rootPath) {
      return { ok: false };
    }
    const { recordsDir } = getNativeVaultPaths(rootPath);
    await rm(path.join(recordsDir, `${episodeId}.json`), { force: true }).catch(() => undefined);
    return { ok: true };
  });

  ipcMain.handle("vault:clearRecords", async () => {
    const rootPath = await ensureNativeVaultRoot();
    if (!rootPath) {
      return { ok: false };
    }
    const { recordsDir } = getNativeVaultPaths(rootPath);
    await rm(recordsDir, { recursive: true, force: true }).catch(() => undefined);
    return { ok: true };
  });
}

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const envEntries = {};
  const content = readFileSync(filePath, "utf8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    envEntries[key] = value.replace(/\\n/g, "\n");
  }

  return envEntries;
}

function loadWorkspaceEnv() {
  const workspaceRoot = path.resolve(__dirname, "../../..");
  const envSearchRoots = [
    workspaceRoot,
    path.join(workspaceRoot, "apps", "dashboard"),
  ];
  const envFiles = [
    ".env",
    ".env.local",
    ".env.development",
    ".env.development.local",
  ];

  return envSearchRoots.reduce((mergedByRoot, rootPath) => {
    return envFiles.reduce((mergedByFile, fileName) => {
      return {
        ...mergedByFile,
        ...parseEnvFile(path.join(rootPath, fileName)),
      };
    }, mergedByRoot);
  }, {});
}

function getNativeWindowIconPath() {
  return path.resolve(
    __dirname,
    nativeTheme.shouldUseDarkColors ? "../../icon-light-rounded.png" : "../../icon-dark-rounded.png",
  );
}

function getNodeCommand() {
  return process.platform === "win32" ? "node.exe" : "node";
}

function getNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function createChildEnv(extraEnv = {}) {
  const childEnv = {
    ...loadWorkspaceEnv(),
    ...process.env,
    ...extraEnv,
  };

  delete childEnv.ELECTRON_RUN_AS_NODE;

  return childEnv;
}

function inferControlPlaneUrl() {
  if (process.env.SPILLED_CONTROL_PLANE_URL) {
    return process.env.SPILLED_CONTROL_PLANE_URL;
  }

  if (process.env.SPILLED_DASHBOARD_URL) {
    return `${process.env.SPILLED_DASHBOARD_URL.replace(/\/$/, "")}/api/server`;
  }

  const workspaceEnv = loadWorkspaceEnv();
  if (workspaceEnv.CONVEX_SITE_URL) {
    return `${workspaceEnv.CONVEX_SITE_URL.replace(/\/$/, "")}/server`;
  }

  return undefined;
}

function getAllowedDashboardOrigins() {
  const origins = new Set();
  const candidates = [
    dashboardUrl,
    `http://${DASHBOARD_HOST}:${DASHBOARD_PORT}`,
    `http://localhost:${DASHBOARD_PORT}`,
    `http://127.0.0.1:${DASHBOARD_PORT}`,
  ];

  for (const candidate of candidates) {
    try {
      origins.add(new URL(candidate).origin);
    } catch {
      // Ignore invalid candidate.
    }
  }

  return origins;
}

function isTrustedDashboardRequest(url) {
  if (!url) {
    return false;
  }

  try {
    return getAllowedDashboardOrigins().has(new URL(url).origin);
  } catch {
    return false;
  }
}

function configureNativeFileSystemPermissions() {
  const ses = session.defaultSession;

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (permission !== "fileSystem") {
      return false;
    }

    const candidateUrl =
      details?.requestingUrl ||
      requestingOrigin ||
      webContents?.getURL() ||
      "";
    return isTrustedDashboardRequest(candidateUrl);
  });

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission !== "fileSystem") {
      callback(false);
      return;
    }

    const candidateUrl =
      details?.requestingUrl ||
      webContents?.getURL() ||
      "";
    callback(isTrustedDashboardRequest(candidateUrl));
  });
}

function spawnWorkspaceScript(args, extraEnv = {}) {
  const command = [getNpmCommand(), ...args].join(" ");

  return spawn(command, {
    cwd: path.resolve(__dirname, "../../.."),
    env: createChildEnv(extraEnv),
    shell: true,
    stdio: "inherit",
  });
}

async function isUrlReachable(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function startLocalServer() {
  const serverStatusUrl = `http://127.0.0.1:${SERVER_PORT}/api/status`;
  if (await isUrlReachable(serverStatusUrl)) {
    return;
  }

  const tsxCli = require.resolve("tsx/cli", {
    paths: [path.resolve(__dirname, "../../../node_modules")],
  });
  const serverEntrypoint = path.resolve(__dirname, "../../server/src/standalone.ts");

  const rootPath = getStoredVaultPath();
  const vaultEnv = {};
  if (rootPath) {
    const { vaultDir } = getNativeVaultPaths(rootPath);
    vaultEnv.SPILLED_VAULT_PATH = vaultDir;
  }

  serverProcess = spawn(getNodeCommand(), [tsxCli, serverEntrypoint], {
    cwd: path.resolve(__dirname, "../../.."),
    env: createChildEnv({
      PORT: SERVER_PORT,
      HOST: "127.0.0.1",
      SPILLED_NODE_ENDPOINT_URL: `http://127.0.0.1:${SERVER_PORT}`,
      SPILLED_CONTROL_PLANE_URL: inferControlPlaneUrl(),
      ...vaultEnv,
    }),
    stdio: "inherit",
  });

  serverProcess.on("exit", () => {
    serverProcess = null;
  });

  serverProcess.on("error", (error) => {
    console.error("[spilled-native] failed to start local server", error);
  });
}

async function startLocalDashboard() {
  if (process.env.SPILLED_DASHBOARD_URL) {
    return;
  }

  if (await isUrlReachable(dashboardUrl)) {
    return;
  }

  const rootPath = getStoredVaultPath();
  const vaultEnv = {};
  if (rootPath) {
    const { vaultDir } = getNativeVaultPaths(rootPath);
    vaultEnv.SPILLED_VAULT_PATH = vaultDir;
  }

  dashboardProcess = spawnWorkspaceScript(
    ["run", "dev", "-w", "apps/dashboard", "--", "--host", DASHBOARD_HOST, "--port", DASHBOARD_PORT],
    {
      BROWSER: "none",
      ...vaultEnv,
    },
  );

  dashboardProcess.on("exit", () => {
    dashboardProcess = null;
  });

  dashboardProcess.on("error", (error) => {
    console.error("[spilled-native] failed to start local dashboard", error);
  });
}

async function waitForUrl(url, label, timeoutMs = 30000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until timeout.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for ${label} at ${url}`);
}

function createWindow() {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: "#0c0d12",
    icon: getNativeWindowIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.resolve(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.removeMenu();
  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  void mainWindow.loadURL(dashboardUrl);
}

nativeTheme.on("updated", () => {
  if (!mainWindow || mainWindow.isDestroyed() || typeof mainWindow.setIcon !== "function") {
    return;
  }

  mainWindow.setIcon(getNativeWindowIconPath());
});

app.whenReady()
  .then(async () => {
    configureNativeFileSystemPermissions();
    await registerNativeVaultHandlers();
    await startLocalServer();
    await startLocalDashboard();
    await waitForUrl(`http://127.0.0.1:${SERVER_PORT}/api/status`, "local server");
    await waitForUrl(dashboardUrl, "local dashboard");
    createWindow();
  })
  .catch((error) => {
    console.error("[spilled-native] bootstrap failed", error);
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill();
  }
  if (dashboardProcess) {
    dashboardProcess.kill();
  }
});
