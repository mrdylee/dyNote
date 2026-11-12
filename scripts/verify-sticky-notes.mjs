import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const root = await mkdtemp(path.join(tmpdir(), "dynote-sticky-verify-"));
const profile = path.join(root, "profile");
const personal = path.join(root, "personal");
const team = path.join(root, "team");
const folder = path.join(personal, "포스트잇");
const shortcut = "Ctrl+Shift+M";
await Promise.all([profile, personal, team].map(dir => mkdir(dir)));
await writeFile(path.join(profile, "settings.json"), JSON.stringify({
  vaultRoot: team, vaults: [personal, team], vaultPurposes: { [personal]: "personal", [team]: "team" },
}));
await writeFile(path.join(personal, "개인 자료.md"), "# 개인 자료\n");
await writeFile(path.join(team, "팀 자료.md"), "# 팀 자료\n");

async function until(read, matches) {
  for (let i = 0; i < 80; i++) {
    const value = await read();
    if (matches(value)) return value;
    await sleep(100);
  }
  throw new Error("Timed out waiting for the expected native state");
}

const launch = () => electron.launch({
  executablePath: process.env.DYNOTE_EXECUTABLE || process.env.DYNOTE_TEST_ELECTRON
    || path.resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"),
  args: process.env.DYNOTE_EXECUTABLE ? [] : ["."],
  env: { ...process.env, OPEN_NOTES_DATA: profile },
});

const captureTray = app => app.evaluate(({ Tray }) => {
  const setMenu = Tray.prototype.setContextMenu;
  Tray.prototype.setContextMenu = function (menu) {
    globalThis.verifiedStickyTray = menu;
    return setMenu.call(this, menu);
  };
});

const clickTray = (app, id) => app.evaluate((_electron, id) => {
  const item = globalThis.verifiedStickyTray?.getMenuItemById(id);
  if (!item) throw new Error(`Missing tray item ${id}`);
  item.click();
}, id);

const postShortcut = () => execFileSync("python3", ["-c", `
import ctypes as c
import time
cg = c.CDLL('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
cf = c.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
cg.CGPreflightPostEventAccess.restype = c.c_bool
if not cg.CGPreflightPostEventAccess():
    raise RuntimeError('Native keyboard input requires an already-authorized terminal')
cg.CGEventCreateKeyboardEvent.argtypes = (c.c_void_p, c.c_uint16, c.c_bool)
cg.CGEventCreateKeyboardEvent.restype = c.c_void_p
cg.CGEventSetFlags.argtypes = (c.c_void_p, c.c_uint64)
cg.CGEventSetType.argtypes = (c.c_void_p, c.c_uint32)
cg.CGEventPost.argtypes = (c.c_int, c.c_void_p)
cf.CFRelease.argtypes = (c.c_void_p,)
control, shift = 1 << 18, 1 << 17
for key, pressed, flags in ((59, True, control), (56, True, control | shift),
                            (46, True, control | shift), (46, False, control | shift),
                            (56, False, control), (59, False, 0)):
    event = cg.CGEventCreateKeyboardEvent(None, key, pressed)
    if key != 46:
        cg.CGEventSetType(event, 12) # kCGEventFlagsChanged
    cg.CGEventSetFlags(event, flags)
    cg.CGEventPost(0, event)
    cf.CFRelease(event)
    time.sleep(0.035)
`]);

// Resize with the native window edges. Chromium mouse events stop at the renderer.
async function growSticky(app, page, bounds) {
  const { x, y, width, height } = bounds;
  const drag = (x, y, dx, dy) => execFileSync("python3", ["-c", `
import ctypes as c
import sys
import time
class Point(c.Structure):
    _fields_ = [('x', c.c_double), ('y', c.c_double)]
cg = c.CDLL('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
cf = c.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
cg.CGEventCreateMouseEvent.argtypes = (c.c_void_p, c.c_uint32, Point, c.c_uint32)
cg.CGEventCreateMouseEvent.restype = c.c_void_p
cg.CGEventPost.argtypes = (c.c_int, c.c_void_p)
cf.CFRelease.argtypes = (c.c_void_p,)
x, y, dx, dy = map(int, sys.argv[1:])
for kind, step in [(5, 0), (1, 0)] + [(6, i) for i in range(1, 9)] + [(2, 8)]:
    event = cg.CGEventCreateMouseEvent(None, kind, Point(x + dx * step / 8, y + dy * step / 8), 0)
    cg.CGEventPost(0, event)
    cf.CFRelease(event)
    time.sleep(0.04)
`, String(x), String(y), String(dx), String(dy)]);
  drag(x + width - 2, y + Math.floor(height / 2), 96, 0);
  const wider = await until(() => stickyBounds(app, page), value => value.width > width);
  drag(wider.x + Math.floor(wider.width / 2), wider.y + wider.height - 2, 0, 72);
  return until(() => stickyBounds(app, page), value => value.height > height);
}

const openWithKey = async app => {
  const opened = app.waitForEvent("window", { timeout: 7000 });
  postShortcut();
  const page = await opened.catch(async error => {
    console.error("native probe", await app.evaluate(({ app, BrowserWindow, globalShortcut }) => ({
      active: app.isActive(), hidden: app.isHidden(), registered: globalShortcut.isRegistered("Ctrl+Shift+M"),
      windows: BrowserWindow.getAllWindows().map(win => ({ visible: win.isVisible(), url: win.webContents.getURL() })),
    })));
    throw error;
  });
  await page.getByRole("textbox", { name: "Sticky Note 메모" }).waitFor();
  return page;
};
const stickyBounds = async (app, page) => (await app.browserWindow(page)).evaluate(win => win.getBounds());
const memo = page => page.getByRole("textbox", { name: "Sticky Note 메모" });
const markdown = page => memo(page).evaluate(field => field.cmTile?.root.view.state.doc.toString() ?? field.value);
const color = page => page.locator("body").getAttribute("data-color");
const diskFiles = async () => (await readdir(folder).catch(error => {
  if (error.code === "ENOENT") return [];
  throw error;
})).filter(file => file.endsWith(".md"));

let app;
try {
  app = await launch();
  await captureTray(app);
  const main = await app.firstWindow();
  main.setDefaultTimeout(6500);
  await main.getByRole("button", { name: "설정", exact: true }).click();
  await main.getByRole("button", { name: "단축키", exact: true }).click();
  await main.getByText(shortcut, { exact: true }).waitFor();
  await main.getByText("새 Sticky Note 열기", { exact: true }).waitFor();
  await main.keyboard.press("Escape");
  assert.equal(await app.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), shortcut), true);
  const mainWindow = await app.browserWindow(main);
  await mainWindow.evaluate(win => win.close());
  await until(() => mainWindow.evaluate(win => win.isVisible()), value => value === false);
  await app.evaluate(({ app }) => app.hide());
  await until(() => app.evaluate(({ app }) => app.isActive()), value => value === false);
  // Let AppKit finish its foreground application transition before posting input.
  await sleep(350);

  const cards = [];
  for (let index = 0; index < 3; index++) cards.push(await openWithKey(app));
  assert.equal(await mainWindow.evaluate(win => win.isVisible()), false);
  assert.equal(new Set(await Promise.all(cards.map(color))).size, 3);
  const placements = await Promise.all(cards.map(page => stickyBounds(app, page)));
  assert.equal(new Set(placements.map(({ x, y }) => `${x},${y}`)).size, 3);
  await until(() => memo(cards[2]).evaluate(field => field === document.activeElement), Boolean);

  assert.equal((await diskFiles()).length, 0, "opening empty cards should not create Markdown");
  const threaded = cards[0];
  assert.equal(await markdown(threaded), "- ", "a new sticky starts with the first journal bullet");
  await (await app.browserWindow(threaded)).evaluate(win => win.focus());
  await memo(threaded).focus();
  await threaded.keyboard.insertText("회의 메모 1");
  await threaded.keyboard.press("Enter");
  await threaded.keyboard.insertText("확인할 항목");
  assert.equal(await markdown(threaded), "- 회의 메모 1\n- 확인할 항목");
  await threaded.keyboard.press("Tab");
  assert.equal(await markdown(threaded), "- 회의 메모 1\n  - 확인할 항목");
  const thread = threaded.locator(".cm-journal-threading .cm-journal-thread");
  await thread.waitFor({ timeout: 5000 });
  assert.equal(await thread.evaluate(marker => getComputedStyle(marker).borderLeftWidth), "2px");
  await threaded.keyboard.press("Shift+Tab");
  assert.equal(await markdown(threaded), "- 회의 메모 1\n- 확인할 항목");
  await thread.waitFor({ state: "detached", timeout: 5000 });
  await threaded.keyboard.press("Tab");
  await thread.waitFor({ timeout: 5000 });
  await memo(cards[1]).fill("회의 메모 2\n- 예전 형식으로 적은 내용");
  await memo(cards[2]).fill("회의 메모 3\n- 확인할 항목");
  const files = await until(diskFiles, value => value.length === 3);
  const contents = await Promise.all(files.map(file => readFile(path.join(folder, file), "utf8")));
  assert.ok(contents.includes("- 회의 메모 1\n  - 확인할 항목"));
  assert.ok(contents.includes("회의 메모 2\n- 예전 형식으로 적은 내용"));
  assert.ok(contents.includes("회의 메모 3\n- 확인할 항목"));
  assert.deepEqual(await readdir(team), ["팀 자료.md"]);
  const file = files[contents.findIndex(body => body.startsWith("- 회의 메모 1\n"))];
  const notePath = path.join(folder, file);
  const noteColor = await color(cards[0]);
  const card = await app.browserWindow(cards[0]);
  await card.evaluate(win => {
    const [x, y] = win.getPosition();
    win.setPosition(x - 160, y + 46);
    win.focus();
  });
  assert.equal(await card.evaluate(win => win.isResizable()), true);
  const beforeResize = await stickyBounds(app, threaded);
  const resized = await growSticky(app, threaded, beforeResize);
  assert.equal(resized.x, beforeResize.x);
  assert.equal(resized.y, beforeResize.y);
  assert.ok(resized.width >= beforeResize.width + 60 && resized.height >= beforeResize.height + 45);
  await cards[0].getByRole("button", { name: "항상 위에 고정" }).click();
  assert.equal(await card.evaluate(win => win.isAlwaysOnTop()), true);
  const finalBody = "- 회의 메모 1\n  - 닫기 직전 편집";
  await memo(cards[0]).fill(finalBody);
  const closed = cards[0].waitForEvent("close");
  await cards[0].getByRole("button", { name: "Sticky Note 닫기" }).click();
  await closed;
  assert.equal(await readFile(notePath, "utf8"), finalBody);
  const quitBody = "회의 메모 3\n- 종료 직전 편집";
  await memo(cards[2]).fill(quitBody);
  await app.close();
  app = null;
  assert.ok((await Promise.all(files.map(file => readFile(path.join(folder, file), "utf8")))).includes(quitBody));

  app = await launch();
  await captureTray(app);
  await app.firstWindow();
  await until(() => app.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), shortcut), Boolean);
  await sleep(350);
  const blank = await openWithKey(app);
  const reopened = app.waitForEvent("window", { timeout: 7000 });
  const recent = await app.evaluate(() => {
    const menu = globalThis.verifiedStickyTray;
    return menu?.getMenuItemById("sticky-recent")?.submenu.items.find(item => item.label === "회의 메모 1")?.id;
  });
  assert.ok(recent, "the saved note appears in the tray after restart");
  await clickTray(app, recent);
  const restored = await reopened;
  await memo(restored).waitFor();
  assert.equal(await markdown(restored), finalBody);
  assert.equal(await color(restored), noteColor);
  assert.deepEqual(await stickyBounds(app, restored), resized);
  await restored.locator(".cm-journal-threading .cm-journal-thread").waitFor({ timeout: 5000 });
  assert.equal(await (await app.browserWindow(restored)).evaluate(win => win.isAlwaysOnTop()), true);
  await blank.getByRole("button", { name: "Sticky Note 닫기" }).click();
  assert.equal((await diskFiles()).length, 3);
  await mkdir("output/playwright", { recursive: true });
  await restored.screenshot({ path: "output/playwright/sticky-note.png" });
  await app.evaluate(({ app }) => app.hide());
  const external = "# 다른 편집기에서 저장한 내용";
  await writeFile(notePath, external);
  await memo(restored).fill("보존할 초안");
  await restored.getByRole("status").getByText(/외부에서 문서가 변경/).waitFor();
  assert.equal(await markdown(restored), "보존할 초안");
  await app.evaluate(({ dialog }) => {
    const original = dialog.showMessageBox;
    dialog.showMessageBox = async (window, options) => {
      if (options.buttons?.includes("변경 사항 버리고 닫기")) {
        return { response: 1, checkboxChecked: false };
      }
      return original(window, options);
    };
  });
  const conflictClosed = restored.waitForEvent("close", { timeout: 5000 });
  await restored.getByRole("button", { name: "Sticky Note 닫기" }).click();
  await conflictClosed;
  assert.equal(await readFile(notePath, "utf8"), external);
  console.log("Verified native shortcut, hidden main window, settings, three Markdown files, close/quit saves, tray reopen, bullet threading, resize restoration and external-edit conflict handling.");
} finally {
  if (app) {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
  }
  await rm(root, { recursive: true, force: true });
}
