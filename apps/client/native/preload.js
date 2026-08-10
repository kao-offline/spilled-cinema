const { contextBridge, ipcRenderer } = require("electron");

const serverUrl = `http://127.0.0.1:${process.env.SPILLED_NATIVE_PORT || "8787"}`;

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return await response.json();
}

contextBridge.exposeInMainWorld("spilledNative", {
  kind: "native",
  serverUrl,
  async requestRuntime(path, init = {}) {
    return await ipcRenderer.invoke("node:rpc", {
      path,
      method: init.method || "GET",
      body: init.body,
    });
  },
  async getStatus() {
    return await getJson(`${serverUrl}/api/status`);
  },
  async connectVault() {
    return await ipcRenderer.invoke("vault:connect");
  },
  async disconnectVault() {
    return await ipcRenderer.invoke("vault:disconnect");
  },
  async getVaultStatus() {
    return await ipcRenderer.invoke("vault:status");
  },
  async readVaultSnapshot() {
    return await ipcRenderer.invoke("vault:readSnapshot");
  },
  async writeVaultSnapshot(text) {
    return await ipcRenderer.invoke("vault:writeSnapshot", text);
  },
  async listVaultArtifacts() {
    return await ipcRenderer.invoke("vault:listArtifacts");
  },
  async writeVaultBlob(fileName, bytes) {
    return await ipcRenderer.invoke("vault:writeBlob", fileName, bytes);
  },
  async writeVaultRecord(episodeId, payload) {
    return await ipcRenderer.invoke("vault:writeRecord", episodeId, payload);
  },
  async removeVaultRecord(episodeId) {
    return await ipcRenderer.invoke("vault:removeRecord", episodeId);
  },
  async clearVaultRecords() {
    return await ipcRenderer.invoke("vault:clearRecords");
  },
});
