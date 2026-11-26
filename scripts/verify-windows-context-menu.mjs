import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const { _electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const fixture = await mkdtemp(path.join(tmpdir(), "dynote-menu-"));
const profile = path.join(fixture, "profile"), vault = path.join(fixture, "vault");
const original = "일반 문단\n\n- 불릿 항목\n\n```md\n보존할 코드\n```";
await mkdir(profile);
await mkdir(vault);
await writeFile(path.join(profile, "settings.json"), JSON.stringify({ vaultRoot: vault }));
await writeFile(path.join(vault, "Home.md"), original);
const app = await _electron.launch({ executablePath: createRequire(import.meta.url)("electron"),
  args: ["."], env: { ...process.env, OPEN_NOTES_DATA: profile } });
try {
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "파일 목록", exact: true }).waitFor();
  if (process.platform !== "win32") {
    await page.addInitScript(() => Object.defineProperty(navigator, "platform", { value: "Win32" }));
    await page.reload();
  }
  page.setDefaultTimeout(6000);
  await page.getByRole("button", { name: "파일 목록", exact: true }).click();
  const file = page.locator('.file-row[title="Home.md"]');
  await file.click({ button: "right" });
  const tree = page.getByRole("menu", { name: "문서·폴더 작업" });
  assert.equal(await tree.evaluate(el => getComputedStyle(el).borderRadius), "8px");
  await page.keyboard.press("Escape");
  await file.click();
  await page.getByRole("button", { name: "편집 보기", exact: true }).click();
  const menu = page.getByRole("menu", { name: "본문 편집" });
  const editor = page.locator(".code-editor .cm-content");
  const documentText = () => editor.evaluate(el => el.cmTile.root.view.state.doc.toString());
  async function open(offset) {
    const point = await editor.evaluate((el, offset) => {
      const rect = el.cmTile.root.view.coordsAtPos(offset);
      return { x: rect.left + 1, y: rect.top + 3 };
    }, offset);
    await page.mouse.click(point.x, point.y, { button: "right" });
    await menu.waitFor();
  }
  async function select(anchor, head) {
    await editor.evaluate((el, range) => { const view = el.cmTile.root.view; view.dispatch({ selection: range }); view.focus(); }, {anchor, head});
  }
  const bullet = menu.getByRole("menuitem", { name: "불릿으로 전환" });
  const paragraph = menu.getByRole("menuitem", { name: "일반 문단으로 전환" });
  await open(1);
  assert.equal(await paragraph.count(), 0);
  await bullet.click();
  await page.waitForFunction(() => document.querySelector(".cm-content").cmTile.root.view.state.doc.toString().startsWith("- 일반"));
  await open(3);
  assert.equal(await bullet.count(), 0);
  await paragraph.click();
  await page.waitForFunction(value => document.querySelector(".cm-content").cmTile.root.view.state.doc.toString() === value, original);
  await select(0, original.indexOf("항목") + 2);
  await open(1);
  assert.equal(await bullet.count(), 1);
  assert.equal(await paragraph.count(), 1);
  await menu.getByRole("menuitem", { name: "서식", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("menuitem", { name: "굵게", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  assert.equal(await editor.evaluate(el => el === document.activeElement), true);
  await select(0, 2);
  // Observe native copy in this fixture without replacing the user's system clipboard.
  await editor.evaluate(el => el.addEventListener("copy", event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    el.dataset.copied = window.getSelection().toString();
  }, { capture: true, once: true }));
  await open(1);
  await menu.getByRole("menuitem", { name: "복사", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".cm-content").dataset.copied === "일반");
  await select(0, 0);
  await open(original.indexOf("보존할"));
  assert.equal(await bullet.count() + await paragraph.count(), 0);
  await page.keyboard.press("Escape");
  assert.equal(await documentText(), original);
  await page.getByRole("button", { name: "Live Preview", exact: true }).click();
  await select(0, 0);
  const dot = editor.locator(".cm-live-bullet").first();
  const marker = await dot.boundingBox();
  assert.ok(marker);
  await page.mouse.click(marker.x + marker.width / 2, marker.y + marker.height / 2, { button: "right" });
  await paragraph.waitFor();
  assert.equal(await bullet.count(), 0);
  await paragraph.click();
  await page.waitForFunction(() => document.querySelector(".cm-content").cmTile.root.view.state.doc.toString().includes("\n\n불릿 항목"));
  console.log("Folder styling, both paragraph transitions, mixed selection, code block, keyboard navigation and copy passed.");
} finally {
  await app.close();
  await rm(fixture, { recursive: true, force: true });
}
