const { contextBridge, ipcRenderer } = require("electron");
const call = (method, args) => ipcRenderer.invoke(`notes:${method}`, args);
contextBridge.exposeInMainWorld(
  "notes",
  Object.freeze({
    snapshot: args => call("snapshot", args),
    workspaceSnapshots: () => call("workspace-snapshots"),
    captureStatus: args => call("capture-status", args),
    configureCapture: args => call("capture-configure", args),
    pickCaptureSource: args => call("capture-source", args),
    syncCapture: args => call("capture-sync", args),
    trashCapture: args => call("capture-trash", args),
    restoreCapture: args => call("capture-restore", args),
    plugins: args => call("plugins-list", args),
    importPlugin: args => call("plugin-import", args),
    enablePlugin: args => call("plugin-enable", args),
    showPlugin: args => call("plugin-show", args),
    pluginCommand: args => call("plugin-command", args),
    pluginContext: args => call("plugin-context", args),
    onPluginStatus: callback => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on("notes:plugin-status", listener);
      return () => ipcRenderer.removeListener("notes:plugin-status", listener);
    },
    onPluginOpen: callback => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on("notes:plugin-open-note", listener);
      return () => ipcRenderer.removeListener("notes:plugin-open-note", listener);
    },
    updateState: () => call("update-state"),
    updateSettings: args => call("update-settings",args),
    downloadUpdate: () => call("update-download"),
    showUpdate: () => call("update-show"),
    onUpdateStatus: callback => { const listener=(_event,value)=>callback(value);ipcRenderer.on("notes:update-status",listener);return()=>ipcRenderer.removeListener("notes:update-status",listener); },
    checkUpdates: (args) => call("check-updates", args),
    openWebViewer: (args) => call("open-web-viewer", args),
    previewClassification: args => call("classification-preview", args),
    applyClassification: args => call("classification-apply", args),
    previewComposition: (args) => call("composer-preview", args),
    applyComposition: (args) => call("composer-apply", args),
    previewPdf: (args) => call("pdf-preview", args),
    applyPdf: (args) => call("pdf-apply", args),
    aiExtensions: () => call("ai-extensions"),
    aiImportMcp: () => call("ai-import-mcp"),
    aiAddSkills: () => call("ai-add-skills"),
    aiRemoveExtension: args => call("ai-remove-extension", args),
    copilotStatus: () => call("copilot-status"),
    codexStatus: () => call("codex-status"),
    codexLogin: () => call("codex-login"),
    codexCancelLogin: () => call("codex-cancel-login"),
    codexSend: args => call("codex-send", args),
    codexCancel: args => call("codex-cancel", args),
    onCodexEvent: callback => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on("notes:codex-event", listener);
      return () => ipcRenderer.removeListener("notes:codex-event", listener);
    },
    claudeStatus: () => call("claude-status"),
    claudeLogin: () => call("claude-login"),
    claudeCancelLogin: () => call("claude-cancel-login"),
    claudeSend: args => call("claude-send", args),
    claudeCancel: args => call("claude-cancel", args),
    onClaudeEvent: callback => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on("notes:claude-event", listener);
      return () => ipcRenderer.removeListener("notes:claude-event", listener);
    },
    copilotLogin: () => call("copilot-login"),
    copilotCancelLogin: () => call("copilot-cancel-login"),
    copilotSend: (args) => call("copilot-send", args),
    copilotCancel: (args) => call("copilot-cancel", args),
    onCopilotEvent: (callback) => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on("notes:copilot-event", listener);
      return () => ipcRenderer.removeListener("notes:copilot-event", listener);
    },
    pickVault: (args) => call("pick-vault", args),
    vaults: () => call("vaults"),
    setVaultPurpose: (args) => call("set-vault-purpose", args),
    selectVault: (args) => call("select-vault", args),
    forgetVault: (args) => call("forget-vault", args),
    gitHistory: (args) => call("git-history", args),
    gitWorkspaceStatus: (args) => call("git-workspace-status", args),
    gitWorkspaceDiff: (args) => call("git-workspace-diff", args),
    gitWorkspaceAction: (args) => call("git-workspace-action", args),
    previewGit: (args) => call("git-preview", args),
    restoreGit: (args) => call("git-restore", args),
    onOpenSettings: (callback) => {
      const listener = (_event, tab) => callback(tab);
      ipcRenderer.on("notes:open-settings", listener);
      return () => ipcRenderer.removeListener("notes:open-settings", listener);
    },
    onFormatEditor: callback => {
      const listener = (_event, format, point) => callback(format, point);
      ipcRenderer.on("notes:format-editor", listener);
      return () => ipcRenderer.removeListener("notes:format-editor", listener);
    },
    createNote: (args) => call("create", args),
    openOrCreateNote: (args) => call("open-or-create", args),
    saveNote: (args) => call("save", args),
    createDocument: (args) => call("create-document", args),
    saveDocument: (args) => call("save-document", args),
    importAttachment: (args) => call("import-attachment", args),
    chooseAttachments: (args) => call("choose-attachments", args),
    readAttachment: (args) => call("read-attachment", args),
    copyText: (args) => call("copy-text", args),
    moveFile: (args) => call("move-file", args),
    copyFile: (args) => call("copy-file", args),
    trashFile: (args) => call("trash-file", args),
    trashFolder: (args) => call("trash-folder", args),
    restoreTrash: (args) => call("restore-trash", args),
    showRecovery: args => call("recovery", args),
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
    onStickySaved: (callback) => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on("notes:sticky-saved", listener);
      return () => ipcRenderer.removeListener("notes:sticky-saved", listener);
    },
    confirmClose: (id, ready) => ipcRenderer.send("notes:close-ready", id, ready),
    onBeforeClose: (callback) => {
      const listener = (_event, request) => callback(request);
      ipcRenderer.on("notes:before-close", listener);
      return () => ipcRenderer.removeListener("notes:before-close", listener);
    },
  }),
);
