import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const fixture = await mkdtemp(`${tmpdir()}/dynote-text-color-`), profile = `${fixture}/profile`, vault = `${fixture}/vault`;
await mkdir(profile); await mkdir(vault); await mkdir("output/playwright", { recursive: true });
const original = `# 색상

한글 본문
`, start = original.indexOf("한글");
await writeFile(`${profile}/settings.json`, JSON.stringify({ vaultRoot: vault }));
await writeFile(`${vault}/Home.md`, original);
const launch = () => electron.launch({ executablePath: process.env.DYNOTE_EXECUTABLE || `${process.cwd()}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`, args: process.env.DYNOTE_EXECUTABLE ? [] : ["."], env: { ...process.env, OPEN_NOTES_DATA: profile } });
let app = await launch(), page;
const report = { checks: [], errors: [] };
const setup = async () => {
  page = await app.firstWindow(); page.setDefaultTimeout(12000);
  page.on("pageerror", error => report.errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1420, 940));
  await page.locator('.file-row[title="Home.md"]').click();
};
const editor = () => page.locator(".cm-content");
const content = () => editor().evaluate(el => el.cmTile.root.view.state.doc.toString());
const select = async (from, to = from) => editor().evaluate((el, [anchor, head]) => { const v = el.cmTile.root.view; v.dispatch({ selection: { anchor, head } }); v.focus(); }, [from, to]);
const choose = async color => { const picker = page.getByLabel("글자 색상", { exact: true }); await picker.focus(); await picker.evaluate((el, color) => { el.value = color; el.dispatchEvent(new Event("input", { bubbles: true })); }, color); };
const apply = () => page.getByRole("button", { name: "글자 색상 적용", exact: true }).click();
const save = async expected => {
  await page.keyboard.press("Meta+s");
  await page.locator(".save-status").filter({ hasText: "모든 변경사항 저장됨" }).waitFor();
  assert.equal(await readFile(`${vault}/Home.md`, "utf8"), expected);
};
try {
  await setup(); await page.getByRole("button", { name: "편집 보기", exact: true }).click();
  await select(start, start + 2); await choose("#1565c0"); await apply();
  const blue = original.replace("한글", '<span style="color:#1565c0">한글</span>');
  assert.equal(await content(), blue);
  await page.keyboard.press("Meta+z"); assert.equal(await content(), original);
  await page.keyboard.press("Meta+Shift+z"); assert.equal(await content(), blue);
  report.checks.push("selected Korean text receives chosen color; selection survives picker; one-step undo and redo");
  await page.getByRole("button", { name: "분할 보기", exact: true }).click();
  const readingColor = () => page.locator('.markdown-preview span[style*="color:"]');
  assert.equal(await readingColor().innerText(), "한글");
  assert.equal(await readingColor().evaluate(el => getComputedStyle(el).color), "rgb(21, 101, 192)");
  await page.getByRole("button", { name: "Live Preview", exact: true }).click();
  await select((await content()).length);
  assert.equal(await page.locator(".cm-live-color").first().evaluate(el => getComputedStyle(el).color), "rgb(21, 101, 192)");
  await select(start + '<span style="color:#1565c0">'.length, start + '<span style="color:#1565c0">'.length + 2);
  await choose("#c62828"); await apply();
  const red = blue.replace("#1565c0", "#c62828");
  assert.equal(await content(), red); assert.equal((await content()).match(/<span /g).length, 1);
  await page.getByRole("button", { name: "글자 색상 지우기", exact: true }).click();
  assert.equal(await content(), original);
  await page.keyboard.press("Meta+z"); assert.equal(await content(), red);
  await save(red);
  report.checks.push("reading and Live Preview render exact color; recolor replaces existing span; default-color reset undoes in one step");
  await app.close(); app = await launch(); await setup();
  assert.equal(await readingColor().innerText(), "한글");
  assert.equal(await readingColor().evaluate(el => getComputedStyle(el).color), "rgb(198, 40, 40)");
  assert.equal(await readFile(`${vault}/Home.md`, "utf8"), red);
  await page.getByRole("button", { name: "Live Preview", exact: true }).click();
  await select(red.length);
  assert.equal(await page.locator(".cm-live-color").first().evaluate(el => getComputedStyle(el).color), "rgb(198, 40, 40)");
  await select(2, 4); await choose("#1565c0"); await apply();
  await page.getByRole("tab", { name: "문서 정보", exact: true }).click();
  const outline = page.locator(".outline").getByRole("button", { name: "색상", exact: true });
  await outline.waitFor(); await select((await content()).length); await outline.click();
  const headingLine = await editor().evaluate(el => { const view = el.cmTile.root.view; return view.state.doc.lineAt(view.state.selection.main.head).number; });
  assert.equal(headingLine, 1);
  await page.getByRole("button", { name: "분할 보기", exact: true }).click();
  assert.equal(await page.locator(".markdown-preview h1").getAttribute("id"), "색상");
  report.checks.push("colored heading keeps stable anchor and readable outline; outline navigation targets original heading line");
  await page.screenshot({ path: "output/playwright/text-color.png" });
  report.checks.push("exact Markdown bytes and chosen color survive app restart in reading view and Live Preview");
  assert.deepEqual(report.errors, []);
  await writeFile("output/playwright/text-color.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await app.close(); await rm(fixture, { recursive: true, force: true }); }
