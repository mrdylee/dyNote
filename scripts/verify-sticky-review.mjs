import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");

async function until(read, check, label) {
  for (let i = 0; i < 55; i++) {
    const value = await read();
    if (check(value)) return value;
    await sleep(100);
  }
  assert.fail(label);
}

async function fixture(bodies, run) {
  const root = await mkdtemp(path.join(await realpath(tmpdir()), "dynote-sticky-review-"));
  const profile = path.join(root, "profile");
  const vault = path.join(root, "vault");
  const stateDir = path.join(profile, "sticky-notes");
  await mkdir(stateDir, { recursive: true });
  await mkdir(path.join(vault, "포스트잇"), { recursive: true });
  await writeFile(path.join(profile, "settings.json"), JSON.stringify({ vaultRoot: vault }));
  await writeFile(path.join(vault, "Reference.md"), "# 참고 문서\n");
  const records = [];
  for (const [index, body] of bodies.entries()) {
    const title = "검증 카드 " + (index + 1);
    const record = {
      id: randomUUID(), title, root: vault, path: "포스트잇/" + title + ".md",
      color: "mint", pinned: true, bounds: { x: 48, y: 100, width: 390, height: 290 },
      createdAt: index + 1, updatedAt: index + 1,
    };
    records.push(record);
    await writeFile(path.join(stateDir, record.id + ".json"), JSON.stringify(record));
    await writeFile(path.join(vault, record.path), body);
  }

  let app;
  const start = async () => {
    app = await electron.launch({
      executablePath: process.env.DYNOTE_EXECUTABLE || process.env.DYNOTE_TEST_ELECTRON
        || path.resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"),
      args: process.env.DYNOTE_EXECUTABLE ? [] : ["."],
      env: { ...process.env, OPEN_NOTES_DATA: profile },
    });
    await app.evaluate(({ Tray, dialog }) => {
      const setMenu = Tray.prototype.setContextMenu;
      Tray.prototype.setContextMenu = function (menu) {
        globalThis.stickyReviewMenu = menu;
        return setMenu.call(this, menu);
      };
      dialog.showErrorBox = (title, message) => { globalThis.stickyReviewDialog = { title, message }; };
    });
    const main = await app.firstWindow();
    main.setDefaultTimeout(7000);
    await main.getByRole("button", { name: "설정", exact: true }).waitFor();
    await until(() => app.evaluate(() => !!globalThis.stickyReviewMenu), Boolean, "tray menu is ready");
    return { app, main };
  };
  try {
    const first = await start();
    await run({
      ...first, profile, vault, records,
      restart: async () => { await app.close(); return start(); },
    });
  } finally {
    if (app) {
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
      await app.close().catch(() => {});
    }
    await rm(root, { recursive: true, force: true });
  }
}

const memo = page => page.getByRole("textbox", { name: "포스트잇 메모" });
const markdown = page => memo(page).evaluate(field => field.cmTile.root.view.state.doc.toString());
const click = (app, id) => app.evaluate((_electron, id) => {
  const item = globalThis.stickyReviewMenu.getMenuItemById(id);
  if (!item) throw new Error("Missing tray item " + id);
  item.click();
}, id);

async function openCard(app, record) {
  const id = "sticky-recent-" + record.id;
  assert.equal(await app.evaluate((_electron, id) => !!globalThis.stickyReviewMenu.getMenuItemById(id), id), true,
    "saved card is available from the tray");
  const opened = app.waitForEvent("window", { timeout: 5500 });
  await click(app, id);
  const page = await opened;
  await memo(page).waitFor();
  return page;
}

async function move(main, from, to) {
  return main.evaluate(async ({ from, to }) => {
    const snapshot = (await window.notes.snapshot()).value;
    const note = snapshot.notes.find(note => note.path === from);
    return window.notes.moveFile({ vaultId: snapshot.id, from, to, revision: note.revision });
  }, { from, to });
}

test("renamed and relocated cards keep autosaving and restore from the new path", async () => {
  const original = "- 메모\n  - [참고](../Reference.md)";
  await fixture([original], async ({ app, main, vault, records: [record], restart }) => {
    const card = await openCard(app, record);
    const renamed = "포스트잇/새 이름.md";
    const relocated = "정리/완료/새 이름.md";
    const pending = original + "\n- 이름 변경 직전 입력";
    await memo(card).fill(pending);
    const renamedResult = await move(main, record.path, renamed);
    assert.equal(renamedResult.ok, true, renamedResult.error);
    await until(() => readFile(path.join(vault, renamed), "utf8"), text => text === pending,
      "pending edits should autosave into the renamed file");
    await assert.rejects(readFile(path.join(vault, record.path)), { code: "ENOENT" });

    const collision = await move(main, renamed, "Reference.md");
    assert.equal(collision.ok, false);
    assert.equal(await readFile(path.join(vault, renamed), "utf8"), pending);

    const movedResult = await move(main, renamed, relocated);
    assert.equal(movedResult.ok, true, movedResult.error);
    const rewritten = pending.replace("../Reference.md", "../../Reference.md");
    await until(() => markdown(card), text => text === rewritten, "open card reflects rewritten relative links");
    const final = rewritten + "\n- 이동 후 입력";
    await memo(card).fill(final);
    await until(() => readFile(path.join(vault, relocated), "utf8"), text => text === final,
      "editing continues at the new location");
    await assert.rejects(readFile(path.join(vault, renamed)), { code: "ENOENT" });

    const closed = card.waitForEvent("close");
    await card.getByRole("button", { name: "포스트잇 닫기" }).click();
    await closed;
    const archived = "정리/최종.md";
    const archivedResult = await move(main, relocated, archived);
    assert.equal(archivedResult.ok, true, archivedResult.error);
    const archivedBody = final.replace("../../Reference.md", "../Reference.md");
    assert.equal(await readFile(path.join(vault, archived), "utf8"), archivedBody);

    const restarted = await restart();
    const reopened = await openCard(restarted.app, record);
    assert.equal(await markdown(reopened), archivedBody);
    assert.equal(await reopened.locator("body").getAttribute("data-color"), record.color);
    const restoredWindow = await restarted.app.browserWindow(reopened);
    assert.deepEqual(await restoredWindow.evaluate(win => win.getBounds()), record.bounds);
    assert.equal(await restoredWindow.evaluate(win => win.isAlwaysOnTop()), true);
  });
});

test("older saved cards remain available beyond the eight most recent", async () => {
  await fixture(Array.from({ length: 9 }, (_, index) => "- 저장된 메모 " + (index + 1)),
    async ({ app, records }) => {
      const oldest = await openCard(app, records[0]);
      assert.equal(await markdown(oldest), "- 저장된 메모 1");
    });
});

test("sticky titles follow the first written line without showing routine save status", async () => {
  await fixture(["\r\n- \r\n- 회의 제목\r\n  - 안건"], async ({ app, vault, records: [record], restart }) => {
    const card = await openCard(app, record);
    const header = card.locator("header span");
    const footer = card.locator("footer");
    assert.deepEqual([await header.textContent(), await footer.isVisible()], ["회의 제목", false]);

    const edited = "# 다음 회의\n- 안건";
    await memo(card).fill(edited);
    assert.deepEqual([await header.textContent(), await footer.isVisible()], ["다음 회의", false]);
    const file = path.join(vault, record.path);
    await until(() => readFile(file, "utf8"), value => value === edited.replaceAll("\n", "\r\n"),
      "title edits autosave to the original Markdown file");
    assert.deepEqual(await readdir(path.dirname(file)), [path.basename(file)]);
    await until(() => app.evaluate((_electron, id) => globalThis.stickyReviewMenu.getMenuItemById(id)?.label,
      "sticky-recent-" + record.id), value => value === "다음 회의", "the tray shows the saved title");
    assert.equal(await footer.isVisible(), false);

    const restarted = await restart();
    const reopened = await openCard(restarted.app, record);
    assert.deepEqual([await reopened.locator("header span").textContent(), await reopened.locator("footer").isVisible()],
      ["다음 회의", false]);
  });
});

test("hiding the main window lets an active Copilot edit finish", async () => {
  await fixture([], async ({ app, main, profile }) => {
    await app.evaluate(({ app, ipcMain }) => {
      const require = process.getBuiltinModule("module").createRequire(app.getAppPath() + "/package.json");
      const { noteTools } = require(app.getAppPath() + "/core/copilot-agent.mjs");
      const { writeFileSync } = require("node:fs");
      globalThis.stickyReviewRequests = [];
      globalThis.stickyReviewCancels = [];
      const handlers = {
        "notes:copilot-status": () => ({ ok: true, value: {
          authenticated: true, login: "fixture", models: [{ id: "fixture", name: "Fixture" }],
        } }),
        "notes:copilot-send": (event, args) => {
          globalThis.stickyReviewRequests.push(args.requestId);
          const emit = (type, data) => event.sender.send("notes:copilot-event", { requestId: args.requestId, type, ...data });
          globalThis.finishStickyReviewEdit = async () => {
            const tools = noteTools({ args, canceled: () => false, emit });
            const read = await tools.find(tool => tool.name === "dynote_read_note").handler({ path: args.context.path });
            if (read.resultType !== "success") throw new Error(read.textResultForLlm);
            const edited = await tools.find(tool => tool.name === "dynote_edit_note").handler({
              path: args.context.path, operation: "append", content: "\n- 숨김 중 도착한 수정",
            });
            if (edited.resultType !== "success") throw new Error(edited.textResultForLlm);
            emit("done", { content: "숨김 중 편집 완료" });
          };
          return { ok: true, value: { requestId: args.requestId } };
        },
        "notes:copilot-cancel": (_event, args) => {
          globalThis.stickyReviewCancels.push(args.requestId);
          writeFileSync(app.getPath("userData") + "/copilot-cancels.json", JSON.stringify(globalThis.stickyReviewCancels));
          return { ok: true, value: true };
        },
      };
      for (const [channel, handler] of Object.entries(handlers)) {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, handler);
      }
    });
    await main.getByRole("tab", { name: "AI 채팅", exact: true }).click();
    await main.getByRole("button", { name: "Copilot 연결 상태 확인" }).click();
    await main.getByLabel("Copilot 모델").selectOption("fixture");
    await main.keyboard.press("Meta+k");
    await main.getByRole("textbox", { name: "빠른 문서 검색" }).fill("path:Reference.md");
    await main.keyboard.press("Enter");
    await main.getByLabel("Copilot 질문").fill("이 문서에 목록을 추가해 줘");
    await main.getByRole("button", { name: "Copilot 보내기" }).click();
    await until(() => app.evaluate(() => globalThis.stickyReviewRequests.length), count => count === 1, "editing started");
    const mainWindow = await app.browserWindow(main);
    await mainWindow.evaluate(win => win.close());
    await until(() => mainWindow.evaluate(win => win.isVisible()), visible => !visible, "main window is hidden");
    assert.deepEqual(await app.evaluate(() => globalThis.stickyReviewCancels), []);
    await app.evaluate(() => globalThis.finishStickyReviewEdit());
    await click(app, "sticky-show-main");
    await main.getByText("숨김 중 편집 완료", { exact: true }).waitFor();
    await main.locator(".copilot-pending-list").getByRole("button", { name: "Reference.md", exact: true }).click();
    await main.getByRole("button", { name: "변경 유지", exact: true }).click();
    await main.locator(".copilot-pending-list").waitFor({ state: "hidden" });

    await main.getByLabel("Copilot 질문").fill("다음 편집도 준비해 줘");
    await main.getByRole("button", { name: "Copilot 보내기" }).click();
    const active = await until(() => app.evaluate(() => globalThis.stickyReviewRequests[1]), Boolean, "second edit started");
    const exited = app.waitForEvent("close", { timeout: 10000 });
    // Request quit before the renderer can acknowledge the first hide request.
    await app.evaluate(({ app, BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].close();
      app.quit();
    });
    await exited;
    assert.deepEqual(JSON.parse(await readFile(path.join(profile, "copilot-cancels.json"), "utf8")), [active]);
  });
});

test("Enter starts a bullet in an existing plain-text sticky and preserves its bytes", async () => {
  const existing = "이전 버전의 일반 문단\r\n";
  await fixture([existing], async ({ app, vault, records: [record] }) => {
    const card = await openCard(app, record);
    const file = path.join(vault, record.path);
    assert.equal(await readFile(file, "utf8"), existing);
    await memo(card).focus();
    await card.keyboard.press("Enter");
    await card.keyboard.insertText("새 불릿");
    assert.equal(await markdown(card), "이전 버전의 일반 문단\n\n- 새 불릿");
    await until(() => readFile(file, "utf8"), text => text === existing + "\r\n- 새 불릿", "original CRLF is preserved");
  });
});
