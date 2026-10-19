import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  session,
  shell,
  Menu,
} from "electron";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Vault } from "../core/vault.mjs";
import { assetPath, safeExternalUrl, trustedFrame } from "../core/security.mjs";
import { demoNotes } from "../core/demo.mjs";

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
let settings;

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
  if (!args || args.vaultId !== vault.id)
    throw new Error("보관함이 변경되었습니다. 문서를 다시 열어 주세요.");
}

async function initialVault() {
  const demo = path.join(app.getPath("userData"), "처음 만나는 노트");
  for (const [relative, content] of Object.entries(demoNotes)) {
    const file = path.join(demo, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content, { flag: "wx", mode: 0o600 }).catch(
      (error) => {
        if (error.code !== "EEXIST") throw error;
      },
    );
  }
  let selected = demo;
  try {
    selected = JSON.parse(await readFile(settings, "utf8")).vaultRoot || demo;
  } catch {
    /* First launch uses only synthetic notes. */
  }
  try {
    return await Vault.open(selected, recovery);
  } catch {
    return Vault.open(demo, recovery);
  }
}

app
  .whenReady()
  .then(async () => {
    recovery = path.join(app.getPath("userData"), "recovery");
    settings = path.join(app.getPath("userData"), "settings.json");
    await mkdir(app.getPath("userData"), { recursive: true });
    vault = await initialVault();
    protocol.handle("notes", async (request) => {
      try {
        const url = new URL(request.url);
        if (url.host === "vault") {
          const parts = decodeURIComponent(url.pathname).slice(1).split("/");
          if (parts.shift() !== vault.id)
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
        const file = assetPath(request.url, dist);
        const mime = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript",
          ".mjs": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".woff2": "font/woff2",
        };
        return new Response(await readFile(file), {
          headers: { "Content-Type": mime[path.extname(file)] },
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    });
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
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
          submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }],
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
    for (const [name, action] of Object.entries({
      snapshot: () => vault.snapshot(),
      "pick-vault": async () => {
        const result = await dialog.showOpenDialog(window, {
          properties: ["openDirectory"],
          title: "Markdown 보관함 선택",
        });
        if (result.canceled) return null;
        const selected = await Vault.open(result.filePaths[0], recovery);
        const snapshot = await selected.snapshot();
        await writeFile(
          settings,
          JSON.stringify({ vaultRoot: selected.root }),
          { mode: 0o600 },
        );
        vault = selected;
        return snapshot;
      },
      create: (args) => {
        checkVault(args);
        return vault.create(args.path);
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
      "choose-attachments": async (args) => {
        checkVault(args);
        const result = await dialog.showOpenDialog(window, {
          properties: ["openFile", "multiSelections"],
          filters: [
            {
              name: "이미지·PDF",
              extensions: ["png", "jpg", "jpeg", "gif", "webp", "pdf"],
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
        await mkdir(vault.recoveryRoot, { recursive: true });
        return shell.openPath(vault.recoveryRoot);
      },
      external: (url) => shell.openExternal(safeExternalUrl(url)),
    }))
      ipcMain.handle(`notes:${name}`, async (event, args) => {
        try {
          validateSender(event);
          return { ok: true, value: await action(args) };
        } catch (error) {
          return { ok: false, error: error.message };
        }
      });
    ipcMain.on("notes:close-ready", (event) => {
      try {
        validateSender(event);
        closeReady = true;
        window.close();
      } catch {
        /* Ignore untrusted senders. */
      }
    });
    window.on("close", (event) => {
      if (closeReady || window.webContents.isDestroyed()) return;
      event.preventDefault();
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
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

app.on("window-all-closed", () => app.quit());
