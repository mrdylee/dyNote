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
} from "electron";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Vault } from "../core/vault.mjs";
import { assetPath, safeExternalUrl, trustedFrame, allowFontPermission, allowAudioPermission } from "../core/security.mjs";
import { openWebViewer } from "./web-viewer.mjs";
import { demoNotes } from "../core/demo.mjs";
import { VaultRegistry } from "./vault-registry.mjs";
import { GitHistory } from "../core/git-history.mjs";
import { GitWorkspace } from "../core/git-workspace.mjs";
import { checkReleaseInformation } from "../core/update-information.mjs";
import { GitController } from "./git-controller.mjs";
import { GitBackup, validateGitConfig } from "../core/git-backup.mjs";
import { PluginController } from "./plugin-controller.mjs";
import { CopilotController } from "./copilot-controller.mjs";

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
let activeMutations = 0;
let gitBackup;
let copilot;
let plugins;

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

function checkVault(args) {
  if (!vault || !args || args.vaultId !== vault.id)
    throw new Error("보관함이 변경되었습니다. 문서를 다시 열어 주세요.");
}

async function selectVault(root) {
  await copilot?.cancel();
  const selected = await Vault.open(root, recovery);
  const snapshot = await selected.snapshot();
  await plugins?.close();
  await registry.select(selected.root);
  vault = selected; vaultError = "";
  await gitBackup.open(vault);
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
    vault = await initialVault();
    gitBackup = new GitController({
      settingsFile: path.join(app.getPath("userData"), "git-backup.json"),
      onStatus: (status) => { if (window && !window.webContents.isDestroyed()) window.webContents.send("notes:git-status", status); },
    });
    if (vault) await gitBackup.open(vault);
    copilot = new CopilotController({
      directory: path.join(app.getPath("userData"), "copilot"),
      getNotes: async (vaultId) => {
        checkVault({ vaultId });
        return (await vault.snapshot()).notes;
      },
      openExternal: (url) => shell.openExternal(url),
      onEvent: (event) => {
        if (window && !window.webContents.isDestroyed()) window.webContents.send("notes:copilot-event", event);
      },
    });
    protocol.handle("notes", async (request) => {
      try {
        const url = new URL(request.url);
        if (url.host === "vault") {
          const parts = decodeURIComponent(url.pathname).slice(1).split("/");
          if (!vault || parts.shift() !== vault.id)
            return new Response("Forbidden", { status: 403 });
          const asset = await vault.readAttachment(parts.join("/"));
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
        : {}),
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
      "copilot-status": () => copilot.status(),
      "check-updates": (args) => checkReleaseInformation(app.getVersion(), args?.includePrerelease === true),
      "open-web-viewer": (args) => openWebViewer(args?.url, window),
      "copilot-login": () => copilot.login(),
      "copilot-cancel-login": () => copilot.cancelLogin(),
      "copilot-send": (args) => { checkVault(args); return copilot.send(args); },
      "copilot-cancel": (args) => copilot.cancel(args?.requestId),
      snapshot: () => vault ? vault.snapshot() : { id: null, name: "보관함 선택 필요", notes: [], documents: [], attachments: [], warnings: [vaultError] },
      "vaults": () => ({ entries: registry.list(), current: vault?.root ?? null, error: vaultError }),
      "select-vault": (args) => {
        if (!registry.roots.includes(args?.root)) throw new Error("등록된 보관함을 선택해 주세요.");
        return selectVault(args.root);
      },
      "forget-vault": async (args) => { await registry.forget(args?.root); return { entries: registry.list(), current: vault?.root ?? null, error: vaultError }; },
      "git-history": (args) => { checkVault(args); return new GitHistory(vault).list(args.month); },
      "composer-preview": (args) => { checkVault(args); return gitBackup.enqueue(async () => { const { NoteComposer } = await import("../core/note-composer.mjs"); checkVault(args); return new NoteComposer(vault).preview(args.input); }); },
      "composer-apply": (args) => { checkVault(args); return gitBackup.enqueue(async () => { const { NoteComposer } = await import("../core/note-composer.mjs"); checkVault(args); return new NoteComposer(vault).apply(args.input, args.revision); }); },
      "pdf-preview": (args) => { checkVault(args); return gitBackup.enqueue(async () => { const { PdfEditor } = await import("../core/pdf-editing.mjs"); checkVault(args); return new PdfEditor(vault).preview(args.input); }); },
      "pdf-apply": (args) => { checkVault(args); return gitBackup.enqueue(async () => { const { PdfEditor } = await import("../core/pdf-editing.mjs"); checkVault(args); return new PdfEditor(vault).apply(args.input, args.revision); }); },
      "git-workspace-status": (args) => { checkVault(args); return gitBackup.enqueue(() => { checkVault(args); return new GitWorkspace(vault.root).status(); }); },
      "git-workspace-diff": (args) => { checkVault(args); return gitBackup.enqueue(() => { checkVault(args); return new GitWorkspace(vault.root).diff(args.path, args.staged === true); }); },
      "git-workspace-action": (args) => {
        checkVault(args);
        return gitBackup.enqueue(async () => {
          checkVault(args);
          if (["create-branch", "switch-branch", "delete-branch"].includes(args.action?.kind) && gitBackup.status().enabled)
            throw new Error("브랜치를 변경하기 전에 자동 Git 백업을 꺼 주세요.");
          const status = await new GitWorkspace(vault.root).action(args.action);
          const snapshot = ["pull", "switch-branch", "create-branch"].includes(args.action.kind) ? await vault.snapshot() : null;
          return { status, snapshot };
        });
      },
      "git-preview": (args) => { checkVault(args); return new GitHistory(vault).preview(args.commit); },
      "git-restore": (args) => {
        checkVault(args);
        return gitBackup.enqueue(async () => {
          checkVault(args);
          const result = await new GitHistory(vault).restore(args.commit, args.revision);
          gitBackup.markDirty(vault.id);
          return result;
        });
      },
      "pick-vault": async () => {
        const result = await dialog.showOpenDialog(window, {
          properties: ["openDirectory", "createDirectory"],
          title: "Markdown 보관함 선택",
        });
        if (result.canceled) return null;
        return selectVault(result.filePaths[0]);
      },
      "git-status": (args) => { checkVault(args); return gitBackup.status(); },
      "git-connect": (args) => { checkVault(args); return gitBackup.connect(vault.id, args.config); },
      "git-sync": (args) => { checkVault(args); return gitBackup.sync(vault.id); },
      "git-disconnect": (args) => { checkVault(args); return gitBackup.disconnect(vault.id); },
      "git-clone": async (args) => {
        checkVault(args);
        const config = validateGitConfig(args.config);
        const result = await dialog.showOpenDialog(window, { title: "저장소를 가져올 빈 폴더 선택", properties: ["openDirectory", "createDirectory"] });
        if (result.canceled) return null;
        checkVault(args);
        await GitBackup.clone(result.filePaths[0], config);
        const snapshot = await selectVault(result.filePaths[0]);
        try { await gitBackup.connect(vault.id, config); }
        catch (error) { gitBackup.publish({ phase: "error", message: error.message }); }
        return snapshot;
      },
      create: (args) => {
        checkVault(args);
        return vault.create(args.path, args.content);
      },
      "open-or-create": (args) => {
        checkVault(args);
        return vault.openOrCreate(args.path, args.content);
      },
      save: (args) => {
        checkVault(args);
        return vault.save(args.path, args.content, args.revision);
      },
      "create-document": (args) => {
        checkVault(args);
        return vault.createDocument(args.path);
      },
      "save-document": (args) => {
        checkVault(args);
        return vault.saveDocument(args.path, args.content, args.revision);
      },
      "import-attachment": (args) => {
        checkVault(args);
        return vault.importAttachment(args.name, args.bytes);
      },
      "read-attachment": (args) => {
        checkVault(args);
        return vault.readAttachment(args.path);
      },
      "copy-text": (args) => {
        checkVault(args);
        if (typeof args.text !== "string" || args.text.length > 1024 * 1024) throw new Error("복사할 텍스트가 올바르지 않습니다.");
        clipboard.writeText(args.text);
        return true;
      },
      "choose-attachments": async (args) => {
        checkVault(args);
        const result = await dialog.showOpenDialog(window, {
          properties: ["openFile", "multiSelections"],
          filters: [
            {
              name: "이미지·PDF·오디오",
              extensions: ["png", "jpg", "jpeg", "gif", "webp", "pdf", "webm", "wav", "mp3", "ogg", "m4a"],
            },
          ],
        });
        checkVault(args);
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
      "move-file": (args) => {
        checkVault(args);
        return vault.moveFile(args.from, args.to, args.revision);
      },
      "trash-file": (args) => {
        checkVault(args);
        return vault.trashFile(args.path, args.revision);
      },
      "restore-trash": (args) => {
        checkVault(args);
        return vault.restoreTrash(args.id);
      },
      recovery: async () => {
        const root = vault?.recoveryRoot ?? recovery;
        await mkdir(root, { recursive: true });
        return shell.openPath(root);
      },
      external: (url) => shell.openExternal(safeExternalUrl(url)),
    }))
      ipcMain.handle(`notes:${name}`, async (event, args) => {
        const exclusive = ["git-restore", "pick-vault", "select-vault", "git-clone", "git-workspace-action", "composer-apply", "pdf-apply"].includes(name);
        const readOnly = name.startsWith("copilot-") || ["snapshot", "vaults", "git-status", "git-history", "git-preview", "git-workspace-status", "git-workspace-diff", "composer-preview", "pdf-preview", "check-updates", "open-web-viewer", "read-attachment", "copy-text", "recovery", "external"].includes(name);
        let locked = false;
        try {
          validateSender(event);
          if (!readOnly) {
            if (restoring || (exclusive && activeMutations)) throw new Error("다른 저장 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.");
            if (exclusive) restoring = true;
            activeMutations++; locked = true;
          }
          const id = vault?.id;
          const value = await action(args);
          if (["create", "save", "create-document", "save-document", "import-attachment", "choose-attachments", "move-file", "trash-file", "restore-trash", "composer-apply", "pdf-apply"].includes(name)) gitBackup.markDirty(id);
          return { ok: true, value };
        } catch (error) {
          return { ok: false, error: error.message };
        } finally {
          if (locked) { activeMutations--; if (exclusive) restoring = false; }
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
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

app.on("window-all-closed", async () => {
  gitBackup?.close();
  await Promise.race([Promise.allSettled([copilot?.close()]), new Promise((resolve) => setTimeout(resolve, 3000))]);
  app.quit();
});

app.on("before-quit", async event => {
  if (!plugins?.instances.size) return;
  event.preventDefault();
  await plugins.close();
  app.quit();
});
