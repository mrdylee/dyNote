const { contextBridge, ipcRenderer } = require("electron");
const call = (method, args) => ipcRenderer.invoke(`notes:${method}`, args);
contextBridge.exposeInMainWorld(
  "notes",
  Object.freeze({
    snapshot: () => call("snapshot"),
    pickVault: () => call("pick-vault"),
    vaults: () => call("vaults"),
    selectVault: (args) => call("select-vault", args),
    forgetVault: (args) => call("forget-vault", args),
    gitHistory: (args) => call("git-history", args),
    previewGit: (args) => call("git-preview", args),
    restoreGit: (args) => call("git-restore", args),
    onOpenSettings: (callback) => {
      const listener = () => callback();
      ipcRenderer.on("notes:open-settings", listener);
      return () => ipcRenderer.removeListener("notes:open-settings", listener);
    },
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
    gitStatus: (args) => call("git-status", args),
    connectGit: (args) => call("git-connect", args),
    cloneGit: (args) => call("git-clone", args),
    syncGit: (args) => call("git-sync", args),
    disconnectGit: (args) => call("git-disconnect", args),
    onGitStatus: (callback) => {
      const listener = (_event, status) => callback(status);
      ipcRenderer.on("notes:git-status", listener);
      return () => ipcRenderer.removeListener("notes:git-status", listener);
    },
    confirmClose: () => ipcRenderer.send("notes:close-ready"),
    onBeforeClose: (callback) => {
      const listener = () => callback();
      ipcRenderer.on("notes:before-close", listener);
      return () => ipcRenderer.removeListener("notes:before-close", listener);
    },
  }),
);
