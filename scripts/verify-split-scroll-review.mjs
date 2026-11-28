import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electronPath from "electron";

const { _electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const fixture = await mkdtemp(join(tmpdir(), "dynote-split-review-"));
const vault = join(fixture, "vault"), profile = join(fixture, "profile");
let app;
try {
  await mkdir(vault);
  await mkdir(profile);
  await writeFile(join(profile, "settings.json"), JSON.stringify({vaultRoot: vault}));
  const paragraphs = Array.from({length: 270}, (_, i) =>
    i === 110 ? "![[Embedded]]" : `Paragraph ${i} variable content here.${i % 50 === 0 ? " FINDMARK" : ""}`);
  await writeFile(join(vault, "Review.md"), paragraphs.join("\n\n"));
  await writeFile(join(vault, "Embedded.md"), Array.from({length: 150}, (_, i) => `Embedded row ${i}`).join("\n\n"));
  await writeFile(join(vault, "Side.md"), "Side");
  app = await _electron.launch({executablePath: process.env.DYNOTE_EXECUTABLE || electronPath,
    args: process.env.DYNOTE_EXECUTABLE ? [] : ["."], env: {...process.env, OPEN_NOTES_DATA: profile}});
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setContentSize(1350, 900));
  await page.getByRole("button", {name: "파일 목록", exact: true}).click();
  await page.locator('.file-row[title="Review.md"]').click();
  await page.getByRole("button", {name: "분할 보기", exact: true}).click();
  const pane = page.locator('.document-pane[data-document-path="Review.md"]');

  await pane.locator(".markdown-preview p").first().click();
  await page.keyboard.press("Control+f");
  const input = page.locator('.document-find input[name="search"]');
  await input.fill("FINDMARK");
  await input.press("Enter");
  const editor = pane.locator(".cm-scroller");
  await page.waitForFunction(() => document.querySelector(".cm-scroller").scrollTop > 400);
  const previous = await editor.evaluate(el => el.scrollTop);
  await editor.hover();
  await page.mouse.wheel(0, -380);
  await page.waitForFunction(top => document.querySelector(".cm-scroller").scrollTop < top - 100, previous);
  await input.press("Enter");
  await page.waitForFunction(() => {
    const view = document.querySelector(".cm-content").cmTile.root.view;
    const line = view.state.doc.toString().indexOf("Paragraph 100 ");
    const rect = view.coordsAtPos(line), bounds = view.scrollDOM.getBoundingClientRect();
    return rect && rect.top >= bounds.top && rect.bottom <= bounds.bottom;
  });
  assert.equal(await input.evaluate(el => document.activeElement === el), true);
  await input.press("Escape");

  const embed = pane.locator(".note-embed");
  for (const fraction of [0.78, 0.2]) {
    await embed.evaluate((el, fraction) => {
      const column = el.closest(".preview-column"), rect = el.getBoundingClientRect();
      column.scrollTop += rect.top - column.getBoundingClientRect().top + rect.height * fraction;
    }, fraction);
    await page.waitForFunction(() => {
      const view = document.querySelector(".cm-content").cmTile.root.view;
      const pos = view.posAtCoords({x: view.contentDOM.getBoundingClientRect().left + 24,
        y: view.scrollDOM.getBoundingClientRect().top + 1}, false);
      return view.state.doc.lineAt(pos).text === "![[Embedded]]";
    });
  }

  for (const file of ["Embedded.md", "Side.md"]) {
    const box = await pane.boundingBox();
    await page.locator(`.file-row[title="${file}"]`).dragTo(pane, {targetPosition: {x: box.width - 10, y: 25}});
    await page.locator(`.document-pane[data-document-path="${file}"]`).waitFor();
  }
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setContentSize(1080, 760));
  await page.waitForFunction(() => innerWidth === 1080);
  assert.ok(await editor.evaluate(el => el.clientHeight > 100), "narrow split leaves editable space");
  await pane.locator(".cm-content").click();
  await page.keyboard.insertText("narrow-editor-check");
  assert.ok(await pane.locator(".cm-content").evaluate(el => el.cmTile.root.view.state.doc.toString().includes("narrow-editor-check")));
  console.log("Split search handoff, embedded note anchoring and narrow three-pane editing passed.");
} finally {
  await app?.close();
  await rm(fixture, {recursive: true, force: true});
}
