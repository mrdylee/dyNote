import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import electronPath from "electron";
import { join } from "node:path";

const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const fixture = await mkdtemp(join(tmpdir(), "dynote-markdown-find-"));
const profile = join(fixture, "profile"), vault = join(fixture, "vault");
const content = "> [!note] alpha\n> beta\n\n$$x+y$$\n\n# Map\n- Needle\n- needle\n- Needles\n- Ne**ed**le\n" + "\n일반 문단\n".repeat(100) + "\n아래쪽 **검색** 결과\n\n[참고](https://example.com/source-only-target)\n";
let app;
try {
  await mkdir(profile); await mkdir(vault);
  await writeFile(join(profile, "settings.json"), JSON.stringify({ vaultRoot: vault }));
  await writeFile(join(vault, "Home.md"), content);
  await mkdir(join(vault,"Records"));
  await writeFile(join(vault,"Records","First.md"), "시작\r\nitem-11 과 item-22\r\n");
  await writeFile(join(vault,"Second.md"), "item-33\nITEM-44\n");
  app = await electron.launch({ executablePath: process.env.DYNOTE_EXECUTABLE || electronPath,
    args: process.env.DYNOTE_EXECUTABLE ? [] : ["."], env: { ...process.env, OPEN_NOTES_DATA: profile } });
  const page = await app.firstWindow();
  page.setDefaultTimeout(8000);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1420, 940));
  await page.getByRole("button", { name: "파일 목록", exact: true }).click();
  await page.locator('.file-row[title="Home.md"]').click();
  const mode = name => page.getByRole("button", { name, exact: true }).click();
  const input = page.getByRole("textbox", { name: "문서에서 찾기" });
  const options = page.getByRole("button", { name: "검색 옵션" });
  const showOptions = async () => {
    if (await options.getAttribute("aria-expanded") === "false") await options.click();
  };
  const option = name => page.getByRole("checkbox", { name, exact: true });
  const find = async () => {
    await page.keyboard.press("Control+f");
    await input.waitFor();
    assert.equal(await input.evaluate(el => document.activeElement === el), true);
    const aligned = await input.evaluate(el => {
      const panel = el.closest(".document-search-host").getBoundingClientRect();
      const pane = el.closest(".document-pane, .mindmap-editor").getBoundingClientRect();
      return panel.left >= pane.left && pane.right - panel.right >= 0 && pane.right - panel.right <= 24 &&
        panel.top >= pane.top && panel.top - pane.top < 60 && el.offsetHeight <= 28 && panel.width <= 321;
    });
    assert.ok(aligned, "Search field is compact and anchored at the upper right of the active view");
  };
  const count = async n => page.waitForFunction(n => CSS.highlights.get("note-find")?.size === n, n);
  for (const name of ["Live Preview", "편집 보기", "분할 보기"]) {
    await mode(name);
    await find();
    if (name === "편집 보기") {
      await showOptions();
      await page.getByRole("textbox", { name: "바꿀 내용" }).waitFor();
      await options.click();
      assert.equal(await page.getByRole("textbox", { name: "바꿀 내용" }).count(), 0);
    }
    await input.selectText();
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
    await showOptions();
    await option("대소문자 구분").check(); await count(3);
    await option("단어 단위").check(); await count(2);
    await option("정규식").check();
    await input.fill("Ne.dle"); await count(2);
    await input.press("Enter");
    assert.equal(await page.locator(".rendered-find [role=status]").innerText(), "2 / 2");
    await input.press("Shift+Enter");
    assert.equal(await page.locator(".rendered-find [role=status]").innerText(), "1 / 2");
    if (name === "분할 보기") {
      await page.getByRole("button", { name: "작성", exact: true }).click();
      assert.equal(await input.inputValue(), "Ne.dle");
      assert.ok(await option("정규식").isChecked());
      assert.equal(await page.locator(".rendered-find").count(), 0);
      await page.getByRole("button", { name: "미리보기", exact: true }).click();
      assert.equal(await input.inputValue(), "Ne.dle");
      await count(2);
      await input.fill("아래쪽 검색 결과");
      await count(1);
      await page.waitForFunction(() => {
        const range = [...(CSS.highlights.get("note-find-current") ?? [])][0];
        if (range?.toString() !== "아래쪽 검색 결과") return false;
        const rect = range.getBoundingClientRect();
        return !!document.elementFromPoint(rect.x + 2, rect.y + rect.height / 2)?.closest(".markdown-preview");
      });
      await page.locator(".cm-content").focus();
      await find();
      assert.equal(await page.locator(".rendered-find").count(), 0);
      assert.equal(await page.locator(".cm-search").count(), 1);
      await page.locator(".document-pane").evaluate(pane => { pane.scrollTop = 0; });
      await input.selectText();
      await input.pressSequentially("source-only-target");
      await input.press("Enter");
      await page.waitForFunction(() => {
        const match = document.querySelector(".cm-searchMatch-selected");
        if (match?.textContent !== "source-only-target") return false;
        const rect = match.getBoundingClientRect();
        return !!document.elementFromPoint(rect.x + 2, rect.y + rect.height / 2)?.closest(".cm-content");
      });
    }
    await input.press("Escape");
    assert.equal(await page.locator(".cm-search").count(), 0);
  }
  await mode("마인드맵 보기");
  await mode("접기·펼치기");
  await page.waitForFunction(() => document.querySelectorAll(".mindmap-node").length === 1);
  await find();
  await input.fill("Needle"); await count(3);
  await showOptions();
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
  await page.keyboard.press("Control+Shift+f");
  const body = page.getByRole("textbox",{name:"본문 검색",exact:true});
  assert.equal(await body.evaluate(el=>el===document.activeElement),true);
  const panel = page.locator(".workspace-find");
  await body.fill("item-(\\d+)");
  await panel.getByRole("button",{name:"정규식"}).click();
  const status = text=>panel.getByText(text,{exact:true}).waitFor();
  await status("2개 문서 · 4개 일치");
  await panel.getByRole("button",{name:"대소문자 구분"}).click();
  await status("2개 문서 · 3개 일치");
  await panel.getByText("파일 범위",{exact:true}).click();
  await panel.getByLabel("포함",{exact:true}).fill("Records/**");
  await status("1개 문서 · 2개 일치");
  await panel.locator(".find-hit button").nth(1).click();
  await page.waitForFunction(()=>window.getSelection()?.toString()==="item-22");
  await page.keyboard.press("Control+Shift+f");
  assert.equal(await body.inputValue(),"item-(\\d+)");
  await panel.getByRole("button",{name:"바꾸기 펼치기"}).click();
  await panel.getByLabel("바꿀 내용").fill("값-$1");
  await panel.getByRole("button",{name:"Records/First.md 2행 바꾸기"}).first().click();
  await status("1개 문서 · 1개 일치");
  await panel.getByLabel("포함",{exact:true}).fill("");
  await status("2개 문서 · 2개 일치");
  await panel.getByRole("button",{name:"모두 바꾸기"}).click();
  await panel.getByRole("button",{name:"취소",exact:true}).click();
  await status("2개 문서 · 2개 일치");
  await panel.getByRole("button",{name:"모두 바꾸기"}).click();
  await panel.getByRole("button",{name:"적용",exact:true}).click();
  await status("0개 문서 · 0개 일치");
  await status("바꾸기가 완료되었습니다.");
  assert.equal(await readFile(join(vault,"Records","First.md"),"utf8"),"시작\r\n값-11 과 값-22\r\n");
  assert.equal(await readFile(join(vault,"Second.md"),"utf8"),"값-33\nITEM-44\n");
  assert.equal(await readFile(join(vault,"Home.md"),"utf8"),content);
  console.log("Verified all Markdown find views and workspace search, source navigation, filtered replacement and saved contents.");
} finally {
  if (app) await app.close();
  await rm(fixture, { recursive: true, force: true });
}
