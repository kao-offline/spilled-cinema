const $ = (id) => document.getElementById(id);

const els = {
  pill: $("status-pill"),
  dot: document.querySelector(".brand-dot"),
  nodes: $("stat-nodes"),
  verified: $("stat-verified"),
  degraded: $("stat-degraded"),
  quarantined: $("stat-quarantined"),
  capabilities: $("stat-capabilities"),
  last: $("stat-last"),
  logOutput: $("log-output"),
  followLog: $("follow-log"),
  logState: $("log-state"),
};

function setPill(state) {
  els.pill.textContent = state.running ? "running" : "stopped";
  els.pill.className = `pill ${state.running ? "pill-running" : "pill-stopped"}`;
  els.dot.style.background = state.running ? "var(--ok)" : "var(--muted)";
  els.dot.style.boxShadow = state.running ? "0 0 12px var(--ok)" : "none";
}

function applyStatus(status) {
  if (!status) {
    els.nodes.textContent = "–";
    els.verified.textContent = "–";
    els.degraded.textContent = "–";
    els.quarantined.textContent = "–";
    els.capabilities.textContent = "–";
    els.last.textContent = "–";
    return;
  }
  els.nodes.textContent = String(status.nodes ?? 0);
  els.verified.textContent = String(status.verified ?? 0);
  els.degraded.textContent = String(status.degraded ?? 0);
  els.quarantined.textContent = String(status.quarantined ?? 0);
  const total = status.capabilitiesTotal ?? 0;
  els.capabilities.textContent = `${status.capabilitiesVerified ?? 0}${total ? `/${total}` : ""}`;
  els.last.textContent = new Date(status.lastRunAt).toLocaleTimeString();
}

function appendLog(chunk) {
  const previous = els.logOutput.textContent;
  els.logOutput.textContent = (previous + chunk)
    .split("\n")
    .slice(-2000)
    .join("\n");
  if (els.followLog.checked) {
    els.logOutput.scrollTop = els.logOutput.scrollHeight;
  }
  els.logState.textContent = `${els.logOutput.textContent.split("\n").length} lines`;
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
    tab.classList.add("active");
    $(`tab-${tab.dataset.tab}`).classList.add("active");
    if (tab.dataset.tab === "logs") {
      els.logOutput.scrollTop = els.logOutput.scrollHeight;
    }
  });
});

$("btn-restart").addEventListener("click", async () => {
  await window.spilled.verifier.restart();
});

$("btn-logs-folder").addEventListener("click", () => {
  void window.spilled.app.openLogsFolder();
});

$("btn-clear-log").addEventListener("click", () => {
  els.logOutput.textContent = "";
  els.logState.textContent = "0 lines";
});

$("btn-check-updates").addEventListener("click", async () => {
  $("update-state").textContent = "Checking for updates…";
  await window.spilled.updates.check();
});

$("btn-quit").addEventListener("click", () => {
  void window.spilled.app.quit();
});

$("btn-save-settings").addEventListener("click", async () => {
  const patch = {
    controlPlaneUrl: $("set-control-plane-url").value.trim(),
    gatewayUrl: $("set-gateway-url").value.trim(),
    controlPlaneSecret: $("set-secret").value,
    probesJson: $("set-probes").value.trim(),
    once: $("set-once").checked,
    autoStart: $("set-autostart").checked,
    replaceLegacyOnStart: $("set-replace-legacy").checked,
  };
  await window.spilled.settings.set(patch);
  const saved = $("settings-saved");
  saved.textContent = "Saved. Restart the verifier to apply changes.";
  setTimeout(() => {
    saved.textContent = "";
  }, 4000);
});

$("btn-replace-legacy").addEventListener("click", async () => {
  const button = $("btn-replace-legacy");
  button.disabled = true;
  button.textContent = "Replacing…";
  const result = await window.spilled.legacy.replace();
  button.disabled = false;
  button.textContent = "Replace legacy verifier";
  const lines = [
    ...result.stopped.docker.map((name) => `stopped container: ${name}`),
    ...result.stopped.processes.map((name) => `stopped process: ${name}`),
    ...result.errors.map((error) => `error: ${error}`),
  ];
  if (lines.length === 0) lines.push("No legacy verifier found.");
  $("legacy-scan").textContent = lines.join("\n");
});

function applyUpdateState(state) {
  const label = $("update-state");
  switch (state.stage) {
    case "idle":
      label.textContent = "Not checked yet — press Check for updates.";
      break;
    case "checking":
      label.textContent = "Checking for updates…";
      break;
    case "available":
      label.textContent = `Update ${state.version} available — downloading.`;
      break;
    case "downloading":
      label.textContent = `Downloading update… ${state.percent}%`;
      break;
    case "downloaded":
      label.textContent = `Update ${state.version} ready — will install on quit.`;
      break;
    case "up-to-date":
      label.textContent = "You are up to date.";
      break;
    case "error":
      label.textContent = `Update check failed: ${state.message}`;
      break;
    default:
      label.textContent = "Checking for updates…";
  }
}

async function init() {
  const [settings, status, log, legacy, updateState] = await Promise.all([
    window.spilled.settings.get(),
    window.spilled.status.get(),
    window.spilled.logs.tail(),
    window.spilled.legacy.scan(),
    window.spilled.updates.getState(),
  ]);

  $("set-control-plane-url").value = settings.controlPlaneUrl || "";
  $("set-gateway-url").value = settings.gatewayUrl || "";
  $("set-secret").value = settings.controlPlaneSecret || "";
  $("set-probes").value = settings.probesJson || "{}";
  $("set-once").checked = !!settings.once;
  $("set-autostart").checked = !!settings.autoStart;
  $("set-replace-legacy").checked = !!settings.replaceLegacyOnStart;

  applyStatus(status);
  if (log) appendLog(log);

  const legacyLines = [
    ...legacy.dockerContainers.map((name) => `docker container: ${name}`),
    ...legacy.oldProcesses.map((line) => `process: ${line.split("|")[0]}`),
  ];
  $("legacy-scan").textContent = legacyLines.length
    ? legacyLines.join("\n")
    : "No legacy verifier detected.";

  window.spilled.logs.onAppend(appendLog);
  window.spilled.status.onUpdate(applyStatus);
  window.spilled.verifier.onState(setPill);
  applyUpdateState(updateState);
  window.spilled.updates.onState(applyUpdateState);
}

void init();
