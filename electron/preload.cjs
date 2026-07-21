const { contextBridge, ipcRenderer, webUtils } = require("electron");

const listeners = new Map();

// Keep exactly one Electron listener regardless of how many app-level events
// React subscribes to. Besides avoiding EventEmitter warnings, this makes the
// bridge's cleanup correct when the same callback is used for multiple names.
ipcRenderer.on("muro:event", (_event, eventName, payload) => {
  for (const listener of listeners.get(eventName) ?? []) {
    listener(payload);
  }
});

const on = (name, listener) => {
  const namedListeners = listeners.get(name) ?? new Set();
  namedListeners.add(listener);
  listeners.set(name, namedListeners);
  return () => {
    namedListeners.delete(listener);
    if (namedListeners.size === 0) listeners.delete(name);
  };
};

contextBridge.exposeInMainWorld("muro", {
  platform: process.platform,
  invoke: (command, args = {}) => ipcRenderer.invoke("muro:invoke", command, args),
  on,
  appDataDir: () => ipcRenderer.invoke("muro:app-data-dir"),
  clipboardHasImage: () => ipcRenderer.invoke("muro:clipboard-has-image"),
  cacheClipboardCoverArt: () => ipcRenderer.invoke("muro:cache-clipboard-cover-art"),
  windowControl: (action) => ipcRenderer.invoke("muro:window-control", action),
  isWindowMaximized: () => ipcRenderer.invoke("muro:window-is-maximized"),
  openDialog: (options = {}) => ipcRenderer.invoke("muro:open-dialog", options),
  saveDialog: (options = {}) => ipcRenderer.invoke("muro:save-dialog", options),
  openExternal: (url) => ipcRenderer.invoke("muro:open-external", url),
  showItemInFolder: (filePath) => ipcRenderer.invoke("muro:show-item-in-folder", filePath),
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
