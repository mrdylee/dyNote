import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import electronPath from "electron";

const { _electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const root = await mkdtemp(path.join(tmpdir(), "dynote-format-"));
const profile = path.join(root, "profile"), vault = path.join(root, "vault");
const file = path.join(vault, "서식.md");
const original = "# 회의록\n\n- [ ] 확인할 항목\n\n여기서 단어만 확대\n\n반복 색상\n\n추가 검토 예정\n";
const modifier = process.platform === "darwin" ? "Meta" : "Control";
let app, page;
const errors = [];
async function launch() {
  app = await _electron.launch({ executablePath: electronPath, args: ["."], env: { ...process.env, OPEN_NOTES_DATA: profile } });
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  await page.getByRole("button", { name: "파일 목록", exact: true }).click();
  await page.locator('.file-row[title="서식.md"]').click();
}
const control = name => page.getByRole("button", { name, exact: true });
const docText = () => page.locator(".cm-content").evaluate(el => el.cmTile.root.view.state.doc.toString());
async function select(text, caretOnly = false) {
  await page.locator(".cm-content").evaluate((el, {text, caretOnly}) => {
    const view = el.cmTile.root.view, start = view.state.doc.toString().indexOf(text);
    if (start < 0) throw new Error("Missing test text: " + text);
    view.dispatch({ selection: { anchor: start, head: caretOnly ? start : start + text.length } });
    view.focus();
  }, { text, caretOnly });
}

async function chooseContextFormat(word, action) {
  const point = await page.locator(".cm-content").evaluate((el, target) => {
    const view = el.cmTile.root.view;
    const rect = view.coordsAtPos(view.state.doc.toString().indexOf(target));
    return { x: rect.left + 1, y: (rect.top + rect.bottom) / 2 };
  }, word);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await app.evaluate(async (_electron, id) => {
    for (let i = 0; !globalThis.formattingMenu && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 20));
    const item = globalThis.formattingMenu?.getMenuItemById(id);
    if (!item) throw new Error("Missing editor context action: " + id);
    globalThis.formattingMenu = null;
    item.click();
  }, action);
}

try {
  await mkdir(profile); await mkdir(vault);
  await writeFile(file, original);
  await writeFile(path.join(profile, "settings.json"), JSON.stringify({ vaultRoot: vault }));
  await launch();
  await control("편집 보기").click();
  await app.evaluate(({ Menu }) => {
    Menu.prototype.popup = function () { globalThis.formattingMenu = this; };
  });
  await select("회의록");
  await chooseContextFormat("확인할", "format-size-large");
  const sizedTask = original.replace("확인할 항목", '<span style="font-size:1.25em">확인할 항목</span>');
  await page.waitForFunction(expected => document.querySelector(".cm-content")?.cmTile.root.view.state.doc.toString() === expected, sizedTask);
  await page.keyboard.press(modifier + "+z");
  assert.equal(await docText(), original);

  await select("여기서 단어만");
  await chooseContextFormat("단어만", "format-bold");
  const boldSelection = original.replace("여기서 단어만", "**여기서 단어만**");
  await page.waitForFunction(expected => document.querySelector(".cm-content").cmTile.root.view.state.doc.toString() === expected, boldSelection);
  await page.keyboard.press(modifier + "+z");
  assert.equal(await docText(), original);

  await select("확인할", true);
  await control("굵게").click();
  assert.equal(await docText(), original.replace("확인할 항목", "**확인할 항목**"));
  await page.keyboard.press(modifier + "+z");
  assert.equal(await docText(), original);
  await control("굵게").click();

  await select("단어만");
  await page.getByRole("combobox", { name: "글자 크기 적용" }).selectOption("size-larger");
  await page.locator(".text-color-menu summary").click();
  await control("파랑 #1565c0").click();
  await control("글자 색상 적용").click();
  await control("굵게").click();
  await select("반복 색상", true);
  await page.keyboard.press(modifier + "+Shift+h");
  // Drag over real glyphs so a mouse user can reach the menu without the fixed toolbar.
  const drag = await page.locator(".cm-content").evaluate(el => {
    const view = el.cmTile.root.view, from = view.state.doc.toString().indexOf("검토 예정");
    const start = view.coordsAtPos(from), end = view.coordsAtPos(from + 2);
    return { x: start.left, end: end.left, y: (start.top + start.bottom) / 2 };
  });
  await page.mouse.move(drag.x, drag.y);
  await page.mouse.down();
  await page.mouse.move(drag.end, drag.y, { steps: 5 });
  await page.mouse.up();
  const mini = page.getByRole("toolbar", { name: "선택 영역 미니 서식" });
  const beforeMini = await docText();
  await mini.getByRole("button", { name: "선택 굵게" }).click();
  assert.ok((await docText()).includes("추가 **검토** 예정"));
  await page.keyboard.press(modifier + "+z");
  await mini.getByRole("combobox", { name: "글자색" }).selectOption("#c62828");
  assert.ok((await docText()).includes('추가 <span style="color:#c62828">검토</span> 예정'));
  await page.keyboard.press(modifier + "+z");
  await mini.getByRole("combobox", { name: "크기" }).selectOption("size-large");
  assert.ok((await docText()).includes('추가 <span style="font-size:1.25em">검토</span> 예정'));
  await page.keyboard.press(modifier + "+z");
  assert.equal(await docText(), beforeMini);
  await mini.getByRole("button", { name: "선택 노란 형광펜" }).click();
  const yellow = '<span style="background-color:#ffe58a">검토</span>';
  assert.ok((await docText()).includes(yellow));
  await mini.getByRole("button", { name: "선택 형광펜 지우기" }).click();
  assert.ok(!(await docText()).includes(yellow));
  await page.keyboard.press(modifier + "+z");
  assert.ok((await docText()).includes(yellow));
  await page.keyboard.press("Escape");
  await mini.waitFor({ state: "hidden" });
  await select("검토", true);
  await mini.waitFor({ state: "hidden" });
  const saved = await docText();
  assert.ok(saved.includes('<span style="color:#1565c0">반복 색상</span>'));
  assert.ok(saved.includes("- [ ] **확인할 항목**"));
  await page.keyboard.press(modifier + "+s");
  await page.getByText("모든 변경사항 저장됨", {exact:true}).waitFor();
  assert.equal(await readFile(file, "utf8"), saved);
  await app.close(); app = null;

  await launch();
  await control("분할 보기").click();
  const preview = page.locator(".markdown-preview");
  const highlighted = preview.locator('span[style*="background-color"]');
  assert.equal(await highlighted.innerText(), "검토");
  assert.equal(await highlighted.evaluate(el => getComputedStyle(el).backgroundColor), "rgb(255, 229, 138)");
  const enlarged = preview.locator('span[style*="font-size"]');
  assert.equal(await enlarged.count(), 1);
  assert.equal(await enlarged.innerText(), "단어만");
  assert.equal(await enlarged.evaluate(el => parseFloat(getComputedStyle(el).fontSize) / parseFloat(getComputedStyle(el.parentElement).fontSize)), 1.5);
  assert.equal(await preview.locator('span[style*="color"]').filter({hasText:"단어만"}).evaluate(el => getComputedStyle(el).color), "rgb(21, 101, 192)");
  const strong = preview.locator("strong");
  assert.deepEqual(await strong.allInnerTexts(), ["확인할 항목", "단어만"]);
  assert.equal(await strong.last().evaluate(el => getComputedStyle(el).color), "rgb(21, 101, 192)");
  await control("Live Preview").click();
  await select("반복 색상", true);
  assert.equal(await page.locator(".cm-live-background-color").innerText(), "검토");
  assert.equal(await page.locator(".cm-live-font-size").innerText(), "단어만");
  await select("단어만");
  await page.getByRole("combobox", { name: "글자 크기 적용" }).selectOption("size-default");
  const reset = await docText();
  assert.ok(!reset.includes("font-size:"));
  assert.ok(reset.includes('<span style="color:#1565c0">**단어만**</span>'));
  assert.deepEqual(errors, []);
  console.log("PASS: native context menu, line and selection formatting, drag selection toolbar, highlight removal and undo, saved highlights in reading and Live Preview after restart");
} finally {
  if (app) await app.close();
  await rm(root, { recursive: true, force: true });
}
