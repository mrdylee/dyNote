const { contextBridge, ipcRenderer } = require("electron");
const call = (method, args) => ipcRenderer.invoke(`notes:${method}`, args);
contextBridge.exposeInMainWorld(
  "notes",
  Object.freeze({
    snapshot: () => call("snapshot"),
    pickVault: () => call("pick-vault"),
    createNote: (args) => call("create", args),
    saveNote: (args) => call("save", args),
    createDocument: (args) => call("create-document", args),
    saveDocument: (args) => call("save-document", args),
    importAttachment: (args) => call("import-attachment", args),
    chooseAttachments: (args) => call("choose-attachments", args),
    readAttachment: (args) => call("read-attachment", args),
    moveFile: (args) => call("move-file", args),
    trashFile: (args) => call("trash-file", args),
    restoreTrash: (args) => call("restore-trash", args),
    showRecovery: () => call("recovery"),
    openExternal: (url) => call("external", url),
    confirmClose: () => ipcRenderer.send("notes:close-ready"),
    onBeforeClose: (callback) => {
      const listener = () => callback();
      ipcRenderer.on("notes:before-close", listener);
      return () => ipcRenderer.removeListener("notes:before-close", listener);
    },
  }),
);
