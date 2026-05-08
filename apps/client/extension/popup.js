const statusEl = document.getElementById("status");
const detailsEl = document.getElementById("details");
const refreshBtn = document.getElementById("refresh");

function render(result) {
  if (!result) {
    statusEl.textContent = "No response.";
    detailsEl.textContent = "";
    return;
  }

  if (!result.ok) {
    statusEl.textContent = `Unavailable: ${result.error}`;
    detailsEl.textContent = "";
    return;
  }

  statusEl.textContent = `Connected via ${result.payload.origin}`;
  detailsEl.textContent = JSON.stringify(result.payload.data, null, 2);
}

function getStatus() {
  chrome.runtime.sendMessage(
    {
      namespace: "spilledcinema",
      action: "getStatus",
    },
    render,
  );
}

refreshBtn.addEventListener("click", getStatus);
getStatus();
