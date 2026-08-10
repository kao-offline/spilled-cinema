const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("spilled", {
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (patch) => ipcRenderer.invoke("settings:set", patch),
  },
  verifier: {
    start: () => ipcRenderer.invoke("verifier:start"),
    stop: () => ipcRenderer.invoke("verifier:stop"),
    restart: () => ipcRenderer.invoke("verifier:restart"),
    onState: (callback) => ipcRenderer.on("verifier:state", (_event, state) => callback(state)),
  },
  logs: {
    tail: () => ipcRenderer.invoke("logs:tail"),
    onAppend: (callback) => ipcRenderer.on("logs:append", (_event, chunk) => callback(chunk)),
  },
  status: {
    get: () => ipcRenderer.invoke("status:get"),
    onUpdate: (callback) => ipcRenderer.on("status:update", (_event, status) => callback(status)),
  },
  legacy: {
    scan: () => ipcRenderer.invoke("legacy:scan"),
    replace: () => ipcRenderer.invoke("legacy:replace"),
  },
  updates: {
    check: () => ipcRenderer.invoke("update:check", false),
    getState: () => ipcRenderer.invoke("update:getState"),
    onState: (callback) => ipcRenderer.on("update:state", (_event, state) => callback(state)),
  },
  app: {
    openLogsFolder: () => ipcRenderer.invoke("app:openLogs"),
    quit: () => ipcRenderer.invoke("app:quit"),
  },
});
