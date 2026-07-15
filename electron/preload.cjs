const { contextBridge, ipcRenderer, webUtils } = require("electron");

const listeners = new Map();

const on = (name, listener) => {
  const wrapped = (_event, eventName, payload) => {
    if (eventName === name) listener(payload);
  };
  ipcRenderer.on("muro:event", wrapped);
  listeners.set(listener, wrapped);
  return () => {
    ipcRenderer.removeListener("muro:event", wrapped);
    listeners.delete(listener);
  };
};

contextBridge.exposeInMainWorld("muro", {
  platform: process.platform,
  invoke: (command, args = {}) => ipcRenderer.invoke("muro:invoke", command, args),
  on,
  appDataDir: () => ipcRenderer.invoke("muro:app-data-dir"),
  windowControl: (action) => ipcRenderer.invoke("muro:window-control", action),
  isWindowMaximized: () => ipcRenderer.invoke("muro:window-is-maximized"),
  openDialog: (options = {}) => ipcRenderer.invoke("muro:open-dialog", options),
  saveDialog: (options = {}) => ipcRenderer.invoke("muro:save-dialog", options),
  openExternal: (url) => ipcRenderer.invoke("muro:open-external", url),
  confirmDialog: (message, options = {}) =>
    ipcRenderer.invoke("muro:confirm-dialog", message, options),
});

let dragDepth = 0;
window.addEventListener("dragenter", (event) => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  dragDepth += 1;
  event.preventDefault();
  ipcRenderer.send("muro:native-drag", { kind: "over", paths: [] });
});

window.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
});

window.addEventListener("dragleave", (event) => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    ipcRenderer.send("muro:native-drag", { kind: "leave", paths: [] });
  }
});

window.addEventListener("drop", (event) => {
  if (!event.dataTransfer?.files.length) return;
  event.preventDefault();
  dragDepth = 0;
  const paths = Array.from(event.dataTransfer.files, (file) =>
    webUtils.getPathForFile(file)
  ).filter(Boolean);
  ipcRenderer.send("muro:native-drag", { kind: "drop", paths });
});
