import { VaultOperations } from "./vault-operations.mjs";
import { documentRef } from "../core/document-workspace.mjs";
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
  safeStorage,
  powerMonitor,
} from "electron";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, realpath, readdir } from "node:fs/promises";
import { DocumentDrafts } from "./document-drafts.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Vault, validNotePath } from "../core/vault.mjs";
import { canTrashFolder, managedCopilotPath, treeRenameDestination } from "../core/file-tree.mjs";
import { assetPath, safeExternalUrl, trustedFrame, allowFontPermission, allowAudioPermission } from "../core/security.mjs";
import { openWebViewer } from "./web-viewer.mjs";
import { demoNotes } from "../core/demo.mjs";
import { VaultRegistry } from "./vault-registry.mjs";
import { GitHistory } from "../core/git-history.mjs";
import { GitWorkspace } from "../core/git-workspace.mjs";
import { validateInternalFeedUrl } from "../core/update-information.mjs";
import { UpdateManager } from "../core/update-manager.mjs";
import { stageUpdate, launchUpdate } from "./update-installer.mjs";
import { GitController } from "./git-controller.mjs";
import { personalConfig } from "../core/personal-sync.mjs";
import { GitBackup, validateGitConfig } from "../core/git-backup.mjs";
import { PluginController } from "./plugin-controller.mjs";
import { CopilotController } from "./copilot-controller.mjs";
import { managedBridgePath, openBridge } from "./bridge-policy.mjs";
import { noteFolderRemotes, noteRemotes } from "./bridge-repositories.mjs";
import { CodexController } from "./codex-controller.mjs";
import { ClaudeController } from "./claude-controller.mjs";
import { AiExtensions } from "./ai-extensions.mjs";
import { CopilotJournal } from "./copilot-journal.mjs";
import { StickyNotes } from "./sticky-notes.mjs";
import { ExternalDocuments } from "../core/external-documents.mjs";
import { createStartupLog } from "./startup-log.mjs";

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
const startup = createStartupLog(app.getPath("userData"));
startup.mark("process.start");
let window;
let vault;
let closePending;
let closeRequestId = 0;
let quitRequested = false;
let quitReady = false;
let finishingQuit = false;
let stickyNotes;
let recovery;
let registry;
let vaultError = "";
const vaultOperations = new VaultOperations();
const activeVaultResource = Symbol("active vault");
const selectionPreparation = Symbol("vault preparation");
let selectionNumber = 0, preparedSelection, activating = false;
let activationTail = Promise.resolve();
let gitBackup;
const openedVaults = new Map();
let copilot;
let cloudBridge;
const remoteOnly = () => cloudBridge && cloudBridge.role !== "worker";
function directCopilot() {
  if (remoteOnly()) throw new Error("이 PC에서는 Cloud Ask를 사용해 주세요.");
  return copilot;
}

let codex, claude;
let aiExtensions, aiExtensionsChanging = false;
let plugins;
let updates;
let updateInstallation;
let copilotJournal;
let temporaryDocuments;

function externalDocuments() {
  return temporaryDocuments ??= new ExternalDocuments(app.getPath("temp"));
}

async function revealFile(key) {
  if (key.startsWith("external:")) {
    shell.showItemInFolder(await externalDocuments().fileLocation(key.slice(9)));
    return;
  }
  const ref = documentRef(key);
  const target = workspaceVault(ref.vaultId);
  checkVault(ref, target);
  shell.showItemInFolder(await target.fileLocation(ref.path));
}

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
  return entries.some(entry => entry.purpose === "personal") ? entries : [];
}

function openVaultController(target, refresh = false) {
  const existing = openedVaults.get(target.id);
  if (existing) {
    if (refresh) existing.ready = existing.git.open(target);
    return existing;
  }
  const git = new GitController({
    secretStorage:safeStorage,
    openExternal:url => shell.openExternal(url),
    checkRemote:remote => cloudBridge?.checkNoteRemote?.(remote),
    settingsFile: path.join(app.getPath("userData"), "git-backup.json"),
    isPersonal: target => registry.purposes[target.root] === "personal",
    onStatus: status => {
      if(status.changed?.length) stickyNotes?.receive(target,status.changed).catch(error=>console.warn("Sticky Note 동기화",error.message));
      if (window && !window.webContents.isDestroyed()) window.webContents.send("notes:git-status", status);
    },
  });
  const entry = { vault: target, git, ready: git.open(target) };
  openedVaults.set(target.id, entry);
  return entry;
}

function stickyRoot() {
  const entries = registry.list();
  return (entries.find(entry => entry.active && entry.purpose === "personal")
    ?? entries.find(entry => entry.purpose === "personal")
    ?? entries.find(entry => entry.active && !entry.purpose))?.root;
}

async function stickyVault(root) {
  const allowed = () => registry.list().some(entry => entry.root === root && entry.purpose !== "team");
  if (!allowed() || await realpath(root) !== root)
    throw new Error("Sticky Note를 저장한 개인 보관함을 다시 연결해 주세요.");
  const existing = [...openedVaults.values()].find(entry => entry.vault.root === root);
  const entry = existing ?? openVaultController(await Vault.open(root, recovery));
  await entry.ready;
  if (!allowed() || entry.vault.root !== root)
    throw new Error("Sticky Note 보관함 위치가 변경되었습니다.");
  return entry;
}

async function saveStickyNote(root, relative, content, revision) {
  const release = vaultOperations.begin([root]);
  try {
    const { vault: target, git } = await stickyVault(root);
    const saved = revision ? await git.saveNote(relative,content,revision,()=>target.save(relative,content,revision)) : await target.create(relative, content);
    git.markDirty(target.id);
    if (window && !window.webContents.isDestroyed()) window.webContents.send("notes:sticky-saved", { vaultId: target.id, note: saved });
    return saved;
  } finally {
    release();
  }
}

function showMainWindow() {
  if (!window || window.isDestroyed() || quitRequested) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

async function finishQuit() {
  if (finishingQuit) return;
  finishingQuit = true;
  let quitError = "작업을 저장하지 못해 업데이트를 연기했습니다. 다시 시도해 주세요.";
  try {
    if (stickyNotes && !await stickyNotes.flushForQuit()) return;
    await plugins?.close();
    if (stickyNotes && !await stickyNotes.flushForQuit()) return;
    await temporaryDocuments?.dispose();
    if (updateInstallation) {
      if (vaultOperations.active) throw new Error("저장 작업이 진행 중이어서 업데이트를 연기했습니다.");
      await launchUpdate(await updateInstallation);
    }
    quitReady = true;
    app.quit();
  } catch (error) {
    quitError = error.message;
    dialog.showErrorBox("Dynote", error.message);
  } finally {
    if (!quitReady) {
      finishingQuit = false;
      quitRequested = false;
      await cancelUpdateInstallation(quitError);
    }
  }
}

async function cancelUpdateInstallation(message) {
  if (!updateInstallation) return;
  const pending = updateInstallation;
  updateInstallation = null;
  await pending.catch(() => {});
  await updates.cancelInstall(message).catch(error => dialog.showErrorBox("Dynote", error.message));
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
      const existing = [...openedVaults.values()].find(entry => entry.vault.root === space.root);
      const target = existing?.vault ?? await Vault.open(space.root, recovery, space.purpose);
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
  if (aiExtensionsChanging || copilot?.jobs.size || [copilot, codex, claude].some(controller => controller?.job || controller?.loginJob))
    throw new Error("AI 작업이 끝난 뒤 MCP·스킬 연결을 변경해 주세요.");
  aiExtensionsChanging = true;
  try { return await action(); }
  finally { aiExtensionsChanging = false; }
}

function sendAi(controller, args) {
  if (activating) throw new Error("보관함 전환을 마친 뒤 AI 요청을 보내 주세요.");
  checkVault(args, args?.workspace === true ? workspaceVault(args.vaultId) : vault);
  if (aiExtensionsChanging) throw new Error("MCP·스킬 연결을 변경 중입니다. 잠시 후 다시 보내 주세요.");
  return controller.send(args);
}

function retiringVault(selected, purpose) {
  if (!vault || selected.id === vault.id) return null;
  return registry.purposes[vault.root] && (purpose === "personal" || togetherEntries().length) ? null : vault;
}

async function prepareVaultSelection(request, root, purpose, registered) {
  const canonical = await registry.checkConnection(root, purpose);
  if (registered && !registry.roots.includes(canonical)) throw new Error("등록된 보관함을 선택해 주세요.");
  if (cloudBridge?.checkNoteRemote && !registry.roots.includes(canonical))
    for (const remote of await noteFolderRemotes(canonical)) cloudBridge.checkNoteRemote(remote);
  const existing = [...openedVaults.values()].find(entry => entry.vault.root === canonical);
  const selected = existing?.vault ?? await Vault.open(canonical, recovery, purpose ?? registry.purposes[canonical]);
  if (existing && purpose && !registry.purposes[canonical]) await selected.prepareFileStorage();
  const snapshot = await selected.snapshot();
  await activationTail;
  if (request !== selectionNumber) return null;
  const retiring = retiringVault(selected, purpose)?.id ?? null;
  preparedSelection = { request, selected, purpose, registered, retiring };
  return { request, snapshot, retiring };
}

function activateVaultSelection(request) {
  const result = activationTail.then(async () => {
    const next = preparedSelection;
    if (!next || request !== selectionNumber || request !== next.request) return null;
    preparedSelection = null;
    const { selected, purpose, registered, retiring } = next;
    const warnings = [];
    const release = vaultOperations.begin([registry.file, activeVaultResource], true);
    let releaseOutgoing;
    try {
      const outgoing = retiringVault(selected, purpose);
      if ((outgoing?.id ?? null) !== retiring || (registered && !registry.roots.includes(selected.root)) || await realpath(selected.root) !== selected.root)
        throw new Error("보관함 위치가 변경되었습니다. 다시 선택해 주세요.");
      if (request !== selectionNumber) return null;
      if (outgoing) releaseOutgoing = vaultOperations.begin([outgoing.root], true);
      const purposeChanged = purpose && purpose !== registry.purposes[selected.root];
      await registry.select(selected.root, purpose);
      if (vault?.id === selected.id && !purposeChanged) return warnings;
      activating = true;
      // Persist the selection before disturbing the previous AI sessions and plug-ins.
      await Promise.all([copilot?.cancel(), codex?.cancel(), claude?.cancel(), plugins?.close()]
        .map(action => Promise.resolve(action).catch(error => warnings.push(error.message))));
      vault = openedVaults.get(selected.id)?.vault ?? selected; vaultError = "";
      const entry = openVaultController(vault, purposeChanged);
      gitBackup = entry.git;
      pruneVaultControllers();
      try { await entry.ready; await plugins?.activate(vault); }
      catch (error) { warnings.push(error.message); }
      return warnings;
    } finally { activating = false; releaseOutgoing?.(); release(); }
  });
  activationTail = result.catch(() => {});
  return result;
}

async function selectVault(args, pick) {
  const request = ++selectionNumber;
  preparedSelection = null;
  let root = args?.root;
  if (pick) {
    const result = await dialog.showOpenDialog(window, {
      properties: ["openDirectory", "createDirectory"],
      title: args?.purpose === "personal" ? "개인 노트 폴더 선택" : args?.purpose === "team" ? "팀 공유 노트 폴더 선택" : "Markdown 보관함 선택",
    });
    if (result.canceled || request !== selectionNumber) return null;
    root = result.filePaths[0];
  } else if (!registry.roots.includes(root)) throw new Error("등록된 보관함을 선택해 주세요.");
  const prepared = await prepareVaultSelection(request, root, pick ? args?.purpose : undefined, !pick);
  if (!prepared || args?.prepareOnly === true) return prepared;
  const warnings = await activateVaultSelection(request);
  if (!warnings) return null;
  prepared.snapshot.warnings.push(...warnings);
  return prepared.snapshot;
}

async function initialVault() {
  try {
    await startup.run("vault.read-registry", () => registry.load());
    if (registry.selected) return await startup.run("vault.open-selected", () => Vault.open(registry.selected, recovery, registry.purposes[registry.selected]));
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
    startup.mark("vault.unavailable", "error");
    vaultError = `보관함을 열지 못했습니다. 설정에서 경로를 확인해 주세요. ${registry.selected ?? ""} · ${error.message}`;
    return null;
  }
}

app
  .whenReady()
  .then(async () => {
    startup.mark("electron.ready");
    recovery = path.join(app.getPath("userData"), "recovery");
    registry = new VaultRegistry(path.join(app.getPath("userData"), "settings.json"));
    await startup.run("profile.prepare", () => mkdir(app.getPath("userData"), { recursive: true }));
    aiExtensions = new AiExtensions({ file: path.join(app.getPath("userData"), "ai-extensions.json") });
    await startup.run("ai.read-extensions", () => aiExtensions.load()).catch(() => {}); // The registry reports its preserved load error in the panel.
    vault = await startup.run("vault.initialize", initialVault);
    copilotJournal = new CopilotJournal({file:path.join(app.getPath("userData"),"copilot-journal.json"),sourceRoot:path.join(app.getPath("appData"),"Code","User","workspaceStorage")});
    await startup.run("journal.read-settings", () => copilotJournal.load()).catch(() => {});
    const installed = process.platform === "win32" && app.isPackaged
      && existsSync(path.join(path.dirname(process.execPath), "dynote-installed"));
    updates = new UpdateManager({directory:path.join(app.getPath("userData"),"updates"),downloadDirectory:app.getPath("downloads"),current:app.getVersion(),installed,
      onChange: state => {if(window&&!window.webContents.isDestroyed())window.webContents.send("notes:update-status",state);}});
    await startup.run("updates.read-settings", () => updates.init());
    if (vault) {
      await startup.run("git.initialize", async () => {
        const entry = openVaultController(vault);
        gitBackup = entry.git;
        await entry.ready;
      });
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
    cloudBridge = await openBridge(managedBridgePath(), app.getPath("userData"), request => {
      if (quitRequested) throw new Error("Cloud PC가 종료 중입니다.");
      return copilot.askOnCloud(request);
    }, () => noteRemotes(app.getPath("userData"), registry.roots));
    if (cloudBridge?.settings) {
      if (!app.requestSingleInstanceLock()) { app.exit(0); return; }
      let timer, stopped = false;
      const poll = async () => {
        if (!quitRequested && cloudBridge.service && !cloudBridge.changing) {
          try { await cloudBridge.use("tick"); cloudBridge.error = ""; cloudBridge.lastChecked = Date.now(); }
          catch { cloudBridge.error = "Git 연결 또는 채널 서명을 확인해 주세요. 자동으로 다시 확인합니다."; }
        }
        if (!stopped) timer = setTimeout(poll, 5000);
      };
      void poll();
      app.once("will-quit", () => { stopped = true; clearTimeout(timer); });
    }
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
    startup.mark("window.creating");
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
    startup.mark("window.created");
    window.webContents.once("dom-ready", () => startup.mark("renderer.dom-ready"));
    const rendererStartupStages = new Set([
      "renderer.snapshot-requested",
      "renderer.snapshot-received",
      "renderer.snapshot-error",
      "renderer.workspace-visible",
      "renderer.spaces-applied",
    ]);
    ipcMain.on("notes:startup-stage", (event, stage) => {
      if (!rendererStartupStages.has(stage)) return;
      try { validateSender(event); } catch { return; }
      startup.mark(stage, stage === "renderer.snapshot-error" ? "error" : "mark");
    });
    const notifyWindowFocus = () => {
      if (!window.webContents.isDestroyed())
        window.webContents.send("notes:window-focus");
    };
    window.on("focus", notifyWindowFocus);
    app.on("did-become-active", notifyWindowFocus);
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [{ role: "about" }, { type: "separator" },
            { id: "dynote-settings", label: "설정…", accelerator: "CmdOrCtrl+,", click: () => { showMainWindow(); window.webContents.send("notes:open-settings"); } },
            { type: "separator" }, { role: "quit" }],
        },
        {
          label: "파일",
          submenu: [{ id: "dynote-open-file", label: "파일 열기…", accelerator: "CmdOrCtrl+O",
            click: () => { showMainWindow(); window.webContents.send("notes:open-file"); } }],
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
    window.webContents.on("context-menu", async (_event, params) => {
      const zoom = window.webContents.getZoomFactor();
      const point = params.menuSourceType === "keyboard" ? null : { x: params.x / zoom, y: params.y / zoom };
      const contents = window.webContents;
      const subframe = params.frame !== contents.mainFrame;
      const context = await contents.executeJavaScript(`({
        file: window.dynoteContextFile?.(${subframe}, ${JSON.stringify(point)}),
        ...(${!subframe} && window.dynoteEditorContext?.(${JSON.stringify(point)})),
        styledMenu: typeof window.dynoteShowEditorMenu === "function"
      })`).catch(() => null);
      if (contents.isDestroyed()) return;
      const template = contextMenuTemplate({ ...params, ...context },
        format => window.webContents.send("notes:format-editor", format, point),
        () => window.webContents.send("notes:open-settings", "fonts"),
        () => window.webContents.send("notes:sync-vault"),
        context?.file ? () => revealFile(context.file).catch(error => dialog.showMessageBox(window, {
          type: "error", message: "파일 위치를 열 수 없습니다.", detail: error.message,
        })) : undefined);
      if (context?.markdownEditor && context.styledMenu) {
        // Functions stay in the main process. The renderer returns only an ID from this menu.
        const choice = await contents.executeJavaScript(
          `window.dynoteShowEditorMenu(${JSON.stringify(template)}, ${JSON.stringify(point)})`
        ).catch(() => null);
        if (!choice || contents.isDestroyed()) return;
        const item = template.flatMap(entry => entry.submenu ?? [entry])
          .find(entry => (entry.id ?? entry.role) === choice && entry.enabled !== false);
        if (item?.click) item.click();
        else if (item?.role) contents[item.role]();
        return;
      }
      Menu.buildFromTemplate(template).popup({ window });
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
      onOpen: value => { if (value.created) openedVaults.get(value.vaultId)?.git.markDirty(value.vaultId); if (!window.webContents.isDestroyed()) window.webContents.send("notes:plugin-open-note", value); },
    });
    const documentDrafts = new DocumentDrafts(path.join(app.getPath("userData"), "tmp", "copilot-documents"));
    const pickedTeamFolders = new Set();
    const scopedActions = new Set([
      "open-sticky", "create-folder", "move-across-vaults",
      "capture-status", "capture-sessions", "capture-configure", "capture-source", "capture-sync", "capture-trash", "capture-restore", "snapshot",
      "git-history", "classification-preview", "classification-apply", "composer-preview", "composer-apply", "pdf-preview", "pdf-apply",
      "git-workspace-status", "git-workspace-diff", "git-workspace-action", "git-preview", "git-restore",
      "git-status", "git-connect", "github-login", "git-sync", "git-disconnect", "git-clone", "personal-sync-action", "personal-sync-zips", "show-personal-sync-recovery",
      "create", "open-or-create", "save", "create-document", "save-document", "import-attachment", "transfer-dropped-file", "read-other-file", "read-attachment", "copy-text", "choose-attachments",
      "move-file", "rename-tree-entry", "copy-file", "trash-file", "trash-folder", "restore-trash", "recovery",
      "read-office-document", "open-office-document", "read-word-document", "open-word-document",
    ]);
    for (const [name, action] of Object.entries({
      "open-sticky": (args, target) => {
        checkVault(args, target);
        if (!stickyNotes) throw new Error("스티키 노트를 준비하는 중입니다. 잠시 후 다시 열어 주세요.");
        return stickyNotes.openFromVault(target.root, args.path);
      },
      "document-drafts": () => documentDrafts.list(),
      "write-document-draft": args => documentDrafts.write(args),
      "remove-document-draft": args => documentDrafts.remove(args.id),
      "create-folder": (args, vault) => { checkVault(args, vault); return vault.createFolder(args.path); },
      "move-across-vaults": async (args, target) => {
        checkVault(args, target);
        const source = workspaceVault(args.sourceVaultId);
        await openedVaults.get(source.id)?.ready;
        if (source === target || workspaceVault(source.id) !== source || await realpath(source.root) !== source.root)
          throw new Error("원본 보관함을 다시 확인해 주세요.");
        const result = await source.moveDocumentTo(args.from, args.folder, args.revision, target);
        openedVaults.get(source.id)?.git.markDirty(source.id);
        return result;
      },
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
      "copilot-bridge-settings": () => cloudBridge?.settings?.() ?? {
        role: cloudBridge?.role || "direct", remote: "", remotes: [], error: cloudBridge?.error || "" },
      "copilot-bridge-select": args => {
        if (!cloudBridge?.select) throw new Error("관리자의 Cloud Bridge 설정이 필요합니다.");
        return cloudBridge.select(args?.remote);
      },
      "copilot-status": () => remoteOnly()
        ? { bridge: true, authenticated: false, models: [], error: cloudBridge.setupError || cloudBridge.error || "Copilot 탭에서 Cloud Ask를 사용해 주세요." }
        : startup.run("copilot.status", async () => ({ ...await copilot.status(),
          ...(cloudBridge?.role === "worker" ? { worker: { error: cloudBridge.error, lastChecked: cloudBridge.lastChecked } } : {}) })),
      "copilot-bridge-view": async args => {
        checkVault(args, workspaceVault(args?.vaultId));
        if (cloudBridge?.role !== "client") throw new Error(cloudBridge?.error || "Cloud Ask가 설정되지 않았습니다.");
        return { ...await cloudBridge.use("view", args.vaultId), connectionError: cloudBridge.error };
      },
      "copilot-bridge-submit": args => {
        checkVault(args, workspaceVault(args?.vaultId));
        if (cloudBridge?.role !== "client") throw new Error(cloudBridge?.error || "Cloud Ask가 설정되지 않았습니다.");
        return cloudBridge.use("submit", args.vaultId, args.prompt);
      },
      "copilot-bridge-recheck": args => {
        checkVault(args, workspaceVault(args?.vaultId));
        if (cloudBridge?.role !== "client") throw new Error(cloudBridge?.error || "Cloud Ask가 설정되지 않았습니다.");
        return cloudBridge.use("recheck", args.vaultId, args.requestId);
      },
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
      "update-settings": async args => {
        if (args.internalFeedUrl) {
          const url = validateInternalFeedUrl(args.internalFeedUrl);
          if (url !== updates.state.preferences.internalFeedUrl) {
            const {response} = await dialog.showMessageBox(window, {
              type: "question", message: "이 주소를 Dynote 업데이트 배포처로 저장할까요?",
              detail: `이 위치에서 Windows 설치 파일을 받아 업데이트합니다.\n\n${url}`,
              buttons: ["취소", "주소 저장"], defaultId: 0, cancelId: 0,
            });
            if (response !== 1) throw new Error("배포 주소 저장을 취소했습니다.");
          }
        }
        return updates.configure(args);
      },
      "update-directory": async () => {
        const selected = await dialog.showOpenDialog(window, { title: "업데이트 다운로드 폴더 선택", defaultPath: updates.state.preferences.downloadDirectory, properties: ["openDirectory", "createDirectory"] });
        return selected.canceled ? updates.state : updates.configure({ downloadDirectory: selected.filePaths[0] });
      },
      "update-download": () => updates.download(),
      "update-show": async () => {shell.showItemInFolder(await updates.readyPath());return true;},
      "update-install": async () => {
        if (updateInstallation || quitRequested || closePending || vaultOperations.active) throw new Error("다른 작업이 끝난 후 업데이트를 설치해 주세요.");
        const pending = updates.beginInstall(args => stageUpdate({ ...args, directory: updates.directory, executable: process.execPath }));
        updateInstallation = pending;
        try {
          await pending;
          if (updateInstallation !== pending) return false;
          setImmediate(() => { if (updateInstallation === pending) app.quit(); });
          return true;
        } catch (error) { if (updateInstallation === pending) updateInstallation = null; throw error; }
      },
      "open-web-viewer": (args) => openWebViewer(args?.url, window),
      "copilot-login": () => directCopilot().login(),
      "copilot-cancel-login": () => directCopilot().cancelLogin(),
      "copilot-send": args => sendAi(directCopilot(), args),
      "copilot-cancel": (args) => directCopilot().cancel(args?.requestId),
      "capture-status": (args, vault) => { checkVault(args, vault); return copilotJournal.status(vault); },
      "capture-sessions": (args, vault) => {
        checkVault(args, vault);
        if(registry.purposes[vault.root]!=="personal")throw new Error("개인 노트 공간에서 가져와 주세요.");
        return copilotJournal.listSessions(vault,args.projects);
      },
      "capture-configure": (args, vault) => { checkVault(args, vault); return copilotJournal.configure(vault,args.input,registry.purposes[vault.root]==="personal"); },
      "capture-source": async (args, vault) => {
        checkVault(args, vault);
        if(registry.purposes[vault.root]!=="personal")throw new Error("개인 노트 공간에서 설정해 주세요.");
        const wsl=args.wsl===true;
        const selected=await dialog.showOpenDialog(window,{title:wsl?"WSL Copilot session-state 폴더 선택":"VS Code workspaceStorage 폴더 선택",properties:["openDirectory"]});
        if(selected.canceled)return null;
        checkVault(args, vault);
        return wsl?copilotJournal.setWslSource(vault,selected.filePaths[0]):copilotJournal.setSource(vault,selected.filePaths[0]);
      },
      "capture-sync": (args, vault, gitBackup) => {
        checkVault(args, vault);if(registry.purposes[vault.root]!=="personal")throw new Error("개인 노트 공간에서 가져와 주세요.");
        const run=async()=>{checkVault(args,vault);
          const protectedPaths=gitBackup.status().enabled && gitBackup.status().config?.mode==="personal-sync" ? await gitBackup.personal.blockedSessions() : undefined;
          return copilotJournal.sync(vault,args.dailyOptions,args.checkOnly!==true && args.manual===true,{checkOnly:args.checkOnly===true,sessionIds:args.sessionIds,allSessions:args.allSessions,projectIds:args.projectIds,protectedPaths});
        };
        return args.checkOnly===true ? run() : gitBackup.enqueue(run);
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
      "workspace-snapshots": () => startup.run("vault.read-workspaces", workspaceSnapshots),
      "vaults": () => ({ entries: registry.list(), current: vault?.root ?? null, currentId: vault?.id ?? null, error: vaultError }),
      "set-vault-purpose": async (args) => {
        await registry.setPurpose(args?.root, args?.purpose);
        const entry = [...openedVaults.values()].find(entry => entry.vault.root === args.root);
        if (entry && args.purpose!=="personal" && ["personal-sync","github-api"].includes(entry.git.status().config?.mode)) await entry.git.disconnect(entry.vault.id);
        if (entry) await entry.vault.prepareFileStorage();
        else await Vault.open(args.root, recovery, args.purpose);
        pruneVaultControllers();
        return true;
      },
      "select-vault": args => selectVault(args, false),
      "activate-vault": args => activateVaultSelection(args?.request),
      "forget-vault": async (args) => { await registry.forget(args?.root); pruneVaultControllers(); return { entries: registry.list(), current: vault?.root ?? null, error: vaultError }; },
      "git-history": (args, vault) => {
        checkVault(args, vault);
        const history = new GitHistory(vault);
        return args.filePath === undefined ? history.list(args.month) : history.fileVersions(args.filePath, args.skip, args.anchor);
      },
      "classification-preview": (args, vault, gitBackup) => { checkVault(args, vault); return gitBackup.enqueue(async()=>{const {JournalClassifier}=await import("../core/journal-classification.mjs");checkVault(args, vault);return new JournalClassifier(vault).preview(args.input);}); },
      "classification-apply": (args, vault, gitBackup) => { checkVault(args, vault); return gitBackup.enqueue(async()=>{const {JournalClassifier}=await import("../core/journal-classification.mjs");checkVault(args, vault);return new JournalClassifier(vault).apply(args.input,args.revision);}); },
      "composer-preview": (args, vault, gitBackup) => { checkVault(args, vault); return gitBackup.enqueue(async () => { const { NoteComposer } = await import("../core/note-composer.mjs"); checkVault(args, vault); return new NoteComposer(vault).preview(args.input); }); },
      "composer-apply": (args, vault, gitBackup) => { checkVault(args, vault); return gitBackup.enqueue(async () => { const { NoteComposer } = await import("../core/note-composer.mjs"); checkVault(args, vault); return new NoteComposer(vault).apply(args.input, args.revision); }); },
      "pdf-preview": (args, vault, gitBackup) => { checkVault(args, vault); return gitBackup.enqueue(async () => { const { PdfEditor } = await import("../core/pdf-editing.mjs"); checkVault(args, vault); return new PdfEditor(vault).preview(args.input); }); },
      "pdf-apply": (args, vault, gitBackup) => { checkVault(args, vault); return gitBackup.enqueue(async () => { const { PdfEditor } = await import("../core/pdf-editing.mjs"); checkVault(args, vault); return new PdfEditor(vault).apply(args.input, args.revision); }); },
      "git-workspace-status": (args, vault, gitBackup) => {
        checkVault(args, vault);
        return gitBackup.enqueue(() => {
          checkVault(args, vault);
          const workspace = new GitWorkspace(vault.root);
          return args.summaryOnly === true ? workspace.repositoryInfo() : workspace.status();
        });
      },
      "git-workspace-diff": (args, vault, gitBackup) => { checkVault(args, vault); return gitBackup.enqueue(() => { checkVault(args, vault); return new GitWorkspace(vault.root).diff(args.path, args.staged === true); }); },
      "git-workspace-action": (args, vault, gitBackup) => {
        checkVault(args, vault);
        return gitBackup.enqueue(async () => {
          checkVault(args, vault);
          const workspace = new GitWorkspace(vault.root);
          if (args.action?.kind === "sync-team") {
            if (registry.purposes[vault.root] !== "team") throw new Error("동기화할 팀 보관함을 다시 선택해 주세요.");
            const backup = gitBackup.status();
            try {
              const status = await workspace.syncTeam(backup.enabled ? backup.config : null, remote => cloudBridge?.checkNoteRemote?.(remote), operation => vault.applySyncChanges(operation));
              return {status};
            }
            catch (error) { return { status:{phase:"error", message:error.message} }; }
          }
          if (["create-branch", "switch-branch", "delete-branch"].includes(args.action?.kind) && gitBackup.status().enabled)
            throw new Error("브랜치를 변경하기 전에 자동 Git 백업을 꺼 주세요.");
          const status = await workspace.action(args.action, operation => vault.applySyncChanges(operation));
          const snapshot = ["pull", "switch-branch", "create-branch"].includes(args.action.kind) ? await vault.snapshot() : null;
          return { status, snapshot };
        });
      },
      "git-preview": (args, vault) => {
        checkVault(args, vault);
        const history = new GitHistory(vault);
        return args.filePath === undefined ? history.preview(args.commit) : history.filePreview(args.filePath, args.commit);
      },
      "git-restore": (args, vault, gitBackup) => {
        checkVault(args, vault);
        return gitBackup.enqueue(async () => {
          checkVault(args, vault);
          const history = new GitHistory(vault);
          const cfg=gitBackup.status().config;
          const personal=gitBackup.status().enabled && cfg?.mode==="personal-sync" && args.filePath!==undefined;
          if(personal) {
            checkVault(args,vault);
            const preview=await history.filePreview(args.filePath,args.commit);
            if(preview.revision!==args.revision)throw new Error("미리보기 이후 파일이 변경되었습니다.");
            await gitBackup.personal.checkpointFile(cfg,args.filePath,"복원 전 파일 보존");
          }
          const result = args.filePath === undefined ? await history.restore(args.commit, args.revision)
            : await history.restoreFile(args.filePath, args.commit, args.revision);
          if(personal) await gitBackup.personal.checkpointFile(cfg,args.filePath,"파일 버전 복원");
          gitBackup.markDirty(vault.id);
          if(personal) gitBackup.sync(vault.id).catch(()=>{});
          return result;
        });
      },
      "pick-vault": args => selectVault(args, true),
      "pick-team-repository-folder": async () => {
        const result = await dialog.showOpenDialog(window, {
          title: "팀 저장소 폴더 선택", properties: ["openDirectory", "createDirectory"],
        });
        if (result.canceled) return null;
        const folder = await registry.checkTeamRepositoryFolder(result.filePaths[0]);
        pickedTeamFolders.add(folder);
        return folder;
      },
      "connect-team-repositories": async (args) => {
        if (!Array.isArray(args?.repositories) || !args.repositories.length) throw new Error("연결할 팀 저장소를 입력해 주세요.");
        const results = [];
        for (const repository of args.repositories) {
          try {
            const folder = repository?.folder;
            if (!pickedTeamFolders.has(folder)) throw new Error("저장소 폴더를 선택해 주세요.");
            if (await registry.checkTeamRepositoryFolder(folder) !== folder)
              throw new Error("폴더 위치가 변경되었습니다. 폴더를 다시 선택해 주세요.");
            const config = validateGitConfig(repository);
            cloudBridge?.checkNoteRemote?.(config.remote);
            if (cloudBridge?.checkNoteRemote)
              for (const remote of await noteFolderRemotes(folder)) cloudBridge.checkNoteRemote(remote);
            const git = new GitBackup(folder);
            if (!await git.repository()) {
              if (!await git.remoteHead(config)) throw new Error("원격 저장소에서 해당 브랜치를 찾을 수 없습니다.");
              await GitBackup.clone(folder, config);
            }
            const origin = await git.git(["config", "--local", "--get-all", "remote.origin.url"], { allow: [0, 1] });
            const branch = await git.git(["symbolic-ref", "--quiet", "HEAD"], { allow: [0, 1] });
            if (origin.stdout.trim() !== config.remote || branch.stdout.trim() !== "refs/heads/" + config.branch)
              throw new Error("선택한 폴더의 origin 주소와 현재 브랜치를 확인해 주세요.");
            await registry.registerTeamRepository(folder);
            pickedTeamFolders.delete(folder);
            results.push({ ok: true });
          } catch (error) {
            results.push({ ok: false, error: error.message });
          }
        }
        return results;
      },
      "git-status": (args, vault, gitBackup) => { checkVault(args, vault); return gitBackup.status(); },
      "github-login": (args, vault, gitBackup) => { checkVault(args, vault); return gitBackup.githubAuth(vault.id,args); },
      "git-connect": (args, vault, gitBackup) => {
        checkVault(args, vault);
        return gitBackup.connect(vault.id, args.config);
      },
      "git-sync": (args, vault, gitBackup) => {
        checkVault(args, vault);
        return gitBackup.sync(vault.id, { automatic: args.automatic === true || args.poll === true, force: args.poll !== true, personalOnly: args.personalOnly === true });
      },
      "show-personal-sync-recovery": (args, vault, gitBackup) => {
        checkVault(args, vault);
        return gitBackup.enqueue(async () => {
          const status = gitBackup.status();
          if (!status.recoveryFile || status.recoveryFile !== args.id)
            throw new Error("현재 동기화의 복구 사본을 다시 확인해 주세요.");
          const service = await gitBackup.startPersonal();
          if (!service.disk) {
            try { await service.init(); }
            catch (error) { if (!service.disk) throw error; }
          }
          shell.showItemInFolder(await service.disk.recoveryPath(args.id));
          return true;
        });
      },
      "personal-sync-zips": (args,vault,controller) => { checkVault(args,vault); return controller.enqueue(()=>controller.zipList()); },
      "personal-sync-action": (args,vault,controller) => { checkVault(args,vault); return controller.personalAction(vault.id,args); },
      "git-disconnect": (args, vault, gitBackup) => { checkVault(args, vault); return gitBackup.disconnect(vault.id); },
      "git-clone": async (args, source) => {
        const personal = args?.config?.mode === "personal-sync";
        const newPersonal = personal && args.personalImport === true;
        if (!newPersonal) checkVault(args, source);
        if (personal && !newPersonal && registry.purposes[source.root] !== "personal") throw new Error("개인 보관함을 선택해 주세요.");
        const config = personal ? { ...personalConfig(args.config), zipPaths: [] } : validateGitConfig(args.config);
        cloudBridge?.checkNoteRemote?.(config.remote);
        const result = await dialog.showOpenDialog(window, { title: "저장소를 가져올 빈 폴더 선택", properties: ["openDirectory", "createDirectory"] });
        if (result.canceled) return null;
        if (!newPersonal) checkVault(args, source);
        const purpose = personal ? "personal" : registry.purposes[source.root];
        const folder = await registry.checkConnection(result.filePaths[0], purpose);
        const overlaps = registry.roots.filter(root => root === folder || root.startsWith(folder + path.sep) || folder.startsWith(root + path.sep));
        const release = vaultOperations.begin([folder, ...overlaps], true);
        try {
          if (personal) {
            if ((await readdir(folder)).length) throw new Error("기존 파일이 없는 빈 폴더를 선택해 주세요.");
            const target = new GitBackup(folder);
            await target.repository();
            if (!await target.initialPersonalRemote(config)) throw new Error("원격 저장소에 가져올 브랜치가 없습니다.");
          } else await GitBackup.clone(folder, config);
          const imported = [...openedVaults.values()].find(entry => entry.vault.root === folder)?.vault ?? await Vault.open(folder, recovery, purpose);
          if (imported.root !== folder) throw new Error("폴더 위치가 변경되었습니다.");
          await registry.register(folder, purpose);
          const entry = openVaultController(imported);
          await entry.ready;
          try {
            const status = await entry.git.connect(imported.id, config);
            return { root: folder, importError: status.phase === "error" ? status.message : null };
          } catch (error) {
            entry.git.publish({ phase: "error", message: error.message });
            return { root: folder, importError: error.message };
          } finally {
            if (openedVaults.get(imported.id) !== entry) entry.git.close();
            pruneVaultControllers();
          }
        } finally { release(); }
      },
      create: (args, vault) => {
        checkVault(args, vault);
        return vault.create(args.path, args.content);
      },
      "open-or-create": (args, vault) => {
        checkVault(args, vault);
        return vault.openOrCreate(args.path, args.content);
      },
      save: (args, vault, controller) => {
        checkVault(args, vault);
        return controller.saveNote(args.path,args.content,args.revision,()=>vault.save(args.path, args.content, args.revision));
      },
      "create-document": (args, vault) => {
        checkVault(args, vault);
        return vault.createDocument(args.path);
      },
      "save-document": (args, vault) => {
        checkVault(args, vault);
        return vault.saveDocument(args.path, args.content, args.revision);
      },
      "transfer-dropped-file": async (args, vault) => {
        checkVault(args, vault);
        const result = args.externalId
          ? await externalDocuments().copyToVault(args.externalId, vault, args.folder, args.revision)
          : await vault.transferDroppedFile(args.source, args.folder, args.operation);
        const sync=openedVaults.get(vault.id)?.git.personal;
        if(sync?.disk && result.path && /\.(?:zip|pdf|pptx|xlsx)$/i.test(result.path)) {
          const copy=await sync.disk.read(result.path).catch(()=>null);
          if(copy) sync.confirmed.set(result.path,copy.oid);
        }
        if (args.operation === "move" && !result.warning && !result.unchanged) {
          for (const { vault: source, git } of openedVaults.values()) {
            if (source.id !== vault.id && args.source.startsWith(source.root + path.sep)) {
              git.markDirty(source.id);
              result.sourceVaultId = source.id;
              break;
            }
          }
        }
        return result;
      },
      "reveal-file": revealFile,
      "read-other-file": (args, vault) => {
        checkVault(args, vault);
        return vault.readOtherFile(args.path);
      },
      "import-attachment": (args, vault) => {
        checkVault(args, vault);
        return vault.importAttachment(args.name, args.bytes);
      },
      "read-attachment": (args, vault) => {
        checkVault(args, vault);
        return vault.readAttachment(args.path);
      },
      "read-office-document": (args, vault) => {
        checkVault(args, vault);
        return vault.readOfficeDocument(args.path, args.revision);
      },
      "open-office-document": async (args, vault) => {
        checkVault(args, vault);
        const file = await vault.officeFilePath(args.path);
        if (await shell.openPath(file)) throw new Error("원본 파일을 열 수 없습니다. 기본 앱 설정을 확인해 주세요.");
        return true;
      },
      "read-word-document": (args, vault) => {
        checkVault(args, vault);
        return vault.readWordDocument(args.path, args.revision, args.preview !== false);
      },
      "choose-external-file": async () => {
        const result = await dialog.showOpenDialog(window, {
          title: "파일 열기", properties: ["openFile"],
          filters: [
            { name: "문서·이미지·오디오", extensions: ["md", "markdown", "html", "htm", "docx", "xlsx", "pptx", "pdf", "canvas", "base", "txt", "log", "json", "csv", "yaml", "yml", "png", "jpg", "jpeg", "gif", "webp", "webm", "wav", "mp3", "ogg", "m4a"] },
            { name: "모든 파일 · UTF-8 텍스트", extensions: ["*"] },
          ],
        });
        return result.canceled ? null : externalDocuments().open(result.filePaths[0]);
      },
      "open-external-file": args => externalDocuments().open(args.path),
      "close-external-file": args => externalDocuments().close(args.id),
      "read-external-file": args => externalDocuments().read(args.id, args.revision),
      "open-external-file-source": async args => {
        const file = await externalDocuments().sourcePath(args.id);
        if (await shell.openPath(file))
          throw new Error("원본 파일을 열 수 없습니다. 이 확장자의 기본 앱을 확인해 주세요.");
        return true;
      },
      "open-word-document": async (args, vault) => {
        checkVault(args, vault);
        const file = await vault.wordFilePath(args.path);
        if (await shell.openPath(file))
          throw new Error("Word 문서를 열 수 없습니다. .docx 파일의 기본 앱을 확인해 주세요.");
        return true;
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
              name: "이미지·PDF·오디오·Office",
              extensions: ["html", "htm", "xlsx", "pptx", "png", "jpg", "jpeg", "gif", "webp", "pdf", "webm", "wav", "mp3", "ogg", "m4a"],
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
        return stickyNotes && validNotePath(args.from)
          ? stickyNotes.moveFile(vault, args.from, args.to, args.revision)
          : vault.moveFile(args.from, args.to, args.revision);
      },
      "rename-tree-entry": (args, vault, gitBackup) => gitBackup.enqueueLocal(async () => {
        checkVault(args, vault);
        if (typeof args.from !== "string" || typeof args.name !== "string" || typeof args.folder !== "boolean")
          throw new Error("이름을 바꿀 파일 또는 폴더를 선택해 주세요.");
        const { from, folder, revision } = args;
        const to = treeRenameDestination(from, args.name, folder);
        if (from === to) throw new Error("현재 이름과 다른 이름을 입력해 주세요.");
        if (registry.purposes[vault.root] === "personal" &&
            [from, to].some(name => managedCopilotPath(name, Object.values(copilotJournal.config(vault).records))))
          throw new Error("Copilot 기록이 참조하는 경로입니다. 연결을 유지하려면 이 경로의 이름을 바꿀 수 없습니다.");
        if (folder && (!canTrashFolder(from, args.protectedFolders) || !canTrashFolder(to, args.protectedFolders) ||
            from === "포스트잇" || stickyNotes?.hasNotesWithin(vault, from)))
          throw new Error("저널, 첨부파일 또는 Sticky Note가 사용하는 폴더는 이름을 바꿀 수 없습니다.");
        if (folder || /\.docx$/i.test(from)) return vault.renameTreeEntry(from, to, { folder, revision });
        return stickyNotes && validNotePath(from) ? stickyNotes.moveFile(vault, from, to, revision) : vault.moveFile(from, to, revision);
      }),
      "copy-file": async (args, target) => {
        checkVault(args, target);
        const source = args.workspace === true ? workspaceVault(args.sourceVaultId) : target;
        checkVault({ vaultId: args.sourceVaultId }, source);
        if (source !== target) {
          await openedVaults.get(source.id)?.ready;
          if (workspaceVault(source.id) !== source || await realpath(source.root) !== source.root)
            throw new Error("원본 보관함 위치가 변경되었습니다.");
        }
        return target.copyDocument(args.from, args.folder, args.revision, source);
      },
      "trash-file": (args, vault) => {
        checkVault(args, vault);
        return vault.trashFile(args.path, args.revision);
      },
      "trash-folder": (args, vault, gitBackup) => {
        checkVault(args, vault);
        return gitBackup.enqueueLocal(() => {
          checkVault(args, vault);
          return vault.trashFolder(args.path, args.protectedFolders, folder => shell.trashItem(folder));
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
        const checkingCapture = name === "capture-sync" && args?.checkOnly === true;
        const selecting = ["pick-vault", "select-vault", "activate-vault"].includes(name);
        const globalOperation = ["forget-vault", "set-vault-purpose"].includes(name);
        const registering = name === "git-clone" || name === "connect-team-repositories";
        const transfer = name === "move-across-vaults" || name === "copy-file";
        const changesCheckout = name === "git-workspace-action" && ["switch-branch", "create-branch"].includes(args?.action?.kind);
        const exclusive = registering || globalOperation || transfer || changesCheckout || (!checkingCapture && ["git-restore", "composer-apply", "classification-apply", "pdf-apply", "capture-configure", "capture-source", "capture-sync", "capture-trash", "capture-restore"].includes(name));
        const readOnly = checkingCapture || /^(copilot|codex|claude|update|ai)-/.test(name) || ["document-drafts", "capture-status", "capture-sessions", "snapshot", "workspace-snapshots", "vaults", "git-status", "git-history", "git-preview", "git-workspace-status", "git-workspace-diff", "composer-preview", "classification-preview", "pdf-preview", "check-updates", "open-web-viewer", "reveal-file", "read-other-file", "read-attachment", "read-office-document", "open-office-document", "read-word-document", "open-word-document", "choose-external-file", "open-external-file", "read-external-file", "close-external-file", "open-external-file-source", "copy-text", "recovery", "external"].includes(name);
        let release;
        try {
          validateSender(event);
          const scoped = args?.workspace === true && scopedActions.has(name);
          const target = scoped ? workspaceVault(args.vaultId) : vault;
          if (scoped) checkVault(args, target);
          if (!readOnly) {
            const roots = [];
            if (selecting) roots.push(selectionPreparation);
            else if (registering) roots.push(registry.file);
            else if (target && !globalOperation) {
              const metadataOnly = name === "git-workspace-action" && ["fetch", "commit", "unstage", "delete-branch"].includes(args?.action?.kind);
              if (!scoped) roots.push(activeVaultResource);
              if (!metadataOnly) roots.push(target.root);
              if (metadataOnly || (exclusive && !transfer)) roots.push(path.join(target.root, ".git"));
            }
            if (target && transfer && args?.sourceVaultId) {
              const source = workspaceVault(args.sourceVaultId);
              if (source) roots.push(source.root);
            }
            if (name === "transfer-dropped-file" && args?.operation === "move" && typeof args.source === "string") {
              for (const {vault: source} of openedVaults.values()) {
                if (args.source.startsWith(source.root + path.sep)) roots.push(source.root);
              }
            }
            release = vaultOperations.begin(roots, exclusive, selecting || exclusive || name === "git-workspace-action" || name === "trash-folder" || name === "rename-tree-entry");
          }
          const entry = openedVaults.get(target?.id);
          if (entry && scoped) {
            await entry.ready;
            if (workspaceVault(args.vaultId) !== target || await realpath(target.root) !== target.root)
              throw new Error("보관함 위치가 변경되었습니다. 문서를 다시 열어 주세요.");
          }
          const value = await (name === "snapshot" && !scoped
            ? startup.run("vault.initial-snapshot", () => action(args, target, entry?.git))
            : action(args, target, entry?.git));
          if (name.startsWith("capture-") && value) {
            (value.status ?? value).personal = registry.purposes[target.root] === "personal";
            if (value.changed) entry.git.markDirty(target.id);
          }
          if (["create", "create-folder", "move-across-vaults", "save", "create-document", "save-document", "import-attachment", "transfer-dropped-file", "choose-attachments", "move-file", "rename-tree-entry", "copy-file", "trash-file", "trash-folder", "restore-trash", "composer-apply", "classification-apply", "pdf-apply"].includes(name)) entry?.git.markDirty(target.id);
          return { ok: true, value };
        } catch (error) {
          return { ok: false, error: error.message };
        } finally {
          release?.();
        }
      });
    ipcMain.on("notes:close-ready", (event, id, ready) => {
      try { validateSender(event); } catch { return; }
      if (!closePending || closePending.id !== id) return;
      const { mode, timer } = closePending;
      clearTimeout(timer);
      closePending = null;
      if (ready === false || vaultOperations.blocksClose) {
        const showMain = quitRequested;
        quitRequested = false;
        if (showMain) showMainWindow();
        void cancelUpdateInstallation("작업을 저장하지 못해 업데이트를 연기했습니다. 작업을 마친 뒤 지금 설치를 눌러 주세요.");
      } else if (mode === "quit") {
        quitRequested = true;
        void finishQuit();
      } else if (quitRequested) {
        window.close();
      } else {
        window.hide();
      }
    });
    window.on("close", event => {
      if (quitReady || window.webContents.isDestroyed()) return;
      event.preventDefault();
      if (finishingQuit) return;
      if (vaultOperations.blocksClose) { quitRequested = false; void cancelUpdateInstallation("진행 중인 작업이 있어 업데이트를 연기했습니다."); return; }
      if (window.webContents.isCrashed()) {
        if (updateInstallation) { quitRequested = false; void cancelUpdateInstallation("문서 상태를 확인할 수 없어 업데이트를 중지했습니다. 앱을 다시 연 뒤 시도해 주세요."); return; }
        quitRequested = true;
        void finishQuit();
        return;
      }
      if (closePending) return;
      const id = ++closeRequestId;
      const mode = quitRequested || !stickyNotes ? "quit" : "hide";
      const timer = setTimeout(() => {
        closePending = null;
        quitRequested = false;
        void cancelUpdateInstallation("저장 확인 시간이 초과되어 업데이트를 연기했습니다.");
      }, 15000).unref();
      closePending = { id, mode, timer };
      window.webContents.send("notes:before-close", { id, mode, updating: !!updateInstallation });
    });
    await startup.run("window.load", () => window.loadURL("notes://app/index.html"));
    await startup.run("plugins.activate", () => plugins.activate(vault));
    const stickyController = new StickyNotes({
      directory: path.join(app.getPath("userData"), "sticky-notes"),
      selectRoot: stickyRoot,
      readNote: async (root, relative) => (await stickyVault(root)).vault.readNote(relative),
      saveNote: saveStickyNote,
      openLink: async (root, sourcePath, target, kind) => {
        const { vault: source } = await stickyVault(root);
        if (!window || window.isDestroyed() || quitRequested) return;
        if (!workspaceVault(source.id)) throw new Error("메인 창에서 Sticky Note 보관함을 먼저 열어 주세요.");
        showMainWindow();
        window.webContents.send("notes:sticky-link", { vaultId: source.id, sourcePath, target, kind });
      },
      showMain: showMainWindow,
      canOpen: () => !quitRequested,
      quitReady: () => quitReady,
    });
    try {
      await startup.run("sticky-notes.start", () => stickyController.start());
      stickyNotes = stickyController;
    } catch (error) {
      stickyController.dispose();
      console.error("Sticky Note 초기화:", error.message);
    }
    const checkUpdates = () => updates.check().catch(error=>console.error("Update check:",error.message));
    const updateTimer = setInterval(checkUpdates,60*60*1000);updateTimer.unref();
    const initialUpdate = setTimeout(checkUpdates,10000);initialUpdate.unref();
    powerMonitor.on("resume",checkUpdates);
    app.once("will-quit",()=>{clearInterval(updateTimer);clearTimeout(initialUpdate);powerMonitor.removeListener("resume",checkUpdates);});
    startup.mark("main.services-ready");
  })
  .catch((error) => {
    startup.mark("main.startup-error", "error");
    console.error(error);
    app.exit(1);
  });

app.on("activate", (_event, hasVisibleWindows) => {
  if (!hasVisibleWindows) showMainWindow();
});

app.on("window-all-closed", () => app.quit());

app.on("before-quit", event => {
  if (quitReady) return;
  event.preventDefault();
  if (quitRequested) return;
  quitRequested = true;
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.close();
  else void finishQuit();
});

app.once("will-quit", async event => {
  event.preventDefault();
  stickyNotes?.dispose();
  for (const entry of openedVaults.values()) entry.git.close();
  await Promise.race([Promise.allSettled([copilot?.close(), codex?.close(), claude?.close()]), new Promise(resolve => setTimeout(resolve, 3000))]);
  // Finish the canceled will-quit event before requesting another native quit.
  setImmediate(() => app.quit());
});
