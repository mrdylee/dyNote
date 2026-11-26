import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import electronPath from "electron";
import { join } from "node:path";

const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const fixture = await mkdtemp(join(tmpdir(), "dynote-markdown-find-"));
const profile = join(fixture, "profile"), vault = join(fixture, "vault");
const content = "> [!note] alpha\n> beta\n\n$$x+y$$\n\n# Map\n- Needle\n- needle\n- Needles\n- Ne**ed**le\n";
let app;
try {
  await mkdir(profile); await mkdir(vault);
  await writeFile(join(profile, "settings.json"), JSON.stringify({ vaultRoot: vault }));
  await writeFile(join(vault, "Home.md"), content);
  app = await electron.launch({ executablePath: process.env.DYNOTE_EXECUTABLE || electronPath,
    args: process.env.DYNOTE_EXECUTABLE ? [] : ["."], env: { ...process.env, OPEN_NOTES_DATA: profile } });
  const page = await app.firstWindow();
  page.setDefaultTimeout(8000);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1420, 940));
  await page.getByRole("button", { name: "파일 목록", exact: true }).click();
  await page.locator('.file-row[title="Home.md"]').click();
  const mode = name => page.getByRole("button", { name, exact: true }).click();
  const input = page.getByRole("textbox", { name: "문서에서 찾기" });
  const option = name => page.getByRole("checkbox", { name, exact: true });
  const find = async () => {
    await page.keyboard.press("Control+f");
    await input.waitFor();
    assert.equal(await input.evaluate(el => document.activeElement === el), true);
    const aligned = await input.evaluate(el => {
      const panel = el.closest(".cm-search").getBoundingClientRect();
      const pane = el.closest(".document-pane, .mindmap-editor").getBoundingClientRect();
      return panel.left >= pane.left && pane.right - panel.right >= 0 && pane.right - panel.right <= 24 &&
        panel.top >= pane.top && panel.top - pane.top < 60 && el.offsetHeight >= 36;
    });
    assert.ok(aligned, "Search field is enlarged and anchored at the upper right of the active view");
  };
  const count = async n => page.waitForFunction(n => CSS.highlights.get("note-find")?.size === n, n);
  for (const name of ["Live Preview", "편집 보기", "분할 보기"]) {
    await mode(name);
    await find();
    await input.pressSequentially("Needle");
    await page.waitForFunction(() => document.querySelectorAll(".cm-searchMatch").length === 3);
    await input.press("Escape");
  }
  for (const name of ["읽기 보기", "분할 보기"]) {
    await mode(name);
    await page.locator(".markdown-preview h1").click();
    await find();
    await input.fill("Needle");
    await count(4);
    await option("대소문자 구분").check(); await count(3);
    await option("단어 단위").check(); await count(2);
    await option("정규식").check();
    await input.fill("Ne.dle"); await count(2);
    await input.press("Enter");
    assert.equal(await page.locator(".rendered-find [role=status]").innerText(), "2 / 2");
    await input.press("Shift+Enter");
    assert.equal(await page.locator(".rendered-find [role=status]").innerText(), "1 / 2");
    if (name === "분할 보기") {
      await page.locator(".cm-content").focus();
      await find();
      assert.equal(await page.locator(".rendered-find").count(), 0);
      assert.equal(await page.locator(".cm-search").count(), 1);
    }
    await input.press("Escape");
    assert.equal(await page.locator(".cm-search").count(), 0);
  }
  await mode("마인드맵 보기");
  await mode("접기·펼치기");
  await page.waitForFunction(() => document.querySelectorAll(".mindmap-node").length === 1);
  await find();
  await input.fill("Needle"); await count(3);
  await option("대소문자 구분").check(); await count(2);
  await option("단어 단위").check(); await count(1);
  await option("정규식").check(); await input.fill("Ne.dle"); await count(1);
  await input.press("Escape");
  await page.waitForFunction(() => document.querySelectorAll(".mindmap-node").length === 1);
  for (const view of ["읽기 보기", "분할 보기"]) {
    await mode(view);
    await page.locator(".markdown-preview h1").click();
    await find();
    await input.fill("alpha\\nbeta");
    await count(1);
    await input.fill("alphabeta");
    await count(0);
    assert.equal(await page.locator(".rendered-find [role=status]").innerText(), "결과 없음");

    await input.fill("x+y");
    await count(1);
    await page.waitForFunction(() => {
      const [range] = CSS.highlights.get("note-find-current") ?? [];
      return range?.toString() === "x+y" && range.startContainer.parentElement.closest(".katex-html") &&
        range.getBoundingClientRect().width > 0;
    });

    await input.fill("alpha");
    await page.waitForFunction(() => {
      const [range] = CSS.highlights.get("note-find-current") ?? [];
      if (range?.toString().toLowerCase() !== "alpha") return false;
      const rect = range.getBoundingClientRect();
      return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest(".callout-title");
    });
    await input.press("Escape");
    await find();
    assert.equal(await page.locator(".rendered-find").count(), 1, `${view} must reopen preview search`);
    await input.press("Escape");
  }
  assert.equal(await readFile(join(vault, "Home.md"), "utf8"), content);
  console.log("Verified Markdown find in all five views, both split surfaces, folded mind map nodes, and all four preview search regressions.");
} finally {
  if (app) await app.close();
  await rm(fixture, { recursive: true, force: true });
}
