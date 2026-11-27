import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import electronPath from "electron";

const { _electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const root = await mkdtemp(path.join(tmpdir(), "dynote-code-preview-"));
const vault = path.join(root, "vault"), profile = path.join(root, "profile");
const code = "const result = sensor.read(42);\n".repeat(2500);
const note = "<!-- dynote:journal -->\n\n~~~md\n- first\n- second\n~~~\n\n<!-- /dynote:journal -->\n\n~~~js\n" + code + "~~~\n";
let app;
try {
  await Promise.all([mkdir(vault), mkdir(profile)]);
  await writeFile(path.join(profile, "settings.json"), JSON.stringify({ vaultRoot: vault }));
  await writeFile(path.join(vault, "Home.md"), note);
  app = await _electron.launch({ executablePath: process.env.DYNOTE_EXECUTABLE || electronPath,
    args: process.env.DYNOTE_EXECUTABLE ? [] : ["."], env: { ...process.env, OPEN_NOTES_DATA: profile } });
  const page = await app.firstWindow(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.getByRole("button", { name: "파일 목록", exact: true }).click();
  await page.locator('.file-row[title="Home.md"]').click();
  await page.getByRole("button", { name: "분할 보기", exact: true }).click();
  const block = page.locator(".markdown-preview code.language-js");
  const chunks = block.locator(":scope > span");
  for (const edge of ["firstElementChild", "lastElementChild"]) {
    await (edge === "firstElementChild" ? chunks.first() : chunks.last()).scrollIntoViewIfNeeded();
    await page.waitForFunction(edge => {
      const chunk = document.querySelector(".markdown-preview code.language-js")[edge];
      return [...(CSS.highlights.get("tok-keyword") ?? [])].some(range => chunk.contains(range.startContainer));
    }, edge);
  }
  assert.equal(await block.textContent(), code);
  assert.ok(await block.locator("span").count() < 100, "Rendering must avoid per-token DOM nodes");
  assert.equal(await chunks.first().evaluate(first =>
    [...CSS.highlights.get("tok-keyword")].some(range => first.contains(range.startContainer))), false);

  const editor = page.locator(".cm-content").first();
  await editor.evaluate((el, anchor) => {
    const view = el.cmTile.root.view;
    view.dispatch({ selection: { anchor }, scrollIntoView: true });
    view.focus();
  }, note.indexOf("second"));
  await page.keyboard.press("Backspace");
  assert.equal(await editor.evaluate(el => el.cmTile.root.view.state.doc.toString()), note.replace("- second", "-second"));
  await page.getByRole("button", { name: "편집 보기", exact: true }).click();
  await page.waitForFunction(() => !CSS.highlights.has("tok-keyword"));
  assert.deepEqual(errors, []);
  console.log("Large split-preview scrolling, cleanup, and journal Backspace passed.");
} finally {
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
