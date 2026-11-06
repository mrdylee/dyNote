const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sticky", Object.freeze({
  state: () => ipcRenderer.invoke("sticky:state"),
  edit: (content, moveVersion) => ipcRenderer.send("sticky:edit", content, moveVersion),
  openLink: (target, kind, moveVersion) => ipcRenderer.send("sticky:open-link", target, kind, moveVersion),
  pin: () => ipcRenderer.send("sticky:pin"),
  close: () => ipcRenderer.send("sticky:close"),
  onPinned: callback => { ipcRenderer.on("sticky:pinned", (_event, pinned) => callback(pinned)); },
  onStatus: callback => { ipcRenderer.on("sticky:status", (_event, status) => callback(status)); },
  onMoved: callback => { ipcRenderer.on("sticky:moved", (_event, move) => callback(move)); },
}));
