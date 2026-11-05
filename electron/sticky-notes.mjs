import { BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, Tray } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fitStickyBounds, nextStickyPlacement, STICKY_COLORS, STICKY_SHORTCUT } from "../core/sticky-layout.mjs";

const url = "notes://app/sticky.html";
const preload = fileURLToPath(new URL("./sticky-preload.cjs", import.meta.url));
const icon = fileURLToPath(new URL("./sticky-trayTemplate.png", import.meta.url));
const saveDelay = 550;

function titleFor(content) {
  const first = content.split(/\r?\n/).find(line => line.trim());
  return first?.trim().replace(/^(?:#{1,6}|[-+*])\s+/, "").slice(0, 54) || "포스트잇";
}

function notePath(id, title) {
  const name = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").replace(/^\.+/, "").trim().slice(0, 36);
  return `포스트잇/${name || "메모"}-${id.slice(0, 13)}.md`;
}

export class StickyNotes {
  #records = new Map();
  #windows = new Map();
  #opening = Promise.resolve();
  #lastPlacement;
  #tray;

  constructor({ directory, selectRoot, readNote, saveNote, showMain, canOpen, quitReady }) {
    Object.assign(this, { directory, selectRoot, readNote, saveNote, showMain, canOpen, quitReady });
  }

  async start() {
    const files = await readdir(this.directory).catch(error => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const file of files.filter(name => /^[0-9a-f-]{36}\.json$/.test(name))) {
      try {
        const record = JSON.parse(await readFile(path.join(this.directory, file), "utf8"));
        const { bounds } = record;
        if (file !== `${record.id}.json` || !STICKY_COLORS.includes(record.color)
          || typeof record.root !== "string" || typeof record.path !== "string" || !record.path.startsWith("포스트잇/")
          || typeof record.title !== "string" || !bounds
          || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isInteger)
          || bounds.width < 1 || bounds.height < 1) continue;
        this.#records.set(record.id, record);
        if (!this.#lastPlacement || record.createdAt > this.#lastPlacement.createdAt) this.#lastPlacement = record;
      } catch (error) {
        console.error("포스트잇 상태 읽기:", error.message);
      }
    }

    ipcMain.handle("sticky:state", event => {
      const state = this.#sender(event);
      if (!state) throw new Error("신뢰할 수 없는 요청입니다.");
      const { color, pinned } = state.record;
      return { color, pinned, content: state.content, saved: Boolean(state.revision) };
    });
    ipcMain.on("sticky:edit", (event, content) => {
      const state = this.#sender(event);
      if (!state || typeof content !== "string" || content === state.content) return;
      state.content = content;
      this.#status(state, "저장 중…");
      this.#schedule(state);
    });
    ipcMain.on("sticky:pin", event => {
      const state = this.#sender(event);
      if (!state) return;
      const pinned = !state.record.pinned;
      state.window.setAlwaysOnTop(pinned);
      state.record = { ...state.record, pinned };
      state.window.webContents.send("sticky:pinned", pinned);
      this.#schedule(state);
    });
    ipcMain.on("sticky:close", event => this.#sender(event)?.window.close());

    const trayImage = nativeImage.createFromPath(icon);
    trayImage.setTemplateImage(true);
    this.#tray = new Tray(trayImage);
    this.#tray.setToolTip("Dynote 포스트잇");
    this.shortcutRegistered = globalShortcut.register(STICKY_SHORTCUT, () => this.open());
    this.#refreshMenu();
  }

  open(record) {
    this.#opening = this.#opening.then(() => {
      if (this.canOpen()) return this.#open(record);
    }).catch(error => dialog.showErrorBox("Dynote 포스트잇", error.message));
  }

  async #open(record) {
    const existing = record && this.#windows.get(record.id);
    if (existing) {
      existing.window.show();
      existing.window.focus();
      return;
    }
    const file = record && await this.readNote(record.root, record.path);
    const display = record ? screen.getDisplayMatching(record.bounds)
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    if (!record) {
      const root = this.selectRoot();
      if (!root) throw new Error("Dynote 설정에서 개인 노트 보관함을 연결해 주세요.");
      const openCards = [...this.#windows.values()].map(state => state.record);
      record = {
        id: randomUUID(), root, pinned: false, createdAt: Date.now(),
        ...nextStickyPlacement(display.workArea, openCards, this.#lastPlacement),
      };
      this.#lastPlacement = record;
    }
    const bounds = fitStickyBounds(record.bounds, display.workArea);
    if (Object.keys(bounds).some(key => bounds[key] !== record.bounds[key])) record = { ...record, bounds };

    const window = new BrowserWindow({
      ...bounds, title: "Dynote 포스트잇", show: false,
      frame: false, resizable: true, minWidth: 240, minHeight: 160, minimizable: false,
      maximizable: false, fullscreenable: false, skipTaskbar: true,
      alwaysOnTop: record.pinned === true,
      webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const state = { window, record, content: file?.content ?? "", saved: file?.content ?? "", revision: file?.revision };
    this.#windows.set(record.id, state);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", event => event.preventDefault());
    const rememberBounds = () => {
      const bounds = window.getBounds();
      if (Object.keys(bounds).every(key => bounds[key] === state.record.bounds[key])) return;
      state.record = { ...state.record, bounds };
      this.#schedule(state);
    };
    window.on("move", rememberBounds);
    window.on("resize", rememberBounds);
    window.on("close", event => {
      if (this.quitReady()) return;
      event.preventDefault();
      if (state.closing) return;
      state.closing = true;
      void this.#flush(state).then(async saved => {
        if (window.isDestroyed()) return;
        if (!saved) {
          const { response } = await dialog.showMessageBox(window, {
            type: "warning",
            message: "포스트잇의 변경 사항을 저장하지 못했습니다.",
            detail: "메모로 돌아가서 내용을 복사하거나 다시 저장할 수 있습니다.",
            buttons: ["메모로 돌아가기", "변경 사항 버리고 닫기"],
            defaultId: 0,
            cancelId: 0,
          });
          if (response === 0) return;
        }
        if (!window.isDestroyed()) window.destroy();
      }).catch(error => this.#status(state, error.message, true)).finally(() => { state.closing = false; });
    });
    window.once("closed", () => {
      clearTimeout(state.timer);
      this.#windows.delete(record.id);
    });
    try {
      await window.loadURL(url);
    } catch (error) {
      window.destroy();
      throw error;
    }
    window.show();
    window.focus();
    this.#refreshMenu();
  }

  #sender(event) {
    if (event.senderFrame !== event.sender.mainFrame || event.senderFrame?.url !== url) return null;
    return [...this.#windows.values()].find(state => state.window.webContents === event.sender);
  }

  #status(state, message, error = false) {
    if (!state.window.isDestroyed()) state.window.webContents.send("sticky:status", { message, error });
  }

  #schedule(state) {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => { void this.#flush(state); }, saveDelay);
  }

  #flush(state) {
    clearTimeout(state.timer);
    state.flushing ??= this.#persist(state).finally(() => { state.flushing = null; });
    return state.flushing;
  }

  async #persist(state) {
    try {
      while (true) {
        const content = state.content;
        if (content !== state.saved && (state.revision || content.trim())) {
          state.record.path ??= notePath(state.record.id, titleFor(content));
          const saved = await this.saveNote(state.record.root, state.record.path, content, state.revision);
          state.saved = content;
          state.revision = saved.revision;
          state.record = { ...state.record, title: titleFor(content), updatedAt: Date.now() };
        } else if (state.revision && this.#records.get(state.record.id) !== state.record) {
          const record = state.record;
          await this.#remember(record);
          this.#records.set(record.id, record);
          this.#refreshMenu();
        } else {
          this.#status(state, state.revision ? "저장됨" : "");
          return true;
        }
      }
    } catch (error) {
      this.#status(state, error.message, true);
      return false;
    }
  }

  async #remember(record) {
    const target = path.join(this.directory, `${record.id}.json`);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(temporary, JSON.stringify(record), { flag: "wx", mode: 0o600 });
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }

  #refreshMenu() {
    const recent = [...this.#records.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
    const menu = Menu.buildFromTemplate([
      { id: "sticky-new", label: "새 포스트잇", click: () => this.open() },
      ...(!this.shortcutRegistered ? [{ label: `${STICKY_SHORTCUT} 등록 불가`, enabled: false }] : []),
      { id: "sticky-recent", label: "최근 포스트잇", enabled: recent.length > 0, submenu: recent.map(record => ({
        id: `sticky-recent-${record.id}`, label: record.title, click: () => this.open(record),
      })) },
      { type: "separator" },
      { id: "sticky-show-main", label: "Dynote 열기", click: this.showMain },
      { id: "sticky-quit", label: "Dynote 종료", role: "quit" },
    ]);
    this.#tray.setContextMenu(menu);
  }

  async flushForQuit() {
    await this.#opening;
    const windows = [...this.#windows.values()];
    const saved = await Promise.all(windows.map(state => this.#flush(state)));
    const failed = windows.find((_, index) => !saved[index]);
    if (failed && !failed.window.isDestroyed()) {
      failed.window.show();
      failed.window.focus();
    }
    return !failed;
  }

  dispose() {
    if (this.shortcutRegistered) globalShortcut.unregister(STICKY_SHORTCUT);
    this.#tray?.destroy();
  }
}
