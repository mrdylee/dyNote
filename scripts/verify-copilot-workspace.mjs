import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const { _electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const profile = await mkdtemp(path.join(os.tmpdir(), "dynote-chat-history-ui-"));
const vault = path.join(profile, "vault"), skill = path.join(profile, "skill"), config = path.join(profile, "servers.json");
await mkdir(vault); await mkdir(skill);
await writeFile(path.join(profile, "settings.json"), JSON.stringify({ vaultRoot: vault }));
await writeFile(path.join(vault, "Home.md"), "original");
await writeFile(path.join(vault, "기준.md"), "검증 기준");
await writeFile(path.join(skill, "SKILL.md"), "---\nname: sample\ndescription: fixture\n---\nLocal instructions.");
await writeFile(config, JSON.stringify({ mcpServers: { fixture: { type: "http", url: "http://127.0.0.1:1" } } }));
const errors = [];
let app, page;
async function launch() {
  app = await _electron.launch({
    executablePath: process.env.DYNOTE_EXECUTABLE || path.join(process.cwd(), "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"),
    args: process.env.DYNOTE_EXECUTABLE ? [] : ["."], env: { ...process.env, OPEN_NOTES_DATA: profile, HOME: profile, GH_TOKEN: "", GITHUB_TOKEN: "", COPILOT_GITHUB_TOKEN: "" },
  });
  page = await app.firstWindow(); page.setDefaultTimeout(10000);
  page.on("pageerror", e => errors.push(e.message));
  await page.getByRole("tab", { name: "Copilot", exact: true }).waitFor();
  await app.evaluate(({ ipcMain, dialog }, { skill, config }) => {
    dialog.showOpenDialog = async (...args) => {
      if (globalThis.cancelPicker) { globalThis.cancelPicker = false; return { canceled: true, filePaths: [] }; }
      const options = args.at(-1);
      return { canceled: false, filePaths: [options.properties.includes("openDirectory") ? skill : config] };
    };
    ipcMain.removeHandler("notes:copilot-status");
    ipcMain.handle("notes:copilot-status", () => ({ ok: true, value: { authenticated: true, login: "fixture", models: [{ id: "auto", name: "Auto" }] } }));
    ipcMain.removeHandler("notes:copilot-send");
    ipcMain.handle("notes:copilot-send", (event, args) => {
      globalThis.actualChat = args;
      const emit = (type, fields) => event.sender.send("notes:copilot-event", { requestId: args.requestId, type, ...fields });
      if (args.mode === "agent") {
        emit("proposal", { proposal: { id: "a", kind: "edit", path: "Home.md", content: "by agent" } });
        emit("proposal", { proposal: { id: "b", kind: "create", path: "Created.md", content: "agent-created" } });
      }
      emit("done", { content: args.mode === "edit" ? "edited text" : "검토했습니다." });
      return { ok: true, value: {} };
    });
  }, { skill, config });
  await page.getByRole("tab", { name: "Copilot", exact: true }).click();
  await page.getByRole("button", { name: "Copilot 연결 상태 확인" }).click();
  await page.getByLabel("Copilot 모델").selectOption("auto");
}
async function close() {
  if (!app) return;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {});
  await app.close(); app = null;
}
const button = name => page.getByRole("button", { name, exact: true });
async function menu(name) {
  await page.getByLabel("Copilot 대화 관리").click(); await button(name).click();
}
try {
  await launch();
  await button("파일 목록").click();
  await page.locator('.file-row[title="Home.md"]').click();
  await menu("Skill · MCP 관리");
  const extensions = page.getByRole("dialog", { name: "Skill · MCP 관리" });
  await app.evaluate(() => { globalThis.cancelPicker = true; });
  await extensions.getByRole("button", { name: "Skill 폴더 추가" }).click();
  assert.equal(await extensions.locator("li").count(), 0);
  await extensions.getByRole("button", { name: "Skill 폴더 추가" }).click();
  await extensions.getByText(skill, { exact: false }).first().waitFor();
  await extensions.getByRole("button", { name: "MCP JSON 추가" }).click();
  await extensions.getByText("연결된 MCP 서버 · fixture").waitFor();
  for (const name of [config, skill]) await extensions.locator("li").filter({ hasText: name }).getByRole("button").click();
  assert.equal(await readFile(config, "utf8").then(s => JSON.parse(s).mcpServers.fixture.type), "http");
  assert.match(await readFile(path.join(skill, "SKILL.md"), "utf8"), /Local instructions/);
  await extensions.getByRole("button", { name: "닫기" }).click();

  const input = page.getByLabel("Copilot 질문");
  await input.fill("#기준"); await input.press("Escape");
  assert.equal(await page.getByRole("listbox", { name: "문서 첨부 후보" }).count(), 0);
  assert.equal(await input.inputValue(), "#기준");
  await input.fill("#"); await input.fill("#기준"); await input.press("Enter");
  await page.locator(".attachment-chip").filter({ hasText: "기준.md" }).waitFor();
  assert.equal(await app.evaluate(() => !!globalThis.actualChat), false);
  await input.fill("두 노트를 작성"); await input.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll(".copilot-pending-list button").length === 2);
  assert.deepEqual((await app.evaluate(() => globalThis.actualChat)).references, [{ path: "기준.md", content: "검증 기준" }]);
  for (const file of ["Home.md", "Created.md"]) {
    await page.locator(".copilot-pending-list").getByRole("button", { name: file }).click();
    await button("변경 유지").click();
    await page.locator(".copilot-pending-list").getByRole("button", { name: file }).waitFor({ state: "detached" });
  }
  assert.equal(await readFile(path.join(vault, "Home.md"), "utf8"), "by agent");
  assert.equal(await readFile(path.join(vault, "Created.md"), "utf8"), "agent-created");
  await close();
  await writeFile(path.join(vault, "Home.md"), "kept manual edit");

  await launch(); await menu("최근 대화");
  await button("두 노트를 작성").click();
  await page.getByText("검토했습니다.", { exact: true }).waitFor();
  await page.getByLabel("Copilot 질문").fill("이어서 확인"); await button("Copilot 보내기").click();
  await button("복원 지점").nth(1).waitFor();
  assert.ok((await app.evaluate(() => globalThis.actualChat)).history.some(m => m.content === "두 노트를 작성"));
  await button("복원 지점").first().click();
  const restore = page.getByRole("dialog", { name: "복원 지점 확인" });
  await restore.getByText("Created.md", { exact: true }).waitFor();
  assert.equal(await button("선택한 상태로 복원").isDisabled(), true);
  await restore.getByLabel("Home.md 충돌 처리").selectOption("keep");
  await button("선택한 상태로 복원").click(); await restore.waitFor({ state: "hidden" });
  assert.equal(await button("복원 지점").count(), 0);
  assert.equal(await readFile(path.join(vault, "Home.md"), "utf8"), "kept manual edit");
  assert.ok(!(await readdir(vault)).includes("Created.md"));
  await button("파일 목록").click();
  await page.locator('.file-row[title="Home.md"]').click();
  await page.getByLabel("Copilot 전달 범위").selectOption("document");
  await page.getByLabel("Copilot 작업").selectOption("edit");
  await page.getByLabel("Copilot 질문").fill("현재 문구를 수정해 줘"); await button("Copilot 보내기").click();
  await button("변경 내용 확인").click(); await button("문서에 적용").click();
  await button("문서에 적용").waitFor({ state: "detached" });
  assert.equal(await readFile(path.join(vault, "Home.md"), "utf8"), "edited text");
  await button("복원 지점").click();
  await button("선택한 상태로 복원").click(); await restore.waitFor({ state: "hidden" });
  assert.equal(await readFile(path.join(vault, "Home.md"), "utf8"), "kept manual edit");
  assert.deepEqual(errors, []);
  console.log("PASS: # reference bytes, real extension registry, Agent Keep, restart, recent chat continuation, conflict choice, recoverable removal transcript rewind, and restore after reviewed Edit.");
} finally { await close(); }
