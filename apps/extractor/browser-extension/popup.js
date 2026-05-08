const appOriginInput = document.getElementById("appOrigin");
const sessionIdInput = document.getElementById("sessionId");
const startButton = document.getElementById("startButton");
const reviewButton = document.getElementById("reviewButton");
const statusNode = document.getElementById("status");

function setStatus(message, kind = "") {
  statusNode.textContent = message;
  statusNode.className = `status ${kind}`.trim();
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function restoreState() {
  const { appOrigin = "http://localhost:3000", sessionId = "" } =
    await chrome.storage.local.get(["appOrigin", "sessionId"]);

  appOriginInput.value = appOrigin;
  sessionIdInput.value = sessionId;
}

async function persistState() {
  await chrome.storage.local.set({
    appOrigin: appOriginInput.value.trim(),
    sessionId: sessionIdInput.value.trim(),
  });
}

startButton.addEventListener("click", async () => {
  const appOrigin = appOriginInput.value.trim().replace(/\/+$/, "");
  const sessionId = sessionIdInput.value.trim();

  if (!/^https?:\/\//i.test(appOrigin)) {
    setStatus("App origin must start with http:// or https://", "error");
    return;
  }

  if (!sessionId) {
    setStatus("Session ID is required.", "error");
    return;
  }

  const tab = await getActiveTab();
  if (!tab?.id) {
    setStatus("No active tab found.", "error");
    return;
  }

  await persistState();
  setStatus("Injecting picker...", "");

  chrome.runtime.sendMessage(
    {
      type: "start-picker",
      tabId: tab.id,
      appOrigin,
      sessionId,
    },
    (response) => {
      if (chrome.runtime.lastError) {
        setStatus(chrome.runtime.lastError.message, "error");
        return;
      }

      if (!response?.ok) {
        setStatus(response?.error || "Failed to start picker.", "error");
        return;
      }

      setStatus("Picker is live on the page. Click the player area there.", "ok");
    },
  );
});

reviewButton.addEventListener("click", async () => {
  const appOrigin = appOriginInput.value.trim().replace(/\/+$/, "");
  const sessionId = sessionIdInput.value.trim();

  if (!/^https?:\/\//i.test(appOrigin) || !sessionId) {
    setStatus("Enter both app origin and session ID first.", "error");
    return;
  }

  await persistState();
  await chrome.tabs.create({
    url: `${appOrigin}/capture/${encodeURIComponent(sessionId)}`,
  });
});

restoreState().catch(() => {
  setStatus("Failed to restore saved extension state.", "error");
});
