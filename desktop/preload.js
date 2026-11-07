// Gives the app two narrow tools: web requests through the computer's own network stack,
// and the automatic-update controls.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("cfNet", {
  fetch: (req) => ipcRenderer.invoke("cf-net", req),
  abort: (id) => ipcRenderer.send("cf-net-abort", id),
  info: () => ipcRenderer.invoke("cf-net-info"),
});
contextBridge.exposeInMainWorld("cfApp", {
  booted: () => ipcRenderer.send("cf-booted"),
  onUpdate: (cb) => ipcRenderer.on("cf-update-ready", (_e, info) => cb(info)),
  restart: () => ipcRenderer.send("cf-restart"),
  check: () => ipcRenderer.invoke("cf-update-check"),
  info: () => ipcRenderer.invoke("cf-update-info"),
  installFile: (text) => ipcRenderer.invoke("cf-update-install-file", text),
  setSource: (url) => ipcRenderer.invoke("cf-update-source", url),
});
