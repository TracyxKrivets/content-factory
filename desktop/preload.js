// Gives the app one narrow tool: make web requests through the computer's own network stack.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("cfNet", {
  fetch: (req) => ipcRenderer.invoke("cf-net", req),
  abort: (id) => ipcRenderer.send("cf-net-abort", id),
  info: () => ipcRenderer.invoke("cf-net-info"),
});
