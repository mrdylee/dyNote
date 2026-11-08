import { contextMenuTemplate } from "./context-menu.mjs";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  session,
  shell,
  Menu,
  clipboard,
  powerMonitor,
} from "electron";
import { readFile, writeFile, mkdir, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Vault, validFilePath } from "../core/vault.mjs";
import { canTrashFolder } from "../core/file-tree.mjs";
import { assetPath, safeExternalUrl, trustedFrame, allowFontPermission, allowAudioPermission } from "../core/security.mjs";
import { openWebViewer } from "./web-viewer.mjs";
import { demoNotes } from "../core/demo.mjs";
import { VaultRegistry } from "./vault-registry.mjs";
import { GitHistory } from "../core/git-history.mjs";
import { GitWorkspace } from "../core/git-workspace.mjs";
import { UpdateManager } from "../core/update-manager.mjs";
import { GitController } from "./git-controller.mjs";
import { GitBackup, validateGitConfig } from "../core/git-backup.mjs";
import { PluginController } from "./plugin-controller.mjs";
import { CopilotController } from "./copilot-controller.mjs";
import { CodexController } from "./codex-controller.mjs";
import { ClaudeController } from "./claude-controller.mjs";
import { AiExtensions } from "./ai-extensions.mjs";
import { CopilotJournal } from "./copilot-journal.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "..", "dist");
app.setName("Dynote");
// Keep the original storage location so existing vault settings and recovery copies remain available.
app.setPath("userData", path.join(app.getPath("appData"), "Open Notes"));
protocol.registerSchemesAsPrivileged([
  {
    scheme: "notes",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
if (process.env.OPEN_NOTES_DATA)
  app.setPath("userData", path.resolve(process.env.OPEN_NOTES_DATA));
let window;
let vault;
let closeReady = false;
let closePending = false;
let recovery;
let registry;
let vaultError = "";
let restoring = false;
let automaticCaptureVaultId = null;
let activeMutations = 0;
let gitBackup;
const openedVaults = new Map();
let copilot;
let codex, claude;
let aiExtensions, aiExtensionsChanging = false;
let plugins;
let updates;
let copilotJournal;

function validateSender(event) {
  if (
    !window ||
    event.sender !== window.webContents ||
    !trustedFrame(
      event.senderFrame?.url,
      event.senderFrame === window.webContents.mainFrame,
    )
  )
    throw new Error("신뢰할 수 없는 요청입니다.");
}

function checkVault(args, target = vault) {
  if (!target || !args || args.vaultId !== target.id)
    throw new Error("보관함이 변경되었습니다. 문서를 다시 열어 주세요.");
}

function togetherEntries() {
  const entries = registry.list().filter(entry => entry.purpose);
  return entries.some(entry => entry.purpose === "personal") && entries.some(entry => entry.purpose === "team") ? entries : [];
}

function openVaultController(target, refresh = false) {
  const existing = openedVaults.get(target.id);
  if (existing) {
    if (refresh) existing.ready = existing.git.open(target);
    return existing;
  }
  const git = new GitController({
    settingsFile: path.join(app.getPath("userData"), "git-backup.json"),
    onStatus: status => {
      if (window && !window.webContents.isDestroyed()) window.webContents.send("notes:git-status", status);
    },
  });
  const entry = { vault: target, git, ready: git.open(target) };
  openedVaults.set(target.id, entry);
  return entry;
}

function pruneVaultControllers() {
  const roots = new Set(togetherEntries().map(entry => entry.root));
  for (const [id, entry] of openedVaults) {
    if (id === vault?.id || roots.has(entry.vault.root)) continue;
    entry.git.close();
    openedVaults.delete(id);
  }
}

function workspaceVault(id) {
  if (id === vault?.id) return vault;
  const entry = openedVaults.get(id);
  return entry && togetherEntries().some(space => space.root === entry.vault.root) ? entry.vault : null;
}

async function workspaceSnapshots() {
  const entries = togetherEntries();
  const spaces = await Promise.all(entries.map(async space => {
    try {
      if (await registry.checkPurpose(space.root) !== space.root) throw new Error("폴더 위치가 변경되었습니다.");
      const target = await Vault.open(space.root, recovery);
      if (target.root !== space.root) throw new Error("폴더 위치가 변경되었습니다.");
      if (!togetherEntries().some(entry => entry.root === space.root && entry.purpose === space.purpose)) return null;
      const entry = openVaultController(target);
      const snapshot = await entry.vault.snapshot();
      await entry.ready;
      if (!workspaceVault(snapshot.id)) return null;
      return { ...space, snapshot };
    } catch (error) {
      return { ...space, error: error.message };
    }
  }));
  pruneVaultControllers();
  return spaces.filter(Boolean);
}

async function changeAiExtensions(action) {
  if (aiExtensionsChanging || [copilot, codex, claude].some(controller => controller?.job || controller?.loginJob))
    throw new Error("AI 작업이 끝난 뒤 MCP·스킬 연결을 변경해 주세요.");
  aiExtensionsChanging = true;
  try { return await action(); }
  finally { aiExtensionsChanging = false; }
}

function sendAi(controller, args) {
  checkVault(args, args?.workspace === true ? workspaceVault(args.vaultId) : vault);
  if (aiExtensionsChanging) throw new Error("MCP·스킬 연결을 변경 중입니다. 잠시 후 다시 보내 주세요.");
  return controller.send(args);
}

async function selectVault(root, purpose) {
  await registry.checkConnection(root, purpose);
  await Promise.all([copilot?.cancel(), codex?.cancel(), claude?.cancel()]);
  const opened = await Vault.open(root, recovery);
  const selected = openedVaults.get(opened.id)?.vault ?? opened;
  const snapshot = await selected.snapshot();
  await plugins?.close();
  await registry.select(selected.root, purpose);
  vault = selected; vaultError = "";
  const entry = openVaultController(vault, true);
  gitBackup = entry.git;
  await entry.ready;
  pruneVaultControllers();
  await plugins?.activate(vault);
  return snapshot;
}

async function initialVault() {
  try {
    await registry.load();
    if (registry.selected) return await Vault.open(registry.selected, recovery);
    const demo = path.join(app.getPath("userData"), "처음 만나는 노트");
    for (const [relative, content] of Object.entries(demoNotes)) {
      const file = path.join(demo, relative);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content, { flag: "wx", mode: 0o600 }).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
    }
    const selected = await Vault.open(demo, recovery);
    await registry.select(selected.root);
    return selected;
  } catch (error) {
    vaultError = `보관함을 열지 못했습니다. 설정에서 경로를 확인해 주세요. ${registry.selected ?? ""} · ${error.message}`;
    return null;
  }
}

app
  .whenReady()
  .then(async () => {
    recovery = path.join(app.getPath("userData"), "recovery");
    registry = new VaultRegistry(path.join(app.getPath("userData"), "settings.json"));
    await mkdir(app.getPath("userData"), { recursive: true });
    aiExtensions = new AiExtensions({ file: path.join(app.getPath("userData"), "ai-extensions.json") });
    await aiExtensions.load().catch(() => {}); // The registry reports its preserved load error in the panel.
    vault = await initialVault();
    copilotJournal = new CopilotJournal({file:path.join(app.getPath("userData"),"copilot-journal.json"),sourceRoot:path.join(app.getPath("appData"),"Code","User","workspaceStorage")});
    await copilotJournal.load().catch(() => {});
    updates = new UpdateManager({directory:path.join(app.getPath("userData"),"updates"),current:app.getVersion(),
      onChange: state => {if(window&&!window.webContents.isDestroyed())window.webContents.send("notes:update-status",state);}});
    await updates.init();
    if (vault) {
      const entry = openVaultController(vault);
      gitBackup = entry.git;
      await entry.ready;
    }
    const getNotes = async (vaultId) => {
      const target = workspaceVault(vaultId);
      checkVault({ vaultId }, target);
      return (await target.snapshot()).notes;
    };
    const getExtensions = () => aiExtensions.getExtensions();
    copilot = new CopilotController({
      directory: path.join(app.getPath("userData"), "copilot"), getNotes, getExtensions,
      openExternal: (url) => shell.openExternal(url),
      onEvent: (event) => {
        if (window && !window.webContents.isDestroyed()) window.webContents.send("notes:copilot-event", event);
      },
    });
    const cliOptions = (provider) => ({
      directory: path.join(app.getPath("userData"), provider),
      openExternal: url => shell.openExternal(url),
      onEvent: event => { if (window && !window.webContents.isDestroyed()) window.webContents.send(`notes:${provider}-event`, event); },
    });
    codex = new CodexController({ ...cliOptions("codex"), getNotes, getExtensions });
    claude = new ClaudeController(cliOptions("claude"));
    protocol.handle("notes", async (request) => {
      try {
        const url = new URL(request.url);
        if (url.host === "vault") {
          const parts = decodeURIComponent(url.pathname).slice(1).split("/");
          const target = workspaceVault(parts.shift());
          if (!target) return new Response("Forbidden", { status: 403 });
          const asset = await target.readAttachment(parts.join("/"));
          if (!asset.mime.startsWith("image/"))
            return new Response("Forbidden", { status: 403 });
          return new Response(asset.bytes, {
            headers: {
              "Content-Type": asset.mime,
              "X-Content-Type-Options": "nosniff",
              "Cache-Control": "no-store",
            },
          });
        }
        if (/^plugin-[a-f0-9]{16}-[a-z0-9][a-z0-9-]{0,79}$/.test(url.host)) {
          if (url.pathname !== "/plugin.html" && !url.pathname.startsWith("/assets/")) return new Response("Forbidden", { status: 403 });
          url.host = "app";
        }
        const file = assetPath(url.href, dist);
        const mime = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript",
          ".mjs": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".woff2": "font/woff2",
          ".wasm": "application/wasm",
          ".glb": "model/gltf-binary",
        };
        return new Response(await readFile(file), {
          headers: { "Content-Type": mime[path.extname(file)] },
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    });
    session.defaultSession.setPermissionRequestHandler(
      (contents, permission, callback, details) => callback(contents === window?.webContents && (allowFontPermission(permission, details.requestingUrl, details.isMainFrame) || allowAudioPermission(permission, details.requestingUrl, details.isMainFrame, details.mediaTypes))),
    );
    session.defaultSession.setPermissionCheckHandler((contents, permission, origin, details) =>
      contents === window?.webContents && ["notes://app", "notes://app/"].includes(origin) && (allowFontPermission(permission, details.requestingUrl, details.isMainFrame) || allowAudioPermission(permission, details.requestingUrl, details.isMainFrame, [details.mediaType])));
    session.defaultSession.webRequest.onBeforeRequest(
      {
        urls: [
          "http://*/*",
          "https://*/*",
          "ws://*/*",
          "wss://*/*",
          "ftp://*/*",
        ],
      },
      (_details, callback) => callback({ cancel: true }),
    );
    window = new BrowserWindow({
      width: 1420,
      height: 940,
      minWidth: 1050,
      minHeight: 700,
      title: "Dynote",
      backgroundColor: "#ffffff",
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
      ...(process.platform === "darwin"
        ? { trafficLightPosition: { x: 18, y: 19 } }
        : { icon: path.join(dist, "brand", "dynote.png") }),
      webPreferences: {
        preload: path.join(here, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
      },
    });
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [{ role: "about" }, { type: "separator" },
            { id: "dynote-settings", label: "설정…", accelerator: "CmdOrCtrl+,", click: () => window.webContents.send("notes:open-settings") },
            { type: "separator" }, { role: "quit" }],
        },
        {
          label: "편집",
          submenu: [
            { role: "undo" },
            { role: "redo" },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
            { role: "selectAll" },
          ],
        },
        {
          label: "보기",
          submenu: [
            { role: "togglefullscreen" },
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
          ],
        },
      ]),
    );
    window.webContents.on("context-menu", (_event, params) => {
      const menu = Menu.buildFromTemplate(contextMenuTemplate(params,
        format => window.webContents.send("notes:format-editor", format),
        () => window.webContents.send("notes:open-settings", "fonts")));
      menu.popup({ window });
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.on("will-attach-webview", (event) =>
      event.preventDefault(),
    );
    window.webContents.on("render-process-gone", (_event, details) =>
      console.error("Renderer stopped:", details.reason),
    );
    window.webContents.on("did-fail-load", (_event, code, text) =>
      console.error("Load failed:", code, text),
    );
    plugins = new PluginController({
      directory: path.join(app.getPath("userData"), "plugins"), BrowserWindow, ipcMain,
      getVault: () => vault,
      onStatus: value => { if (!window.webContents.isDestroyed()) window.webContents.send("notes:plugin-status", value); },
      onOpen: value => { if (value.created) gitBackup.markDirty(value.vaultId); if (!window.webContents.isDestroyed()) window.webContents.send("notes:plugin-open-note", value); },
    });
    const scopedActions = new Set([
      "capture-status", "capture-configure", "capture-source", "capture-sync", "capture-trash", "capture-restore", "snapshot",
      "git-history", "classification-preview", "classification-apply", "composer-preview", "composer-apply", "pdf-preview", "pdf-apply",
      "git-workspace-status", "git-workspace-diff", "git-workspace-action", "git-preview", "git-restore",
      "git-status", "git-connect", "git-sync", "git-disconnect", "git-clone",
      "create", "open-or-create", "save", "create-document", "save-document", "import-attachment", "read-attachment", "copy-text", "choose-attachments",
      "move-file", "trash-file", "trash-folder", "restore-trash", "recovery",
    ]);
    for (const [name, action] of Object.entries({
      "plugins-list": args => { checkVault(args); return plugins.status(); },
      "plugin-import": async args => {
        checkVault(args);
        const selected = await dialog.showOpenDialog(window, { title: "Obsidian 플러그인 폴더 가져오기", properties: ["openDirectory"] });
        if (selected.canceled) return null;
        checkVault(args); return plugins.import(selected.filePaths[0]);
      },
      "plugin-enable": async args => { checkVault(args); if (args.enabled === true) await plugins.enable(args.id); else await plugins.disable(args.id); return plugins.status(); },
      "plugin-show": args => { checkVault(args); plugins.show(args.id, args.settings === true); },
      "plugin-command": args => { checkVault(args); plugins.execute(args.id, args.command); },
      "plugin-context": args => { checkVault(args); plugins.update({ notes: args.notes, active: args.active, dailyOptions: args.dailyOptions }); },
      "ai-extensions": () => aiExtensions.snapshot(),
      "ai-import-mcp": () => changeAiExtensions(async () => {
        const selected = await dialog.showOpenDialog(window, { title: "MCP 설정 JSON 파일 연결", filters: [{ name: "JSON", extensions: ["json"] }], properties: ["openFile"] });
        return selected.canceled ? aiExtensions.snapshot() : aiExtensions.addConfig(selected.filePaths[0]);
      }),
      "ai-add-skills": () => changeAiExtensions(async () => {
        const selected = await dialog.showOpenDialog(window, { title: "스킬 폴더 연결", properties: ["openDirectory"] });
        return selected.canceled ? aiExtensions.snapshot() : aiExtensions.addSkills(selected.filePaths[0]);
      }),
      "ai-remove-extension": args => changeAiExtensions(() => aiExtensions.remove(args)),
      "copilot-status": () => copilot.status(),
      "codex-status": () => codex.status(),
      "codex-login": () => codex.login(),
      "codex-cancel-login": () => codex.cancelLogin(),
      "codex-send": args => sendAi(codex, args),
      "codex-cancel": args => codex.cancel(args?.requestId),
      "claude-status": () => claude.status(),
      "claude-login": () => claude.login(),
      "claude-cancel-login": () => claude.cancelLogin(),
      "claude-send": args => sendAi(claude, args),
      "claude-cancel": args => claude.cancel(args?.requestId),
      "check-updates": () => updates.check(true),
      "update-state": () => updates.state,
      "update-settings": args => updates.configure(args),
      "update-download": () => updates.download(),
      "update-show": async () => {shell.showItemInFolder(await updates.readyPath());return true;},
      "open-web-viewer": (args) => openWebViewer(args?.url, window),
      "copilot-login": () => copilot.login(),
      "copilot-cancel-login": () => copilot.cancelLogin(),
      "copilot-send": args => sendAi(copilot, args),
      "copilot-cancel": (args) => copilot.cancel(args?.requestId),
      "capture-status": (args, vault) => { checkVault(args, vault); return copilotJournal.status(vault); },
      "capture-configure": (args, vault) => { checkVault(args, vault); return copilotJournal.configure(vault,args.input,registry.purposes[vault.root]==="personal"); },
      "capture-source": async (args, vault) => {
        checkVault(args, vault);
        if(registry.purposes[vault.root]!=="personal")throw new Error("개인 노트 공간에서 설정해 주세요.");
        const selected=await dialog.showOpenDialog(window,{title:"VS Code workspaceStorage 폴더 선택",properties:["openDirectory"]});
        if(selected.canceled)return null;
        checkVault(args, vault);return copilotJournal.setSource(vault,selected.filePaths[0]);
      },
      "capture-sync": (args, vault, gitBackup) => {
        checkVault(args, vault);if(registry.purposes[vault.root]!=="personal")throw new Error("개인 노트 공간에서 가져와 주세요.");
        return gitBackup.enqueue(()=>{checkVault(args, vault);return copilotJournal.sync(vault,args.dailyOptions,args.manual===true);});
      },
      "capture-trash": (args, vault, gitBackup) => {
        checkVault(args, vault);if(registry.purposes[vault.root]!=="personal")throw new Error("개인 노트 공간에서 삭제해 주세요.");
        return gitBackup.enqueue(()=>{checkVault(args, vault);return copilotJournal.trash(vault,args);});
      },
      "capture-restore": (args, vault, gitBackup) => {
        checkVault(args, vault);if(registry.purposes[vault.root]!=="personal")throw new Error("개인 노트 공간에서 복원해 주세요.");
        return gitBackup.enqueue(()=>{checkVault(args, vault);return copilotJournal.restore(vault,args.trashId);});
      },
      snapshot: (args, vault) => vault ? vault.snapshot() : { id: null, name: "보관함 선택 필요", notes: [], documents: [], attachments: [], warnings: [vaultError] },
      "workspace-snapshots": workspaceSnapshots,
      "vaults": () => ({ entries: registry.list(), current: vault?.root ?? null, error: vaultError }),
      "set-vault-purpose": async (args) => { await registry.setPurpose(args?.root, args?.purpose); pruneVaultControllers(); return true; },
      "select-vault": (args) => {
        if (!registry.roots.includes(args?.root)) throw new Error("등록된 보관함을 선택해 주세요.");
        return selectVault(args.root);
      },
      "forget-vault": async (args) => { await registry.forget(args?.root); pruneVaultControllers(); return { entries: registry.list(), current: vault?.root ?? null, error: vaultError }; },
      "git-history": (args, vault) => { checkVault(args, vault); return new GitHistory(vault).list(args.month); },
      "classification-preview": (args, vault, gitBackup) => { checkVault(args, vault); return gitBackup.enqueue(async()=>{const {JournalClassifier}=await import("../core/journal-classification.mjs");checkVault(args, vault);return new JournalClassifier(vault).preview(args.input);}); },
      "classification-apply": (args, vault, gitBackup) => { checkVault(args, vault); return gitBackup.enqueue(async()=>{const {JournalClassifier}=await import("../core/journal-classification.mjs");checkVault(args, vault);return new JournalClassifier(vault).apply(args.input,args.revision);}); },
      "composer-preview": (args, vault, gitBackup) => { checkVault(args, vault); return gitBackup.enqueue(async () => { const { NoteComposer } = await import("../core/note-composer.mjs"); checkVault(args, vault); return new NoteComposer(vault).preview(args.input); }); },
      "composer-apply": (args, vault, gitBackup) => { checkVault(args, vault); return gitBackup.enqueue(async () => { const { NoteComposer } = await import("../core/note-composer.mjs"); checkVault(args, vault); return new NoteComposer(vault).apply(args.input, args.revision); }); },
      "pdf-preview": (args, vault, gitBackup) => { checkVault(args, vault); return gitBackup.enqueue(async () => { const { PdfEditor } = await import("../core/pdf-editing.mjs"); checkVault(args, vault); return new PdfEditor(vault).preview(args.input); }); },
      "pdf-apply": (args, vault, gitBackup) => { checkVault(args, vault); return gitBackup.enqueue(async () => { const { PdfEditor } = await import("../core/pdf-editing.mjs"); checkVault(args, vault); return new PdfEditor(vault).apply(args.input, args.revision); }); },
      "git-workspace-status": (args, vault, gitBackup) => { checkVault(args, vault); return gitBackup.enqueue(() => { checkVault(args, vault); return new GitWorkspace(vault.root).status(); }); },
      "git-workspace-diff": (args, vault, gitBackup) => { checkVault(args, vault); return gitBackup.enqueue(() => { checkVault(args, vault); return new GitWorkspace(vault.root).diff(args.path, args.staged === true); }); },
      "git-workspace-action": (args, vault, gitBackup) => {
        checkVault(args, vault);
        return gitBackup.enqueue(async () => {
          checkVault(args, vault);
          if (["create-branch", "switch-branch", "delete-branch"].includes(args.action?.kind) && gitBackup.status().enabled)
            throw new Error("브랜치를 변경하기 전에 자동 Git 백업을 꺼 주세요.");
          const status = await new GitWorkspace(vault.root).action(args.action);
          const snapshot = ["pull", "switch-branch", "create-branch"].includes(args.action.kind) ? await vault.snapshot() : null;
          return { status, snapshot };
        });
      },
      "git-preview": (args, vault) => { checkVault(args, vault); return new GitHistory(vault).preview(args.commit); },
      "git-restore": (args, vault, gitBackup) => {
        checkVault(args, vault);
        return gitBackup.enqueue(async () => {
          checkVault(args, vault);
          const result = await new GitHistory(vault).restore(args.commit, args.revision);
          gitBackup.markDirty(vault.id);
          return result;
        });
      },
      "pick-vault": async (args) => {
        const result = await dialog.showOpenDialog(window, {
          properties: ["openDirectory", "createDirectory"],
          title: args?.purpose === "personal" ? "개인 노트 폴더 선택" : args?.purpose === "team" ? "팀 공유 노트 폴더 선택" : "Markdown 보관함 선택",
        });
        if (result.canceled) return null;
        return selectVault(result.filePaths[0], args?.purpose);
      },
      "git-status": (args, vault, gitBackup) => { checkVault(args, vault); return gitBackup.status(); },
      "git-connect": (args, vault, gitBackup) => { checkVault(args, vault); return gitBackup.connect(vault.id, args.config); },
      "git-sync": (args, vault, gitBackup) => { checkVault(args, vault); return gitBackup.sync(vault.id); },
      "git-disconnect": (args, vault, gitBackup) => { checkVault(args, vault); return gitBackup.disconnect(vault.id); },
      "git-clone": async (args, source) => {
        checkVault(args, source);
        const config = validateGitConfig(args.config);
        const result = await dialog.showOpenDialog(window, { title: "저장소를 가져올 빈 폴더 선택", properties: ["openDirectory", "createDirectory"] });
        if (result.canceled) return null;
        checkVault(args, source);
        const purpose = registry.purposes[source.root];
        await registry.checkConnection(result.filePaths[0], purpose);
        await GitBackup.clone(result.filePaths[0], config);
        const snapshot = await selectVault(result.filePaths[0], purpose);
        try { await gitBackup.connect(vault.id, config); }
        catch (error) { gitBackup.publish({ phase: "error", message: error.message }); }
        return snapshot;
      },
      create: (args, vault) => {
        checkVault(args, vault);
        return vault.create(args.path, args.content);
      },
      "open-or-create": (args, vault) => {
        checkVault(args, vault);
        return vault.openOrCreate(args.path, args.content);
      },
      save: (args, vault) => {
        checkVault(args, vault);
        return vault.save(args.path, args.content, args.revision);
      },
      "create-document": (args, vault) => {
        checkVault(args, vault);
        return vault.createDocument(args.path);
      },
      "save-document": (args, vault) => {
        checkVault(args, vault);
        return vault.saveDocument(args.path, args.content, args.revision);
      },
      "import-attachment": (args, vault) => {
        checkVault(args, vault);
        return vault.importAttachment(args.name, args.bytes);
      },
      "read-attachment": (args, vault) => {
        checkVault(args, vault);
        return vault.readAttachment(args.path);
      },
      "copy-text": (args, vault) => {
        checkVault(args, vault);
        if (typeof args.text !== "string" || args.text.length > 1024 * 1024) throw new Error("복사할 텍스트가 올바르지 않습니다.");
        clipboard.writeText(args.text);
        return true;
      },
      "choose-attachments": async (args, vault) => {
        checkVault(args, vault);
        const result = await dialog.showOpenDialog(window, {
          properties: ["openFile", "multiSelections"],
          filters: [
            {
              name: "이미지·PDF·오디오",
              extensions: ["png", "jpg", "jpeg", "gif", "webp", "pdf", "webm", "wav", "mp3", "ogg", "m4a"],
            },
          ],
        });
        checkVault(args, vault);
        const imported = [];
        if (!result.canceled)
          for (const file of result.filePaths) {
            const handle = await import("node:fs/promises").then((fs) =>
              fs.open(file, "r"),
            );
            try {
              if ((await handle.stat()).size > 25 * 1024 * 1024)
                throw new Error("첨부파일은 25MB 이하여야 합니다.");
              imported.push(
                await vault.importAttachment(
                  path.basename(file),
                  await handle.readFile(),
                ),
              );
            } finally {
              await handle.close();
            }
          }
        return imported;
      },
      "move-file": (args, vault) => {
        checkVault(args, vault);
        return vault.moveFile(args.from, args.to, args.revision);
      },
      "trash-file": (args, vault) => {
        checkVault(args, vault);
        return vault.trashFile(args.path, args.revision);
      },
      "trash-folder": (args, vault, gitBackup) => {
        checkVault(args, vault);
        return gitBackup.enqueue(async () => {
          checkVault(args, vault);
          if (!validFilePath(`${args.path}/folder.md`) || !canTrashFolder(args.path, args.protectedFolders))
            throw new Error("기본 폴더이거나 허용되지 않는 폴더 경로입니다.");
          if (await realpath(vault.root) !== vault.root) throw new Error("보관함 경로가 바뀌었습니다. 보관함을 다시 열어 주세요.");
          await vault.snapshot();
          let folder = vault.root;
          for (const part of args.path.split("/")) {
            folder = path.join(folder, part);
            const stat = await lstat(folder);
            if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("보관함 안의 일반 폴더만 휴지통으로 이동할 수 있습니다.");
          }
          folder = await realpath(folder);
          const relative = path.relative(vault.root, folder);
          if (!relative || path.isAbsolute(relative) || relative.split(path.sep).includes("..")) throw new Error("보관함 밖 폴더는 휴지통으로 이동할 수 없습니다.");
          await shell.trashItem(folder);
          return { path: args.path, systemTrash: true };
        });
      },
      "restore-trash": (args, vault) => {
        checkVault(args, vault);
        return vault.restoreTrash(args.id);
      },
      recovery: async (args, target) => {
        if (args?.vaultId) checkVault(args, target);
        const root = target?.recoveryRoot ?? recovery;
        await mkdir(root, { recursive: true });
        return shell.openPath(root);
      },
      external: (url) => shell.openExternal(safeExternalUrl(url)),
    }))
      ipcMain.handle(`notes:${name}`, async (event, args) => {
        const exclusive = ["git-restore", "pick-vault", "select-vault", "forget-vault", "set-vault-purpose", "git-clone", "git-workspace-action", "composer-apply", "classification-apply", "pdf-apply", "trash-folder", "capture-configure", "capture-source", "capture-sync", "capture-trash", "capture-restore"].includes(name);
        const readOnly = /^(copilot|codex|claude|update|ai)-/.test(name) || ["capture-status", "snapshot", "workspace-snapshots", "vaults", "git-status", "git-history", "git-preview", "git-workspace-status", "git-workspace-diff", "composer-preview", "classification-preview", "pdf-preview", "check-updates", "open-web-viewer", "read-attachment", "copy-text", "recovery", "external"].includes(name);
        let locked = false;
        try {
          validateSender(event);
          const scoped = args?.workspace === true && scopedActions.has(name);
          const target = scoped ? workspaceVault(args.vaultId) : vault;
          if (scoped) checkVault(args, target);
          if (!readOnly) {
            const independentMutation = automaticCaptureVaultId && target && target.id !== automaticCaptureVaultId && !exclusive;
            if ((restoring && !independentMutation) || (exclusive && activeMutations)) throw new Error("다른 저장 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.");
            if (exclusive) {
              restoring = true;
              if (name === "capture-sync" && args?.manual !== true) automaticCaptureVaultId = target?.id ?? null;
            }
            activeMutations++; locked = true;
          }
          const entry = openedVaults.get(target?.id);
          if (entry && scoped) {
            await entry.ready;
            if (workspaceVault(args.vaultId) !== target || await realpath(target.root) !== target.root)
              throw new Error("보관함 위치가 변경되었습니다. 문서를 다시 열어 주세요.");
          }
          const value = await action(args, target, entry?.git);
          if (name.startsWith("capture-") && value) {
            (value.status ?? value).personal = registry.purposes[target.root] === "personal";
            if (value.changed) entry.git.markDirty(target.id);
          }
          if (["create", "save", "create-document", "save-document", "import-attachment", "choose-attachments", "move-file", "trash-file", "trash-folder", "restore-trash", "composer-apply", "classification-apply", "pdf-apply"].includes(name)) entry?.git.markDirty(target.id);
          return { ok: true, value };
        } catch (error) {
          return { ok: false, error: error.message };
        } finally {
          if (locked) {
            activeMutations--;
            if (exclusive) { restoring = false; automaticCaptureVaultId = null; }
          }
        }
      });
    ipcMain.on("notes:close-ready", async (event) => {
      try {
        validateSender(event);
        if (restoring) return;
        await plugins.close();
        closeReady = true;
        window.close();
      } catch {
        /* Ignore untrusted senders. */
      }
    });
    window.on("close", (event) => {
      if (closeReady || window.webContents.isDestroyed()) return;
      event.preventDefault();
      if (restoring) return;
      if (!closePending) {
        closePending = true;
        window.webContents.send("notes:before-close");
      }
      // A failed flush may be retried with the next close request.
      setTimeout(() => {
        closePending = false;
      }, 1500);
    });
    await window.loadURL("notes://app/index.html");
    await plugins.activate(vault);
    const checkUpdates = () => updates.check().catch(error=>console.error("Update check:",error.message));
    const updateTimer = setInterval(checkUpdates,60*60*1000);updateTimer.unref();
    const initialUpdate = setTimeout(checkUpdates,10000);initialUpdate.unref();
    powerMonitor.on("resume",checkUpdates);
    app.once("before-quit",()=>{clearInterval(updateTimer);clearTimeout(initialUpdate);powerMonitor.removeListener("resume",checkUpdates);});
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

app.on("window-all-closed", async () => {
  for (const entry of openedVaults.values()) entry.git.close();
  await Promise.race([Promise.allSettled([copilot?.close(), codex?.close(), claude?.close()]), new Promise((resolve) => setTimeout(resolve, 3000))]);
  app.quit();
});

app.on("before-quit", async event => {
  if (!plugins?.instances.size) return;
  event.preventDefault();
  await plugins.close();
  app.quit();
});
