const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import electronPath from "electron";

const profile = await mkdtemp(`${tmpdir()}/dynote-live-profile-`);
const vaultRoot = await mkdtemp(`${tmpdir()}/dynote-live-vault-`);
await mkdir(`${vaultRoot}/assets`);
await mkdir("output/playwright", { recursive: true });
const original = '# Live Preview\n\n**bold** and *italic* and ~~old~~ and `code`\n\n[[Guide|가이드]] · [절차](Guide.md#Procedure)\n\n- [ ] Test task\n- ordinary item\n\n![[assets/pixel.png]]\n\n![remote](https://example.invalid/pixel.png)\n\n```md\n**literal** [[not-a-link]]\n```\n\n한글 편집 끝\n';
await writeFile(`${vaultRoot}/Home.md`, original);
await writeFile(`${vaultRoot}/Guide.md`, "---\ntags: [fixture]\n---\n\n# Guide\n\n## Procedure\nTesting instructions\n");
const wrappedParagraph = "긴 문장 ".repeat(180) + "\n**내용 130** · 줄바꿈 뒤의 문장\n짧은 줄\n\n";
const references = Array.from({ length: 48 }, (_, i) => `[^ref${i}]`).join(" ");
const definitions = Array.from({ length: 48 }, (_, i) => `[^ref${i}]: **내용 ${200 + i}**`).join("\n\n");
const table = "| 항목 | 값 |\n| --- | --- |\n" + Array.from({ length: 30 }, (_, i) => `| **내용 ${300 + i}** | ${i} |`).join("\n");
const diagram = ["```mermaid", "graph TD", "A-->B", "B-->C", "C-->D", "```", "", "$$", "x^2", "$$"].join("\n");
const extra = new Map([[6, references], [30, definitions], [58, table], [69, "![[assets/pixel.png]]"], [70, diagram]]);
const longText = "---\ntags: [scroll]\n---\n\n" + Array.from({ length: 120 }, (_, i) => `${extra.has(i) ? extra.get(i) + "\n\n" : ""}${i === 75 ? wrappedParagraph : ""}### Section ${i}\n\n**내용 ${i}** · *한글* · [[Guide]]\n\n`).join("");
await writeFile(`${vaultRoot}/Long.md`, longText);
await writeFile(`${vaultRoot}/Other.md`, longText);
await writeFile(`${vaultRoot}/assets/pixel.png`, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAPAAAABICAYAAADIzHiKAAAA/ElEQVR4nO3TOQ2AQAAAwVOMCDQhhxoH1ODhEp5Npph+mx3Hfl5A0/g6AJhnYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwqYGXpcNeICBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGGvDAz8g4EhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAi7AdxvIjaEtAftAAAAAElFTkSuQmCC", "base64"));
await writeFile(`${profile}/settings.json`, JSON.stringify({ vaultRoot }));
const launch = () => electron.launch({ executablePath: process.env.DYNOTE_EXECUTABLE || electronPath, args: process.env.DYNOTE_EXECUTABLE ? [] : ["."], env: { ...process.env, OPEN_NOTES_DATA: profile }, timeout: 30000 });
const errors = [], remoteRequests = [], report = { checks: [], vaultRoot, profile };
let app = await launch();
report.runtime = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, platform: process.platform, arch: process.arch, electron: process.versions.electron, version: app.getVersion() }));
let page;
// CodeMirror's current installed DOM bridge is used only by this harness to
// inspect state and place deterministic selections. User actions use real input.
const connectWindow = async () => {
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", (request) => { if (/^https?:/.test(request.url())) remoteRequests.push(request.url()); });
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]; win.setSize(1280, 900); win.setIgnoreMouseEvents(true);
  });
};
const setup = async () => {
  await connectWindow();
  await page.locator('.file-row[title="Home.md"]').click();
  await page.locator(".view-segments").getByRole("button", { name: "Live Preview", exact: true }).click();
  await page.locator(".cm-live-preview").waitFor();
  await page.evaluate(() => { window.liveView = document.querySelector(".cm-content").cmTile.root.view; });
};
const doc = () => page.evaluate(() => window.liveView.state.doc.toString());
const cursor = (position) => page.evaluate((position) => {
  const view = window.liveView;
  view.dispatch({ selection: { anchor: typeof position === "number" ? position : view.state.doc.length }, scrollIntoView: true });
  view.focus();
}, position);
const saved = async (expected) => {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await readFile(`${vaultRoot}/Home.md`, "utf8") === expected) return;
    await page.waitForTimeout(100);
  }
  assert.equal(await readFile(`${vaultRoot}/Home.md`, "utf8"), expected);
};
try {
  await setup();
  await cursor("end");
  await page.evaluate(() => window.liveView.dispatch({ selection: { anchor: 0, head: window.liveView.state.doc.length } }));
  const copied = await page.evaluate(() => {
    const data = new DataTransfer();
    document.querySelector(".cm-content").dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }));
    return data.getData("text/plain");
  });
  assert.equal(copied, original);
  await cursor("end");
  assert.equal(await doc(), original);
  assert.equal(await page.locator(".cm-live-strong").first().innerText(), "bold");
  assert.equal(await page.locator("[data-live-target='not-a-link']").count(), 0);
  await page.waitForFunction(() => document.querySelector(".cm-live-image")?.naturalWidth > 0);
  assert.equal(await page.locator(".cm-live-image").count(), 1);
  assert.equal(await page.locator(".markdown-preview").count(), 0);
  report.checks.push("inline formatting, code exclusion, resolved local image loaded, no duplicate reading pane");

  await cursor(original.indexOf("bold") + 1);
  assert.match(await page.locator(".cm-live-strong").first().innerText(), /\*\*bold\*\*/);
  assert.equal(await page.locator(".cm-live-emphasis").first().innerText(), "italic");
  await cursor("end");
  await page.keyboard.insertText("한글 추가");
  const edited = await doc();
  assert.equal(edited, original + "한글 추가");
  const before = await page.evaluate(() => ({ anchor: window.liveView.state.selection.main.anchor, scroll: window.liveView.scrollDOM.scrollTop }));
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "편집 보기", exact: true }).click();
    await page.locator(".view-segments").getByRole("button", { name: "Live Preview", exact: true }).click();
  }
  assert.equal(await page.evaluate(() => document.querySelector(".cm-content").cmTile.root.view === window.liveView), true);
  assert.equal(await page.evaluate(() => window.liveView.state.selection.main.anchor), before.anchor);
  assert.equal(await doc(), edited);
  await page.locator(".cm-content").press("Meta+z");
  assert.equal(await doc(), original);
  await page.locator(".cm-content").press("Meta+Shift+z");
  assert.equal(await doc(), edited);
  await page.locator(".cm-content").press("Meta+z");
  assert.equal(await doc(), original);
  report.checks.push("selective syntax reveal; Korean text insertion; same editor, selection and undo across 3 source/live switches");

  await cursor("end");
  await page.getByRole("checkbox", { name: "할 일 완료", exact: true }).click();
  assert.equal(await doc(), original.replace("[ ]", "[x]"));
  await saved(original.replace("[ ]", "[x]"));
  await page.locator(".cm-content").press("Meta+z");
  assert.equal(await doc(), original);
  await saved(original);
  report.checks.push("checkbox transaction, autosave and undo preserve all other bytes");

  await page.locator(".cm-live-image").click();
  assert.equal(await page.locator(".cm-live-image").count(), 0);
  assert.equal(await doc(), original);
  await cursor("end");
  await page.locator('[data-live-target="Guide"]').click({ modifiers: ["Meta"] });
  await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("Testing instructions"));
  await page.locator('.file-row[title="Home.md"]').click();
  await page.evaluate(() => { window.liveView = document.querySelector(".cm-content").cmTile.root.view; });
  await cursor("end");
  await page.locator('[data-live-target="Guide.md#Procedure"]').click({ modifiers: ["Meta"] });
  await page.waitForFunction(() => {
    const v = document.querySelector(".cm-content")?.cmTile.root.view;
    return v?.state.doc.lineAt(v.state.selection.main.head).text === "## Procedure";
  });
  report.checks.push("image click reveals source; wiki navigation; Markdown heading link honors frontmatter offsets");

  await page.locator('.file-row[title="Home.md"]').click();
  await page.evaluate(() => { window.liveView = document.querySelector(".cm-content").cmTile.root.view; });
  await cursor(original.indexOf("[[Guide") + 3);
  await page.locator(".cm-content").press("Meta+Enter");
  await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("Testing instructions"));
  await page.locator('.file-row[title="Home.md"]').click();
  await page.evaluate(() => { window.liveView = document.querySelector(".cm-content").cmTile.root.view; });
  await cursor("end");
  await page.locator(".cm-content").press("Enter");
  await page.keyboard.insertText("[[Gu");
  await page.locator(".cm-content").press("Control+Space");
  await page.locator(".cm-tooltip-autocomplete").getByText("Guide", { exact: true }).first().waitFor();
  // CodeMirror intentionally ignores acceptance keys during its 75 ms opening delay.
  await page.waitForTimeout(100);
  await page.locator(".cm-content").press("Enter");
  assert.equal(await doc(), original + "\n[[Guide]]");
  await page.evaluate((length) => window.liveView.dispatch({ selection: { anchor: length, head: window.liveView.state.doc.length } }), original.length);
  await page.locator(".cm-content").press("Backspace");
  assert.equal(await doc(), original);
  report.checks.push("Cmd-Enter wiki link navigation and existing wiki autocomplete in Live Preview");
  await cursor("end");
  await page.evaluate(() => {
    const target = document.querySelector(".cm-content");
    target.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
  });
  await page.keyboard.insertText("조합 확인");
  await page.evaluate(() => document.querySelector(".cm-content").dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "조합 확인" })));
  await page.waitForTimeout(100);
  assert.equal(await doc(), original + "조합 확인");
  await page.locator(".cm-content").press("Meta+z");
  assert.equal(await doc(), original);
  report.checks.push("synthetic composition lifecycle preserves Korean input and undo (not native IME proof)");

  await page.evaluate((base64) => {
    const buffer = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const data = new DataTransfer(); data.items.add(new File([buffer], "pasted.png", { type: "image/png" }));
    document.querySelector(".cm-content").dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, (await readFile(`${vaultRoot}/assets/pixel.png`)).toString("base64"));
  await page.waitForFunction(() => window.liveView.state.doc.toString().includes("pasted.png"));
  const finalContent = await doc();
  await cursor("end");
  await page.waitForFunction(() => document.querySelectorAll(".cm-live-image").length === 2);
  await saved(finalContent);
  // A file dropped from disk opens a separate preview. Clipboard images embed in the note.
  const dropInput = await page.evaluateHandle(() => {
    const input = document.createElement("input");
    input.type = "file"; document.body.append(input);
    return input;
  });
  await dropInput.setInputFiles(`${vaultRoot}/assets/pixel.png`);
  await dropInput.evaluate(input => {
    const data = new DataTransfer(); data.items.add(input.files[0]);
    document.querySelector(".cm-content").dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
    input.remove();
  });
  await page.waitForFunction(() => document.querySelector(".external-file-image")?.naturalWidth === 240);
  await page.getByRole("button", { name: "pixel.png 탭 닫기", exact: true }).click();
  await page.locator('.file-row[title="Home.md"]').click();
  await page.evaluate(() => { window.liveView = document.querySelector(".cm-content").cmTile.root.view; });
  assert.equal(await doc(), finalContent);
  await cursor(0);
  await cursor(original.indexOf("한글 편집 끝"));
  await page.evaluate(() => { document.querySelector(".document-pane.focused").scrollTop = 0; });
  await page.screenshot({ path: "output/playwright/live-preview.png" });
  assert.equal(remoteRequests.length, 0, remoteRequests.join("\n"));
  assert.equal(errors.length, 0, errors.join("\n"));
  await app.close();
  app = await launch();
  await setup();
  assert.equal(await doc(), finalContent);
  await cursor("end");
  await page.waitForFunction(() => [...document.querySelectorAll(".cm-live-image")].filter((image) => image.naturalWidth > 0).length === 2);
  report.checks.push("raw Markdown copy; undo/redo; clipboard image embed and separate disk image preview; exact disk save and app reopen; no remote image requests");
  await page.locator('.file-row[title="Long.md"]').click();
  await page.waitForTimeout(150);
  await page.evaluate(() => { document.querySelector(".document-pane.focused").scrollTop = 1600; });
  await page.waitForTimeout(100);
  const scrollAnchor = await page.evaluate(() => {
    const area = document.querySelector(".document-pane.focused");
    const view = document.querySelector(".cm-content").cmTile.root.view;
    window.liveView = view;
    return view.posAtCoords({ x: view.contentDOM.getBoundingClientRect().left + 24, y: area.getBoundingClientRect().top + 24 }, false);
  });
  assert.ok(scrollAnchor > 0);
  for (const mode of ["편집 보기", "Live Preview"]) {
    await page.locator(".view-segments").getByRole("button", { name: mode, exact: true }).click();
    await page.waitForTimeout(100);
    const offset = await page.evaluate((anchor) => window.liveView.coordsAtPos(anchor).top - document.querySelector(".document-pane.focused").getBoundingClientRect().top, scrollAnchor);
    assert.ok(Math.abs(offset - 24) < 60, `scroll anchor offset ${offset} after ${mode}`);
  }
  report.checks.push("long document source/live switching preserves the visible text anchor");
  let first = page.getByRole("region", { name: "문서 Long.md", exact: true });
  let other = page.getByRole("region", { name: "문서 Other.md", exact: true });
  const box = await first.boundingBox();
  await page.locator('.file-row[title="Other.md"]').dragTo(first, { targetPosition: { x: box.width - 10, y: 28 } });
  await other.waitFor();
  // Use visible paragraph text as the oracle, independent of the app's source mapping.
  const paragraphOffset = (pane, section, align = false, preview = false) => pane.evaluate((el, {section, align, preview}) => {
    const text = `내용 ${section}`;
    const scroller = el.querySelector(preview ? ".split .preview-column" : ".split .cm-scroller") ?? el;
    const y = scroller === el ? el.querySelector(".pane-header").getBoundingClientRect().bottom : scroller.getBoundingClientRect().top;
    const cm = el.querySelector(".cm-content");
    let top;
    if (cm && !preview) {
      const view = cm.cmTile.root.view, pos = view.state.doc.toString().indexOf(`**${text}**`);
      top = view.coordsAtPos(pos)?.top ?? view.documentTop + view.lineBlockAt(pos).top;
    } else {
      const marker = [...el.querySelectorAll(".markdown-preview strong")].find(node => node.textContent === text);
      top = marker.getBoundingClientRect().top;
    }
    if (align) scroller.scrollTop += top - y + 3;
    return top - y;
  }, {section, align, preview});
  const place = async (pane, section, side) => {
    const preview = side === "preview";
    const split = await pane.locator(".document-content.split").count();
    await (side ? pane.locator(split ? (preview ? ".preview-column" : ".cm-scroller") :
      (preview ? ".markdown-preview" : ".cm-content")) : pane).hover();
    await page.mouse.wheel(0, 80);
    await page.waitForTimeout(100);
    for (let i = 0; i < 5; i++) {
      await paragraphOffset(pane, section, true, preview);
      await page.waitForTimeout(100);
      if (Math.abs(await paragraphOffset(pane, section, false, preview) + 3) < 10) return;
    }
    assert.fail(`could not position the test at paragraph ${section}`);
  };
  const switchMode = name => page.locator(".view-segments").getByRole("button", { name, exact: true }).click();
  await place(first, 18);
  await place(other, 64);
  const scrollPosition = pane => pane.evaluate(el => {
    const view = el.querySelector(".split .cm-content")?.cmTile.root.view;
    if (!view) return String(el.scrollTop);
    // CodeMirror refines scrollHeight as offscreen lines are measured. Compare
    // the actual visible character and its offset, not its estimated scrollTop.
    const top = view.scrollDOM.getBoundingClientRect().top + 1;
    const pos = view.posAtCoords({ x: view.contentDOM.getBoundingClientRect().left + 24, y: top }, false);
    return JSON.stringify([pos, Math.round(view.coordsAtPos(pos).top - top), el.querySelector(".preview-column").scrollTop]);
  });
  const firstScroll = await scrollPosition(first);
  for (const mode of ["읽기 보기", "분할 보기", "편집 보기", "Live Preview", "읽기 보기"]) {
    await switchMode(mode);
    await page.waitForTimeout(160);
    const offset = await paragraphOffset(other, 64);
    assert.ok(Math.abs(offset + 3) < 32, `second pane paragraph offset ${offset} in ${mode}`);
    assert.equal(await scrollPosition(first), firstScroll);
  }
  await place(other, 91);
  await switchMode("Live Preview");
  await page.waitForTimeout(160);
  const movedOffset = await paragraphOffset(other, 91);
  assert.ok(Math.abs(movedOffset + 3) < 32, `read-to-live paragraph offset ${movedOffset}`);
  const otherScroll = await scrollPosition(other);
  await first.locator(".pane-title").click();
  await switchMode("읽기 보기");
  await page.waitForTimeout(160);
  assert.ok(Math.abs(await paragraphOffset(first, 18) + 3) < 32, "first pane keeps its own paragraph");
  assert.equal(await scrollPosition(other), otherScroll);
  const beforeWheel = await first.evaluate(el => el.scrollTop);
  await first.hover();
  await page.mouse.wheel(0, 500);
  await page.waitForFunction(previous => document.querySelector('.document-pane.focused').scrollTop > previous + 100, beforeWheel);
  await place(first, 130);
  await switchMode("편집 보기");
  await page.waitForTimeout(250);
  const wrappedOffset = await paragraphOffset(first, 130);
  assert.ok(Math.abs(wrappedOffset + 3) < 32, `paragraph after a long wrapped line moved to ${wrappedOffset}`);
  assert.equal(await scrollPosition(other), otherScroll);
  await switchMode("분할 보기");
  await place(first, 45, "preview");
  const alignedEditor = await paragraphOffset(first, 45);
  assert.ok(Math.abs(alignedEditor) < 32, `preview scrolling aligns the same editor paragraph: ${alignedEditor} px; ${await scrollPosition(first)}`);
  const stateBeforeWheel = () => first.evaluate(el => {
    const editor = el.querySelector(".cm-content").cmTile.root.view;
    return { selection: editor.state.selection.toJSON(), focus: document.activeElement.className };
  });
  await first.locator(".cm-content").evaluate(el => {
    const view = el.cmTile.root.view;
    const from = view.state.doc.toString().indexOf("내용 45");
    view.dispatch({ selection: { anchor: from, head: from + 4 } });
    view.focus();
  });
  const beforeSync = await stateBeforeWheel();
  for (const section of [205, 314]) {
    await place(first, section, "editor");
    assert.ok(Math.abs(await paragraphOffset(first, section, false, true)) < 32, `source aligns rendered marker ${section}`);
    await place(first, section + 1, "preview");
    assert.ok(Math.abs(await paragraphOffset(first, section + 1)) < 32, `rendered marker ${section + 1} aligns source`);
  }
  const article = first.locator(".markdown-preview");
  await article.evaluate(el => {
    el.dataset.indexScans = "0";
    el.querySelectorAll = function(selector) {
      if (selector === "[data-source-lines]") this.dataset.indexScans = String(Number(this.dataset.indexScans) + 1);
      return Element.prototype.querySelectorAll.call(this, selector);
    };
  });
  for (const side of ["editor", "preview"]) {
    const column = first.locator(side === "editor" ? ".cm-scroller" : ".preview-column");
    await column.hover();
    const positions = () => first.evaluate(el => [el.querySelector(".cm-scroller").scrollTop, el.querySelector(".preview-column").scrollTop]);
    const before = await positions();
    await page.mouse.wheel(0, side === "editor" ? 420 : -220);
    await page.waitForFunction(({ before, side }) => {
      const el = document.querySelector('[data-document-path="Long.md"]');
      const direction = side === "editor" ? 1 : -1;
      return [el.querySelector(".cm-scroller"), el.querySelector(".preview-column")].every((box, i) =>
        (box.scrollTop - before[i]) * direction > 10);
    }, { before, side });
    await first.evaluate(async el => {
      const boxes = [el.querySelector(".cm-scroller"), el.querySelector(".preview-column")];
      let stable = 0, previous = boxes.map(box => box.scrollTop);
      for (let frame = 0; frame < 120; frame++) {
        await new Promise(requestAnimationFrame);
        const current = boxes.map(box => box.scrollTop);
        stable = current.every((top, i) => Math.abs(top - previous[i]) <= 1) ? stable + 1 : 0;
        if (stable === 5) return;
        previous = current;
      }
      throw new Error("split scrolling kept moving after wheel input stopped");
    });
  }
  const indexScans = await article.evaluate(el => {
    const count = Number(el.dataset.indexScans);
    delete el.querySelectorAll;
    delete el.dataset.indexScans;
    return count;
  });
  assert.equal(indexScans, 0, "scrolling a rendered note reuses the source-line index");
  await place(first, 72, "editor");
  await first.locator(".markdown-preview .mermaid-diagram svg").waitFor({ state: "attached" });
  await first.locator(".markdown-preview .katex-block[data-source-lines]").waitFor({ state: "attached" });
  for (const selector of [".mermaid-diagram", ".katex-block"]) {
    const block = first.locator(".markdown-preview " + selector);
    await first.locator(".preview-column").hover();
    const previousTop = await first.locator(".preview-column").evaluate(el => el.scrollTop);
    await page.mouse.wheel(0, -40);
    await page.waitForFunction(top => document.querySelector('[data-document-path="Long.md"] .preview-column').scrollTop < top, previousTop);
    const [start, end] = await block.evaluate(el => {
      const column = el.closest(".preview-column");
      const rect = el.getBoundingClientRect();
      column.scrollTop += rect.top + rect.height / 2 - column.getBoundingClientRect().top;
      return el.dataset.sourceLines.split(":").map(Number);
    });
    await page.waitForFunction(({ start, end }) => {
      const view = document.querySelector('[data-document-path="Long.md"] .cm-content').cmTile.root.view;
      const y = view.scrollDOM.getBoundingClientRect().top + 1;
      const pos = view.posAtCoords({ x: view.contentDOM.getBoundingClientRect().left + 24, y }, false);
      const line = view.state.doc.lineAt(pos).number - 1;
      return line >= start && line < end;
    }, { start, end }).catch(async error => {
      const offsets = await block.evaluate(el => {
        const column = el.closest(".preview-column");
        const view = column.closest(".split").querySelector(".cm-content").cmTile.root.view;
        const y = view.scrollDOM.getBoundingClientRect().top + 1;
        const pos = view.posAtCoords({ x: view.contentDOM.getBoundingClientRect().left + 24, y }, false);
        return { relativeTop: el.getBoundingClientRect().top - column.getBoundingClientRect().top, line: view.state.doc.lineAt(pos).number - 1 };
      });
      throw new Error(`${selector} expected lines ${start}..${end}, got ${JSON.stringify(offsets)}`, { cause: error });
    });
  }
  await place(first, 72, "editor");
  const image = first.locator(".markdown-preview img");
  await image.evaluate(img => { img.style.height = "480px"; });
  await page.waitForTimeout(120);
  assert.ok(Math.abs(await paragraphOffset(first, 72, false, true)) < 32, "image layout change preserves the source paragraph after the diagram");
  await image.evaluate(img => { img.style.removeProperty("height"); });
  await place(first, 45, "preview");
  assert.deepEqual(await stateBeforeWheel(), beforeSync, "wheel synchronization preserves selection and focus");
  report.checks.push("both directions align text, reordered footnotes and table rows; wheel input settles, preserves selection and focus, and reuses the line index");
  report.checks.push("Mermaid and math map to their source ranges, and resizing an image preserves the next paragraph");
  const firstSplitScroll = await scrollPosition(first);
  await other.locator(".pane-title").click();
  await switchMode("분할 보기");
  await place(other, 20, "preview");
  await place(other, 26, "editor");
  assert.ok(Math.abs(await paragraphOffset(other, 26, false, true)) < 32, "editor scrolling aligns the same preview paragraph");
  const otherSplitScroll = await scrollPosition(other);
  assert.equal(await scrollPosition(first), firstSplitScroll);

  await first.locator(".pane-title").click();
  for (const target of ["읽기 보기", "편집 보기", "Live Preview"]) {
    await switchMode(target);
    await page.waitForTimeout(250);
    const offset = await paragraphOffset(first, 45);
    assert.ok(Math.abs(offset + 3) < 32, `preview paragraph moved to ${offset} in ${target}`);
    assert.equal(await scrollPosition(other), otherSplitScroll);
    await switchMode("분할 보기");
    await page.waitForTimeout(250);
    const restored = await paragraphOffset(first, 45, false, true);
    assert.ok(Math.abs(restored + 3) < 32, `returning to split moved the preview paragraph to ${restored}`);
  }
  const restoredFirst = await scrollPosition(first);
  await other.locator(".pane-title").click();
  await switchMode("읽기 보기");
  await page.waitForTimeout(250);
  assert.ok(Math.abs(await paragraphOffset(other, 26) + 3) < 32, "using the editor again makes it the reading side");
  assert.equal(await scrollPosition(first), restoredFirst);
  report.checks.push("each split pane follows its last used side when leaving and returning, without scrolling its neighbour");
  const tab = name => page.locator(`.tab-label[title="${name}.md"]`);
  await switchMode("분할 보기");
  await place(other, 32, "editor");
  const parkedOther = await scrollPosition(other);
  await tab("Long").click();
  await place(first, 72, "preview");
  await tab("Home").click();
  await first.waitFor({ state: "detached" });
  await tab("Long").click();
  await first.locator(".document-content.split").waitFor();
  await page.waitForTimeout(250);
  const previewReturn = await paragraphOffset(first, 72, false, true);
  assert.ok(Math.abs(previewReturn + 3) < 32, `tab return moved the preview paragraph to ${previewReturn}`);
  assert.equal(await scrollPosition(other), parkedOther);
  await switchMode("읽기 보기");
  await page.waitForTimeout(250);
  assert.ok(Math.abs(await paragraphOffset(first, 72) + 3) < 32, "the returned tab still follows its preview");
  const parkedFirst = await scrollPosition(first);

  await tab("Other").click();
  await tab("Home").click();
  await other.waitFor({ state: "detached" });
  await tab("Other").click();
  await other.locator(".document-content.split").waitFor();
  await page.waitForTimeout(250);
  const editorReturn = await paragraphOffset(other, 32);
  assert.ok(Math.abs(editorReturn + 3) < 32, `tab return moved the editor paragraph to ${editorReturn}`);
  await switchMode("읽기 보기");
  await page.waitForTimeout(250);
  assert.ok(Math.abs(await paragraphOffset(other, 32) + 3) < 32, "the returned tab still follows its editor");
  assert.equal(await scrollPosition(first), parkedFirst);
  report.checks.push("tab round trips restore each split document's paragraph and reading side without moving its neighbour");
  await switchMode("분할 보기");
  await place(other, 32, "editor");
  await tab("Long").click();
  await switchMode("분할 보기");
  await place(first, 56, "preview");
  const beforeExternal = await paragraphOffset(other, 32);
  assert.ok(Math.abs(beforeExternal + 3) < 32, `editor paragraph before opening the external file: ${beforeExternal}`);
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, `${vaultRoot}/assets/pixel.png`);
  await page.getByRole("button", { name: "파일 열기", exact: true }).click();
  await page.locator(".external-file-image").waitFor();
  await first.waitFor({ state: "detached" });
  await other.waitFor({ state: "detached" });
  await tab("Long").click();
  await other.locator(".document-content.split").waitFor();
  await page.waitForTimeout(250);
  assert.ok(Math.abs(await paragraphOffset(first, 56, false, true) + 3) < 32, "the whole workspace restores the preview reader");
  const afterExternal = await paragraphOffset(other, 32);
  assert.ok(Math.abs(afterExternal + 3) < 32, `editor paragraph after restoring the workspace: ${afterExternal}`);
  await page.getByRole("button", { name: "Long.md 탭 닫기", exact: true }).click();
  await tab("Long").waitFor({ state: "detached" });
  await page.locator('.file-row[title="Long.md"]').click();
  const checkSplit = async (pane, section, side) => {
    await pane.locator(".document-content.split").waitFor();
    await page.waitForFunction(() => document.fonts.status === "loaded");
    await page.waitForTimeout(250);
    const offset = await paragraphOffset(pane, section, false, side === "preview");
    assert.ok(Math.abs(offset + 3) < 32, `restored ${side} paragraph ${section} at ${offset}`);
  };
  const addOther = async () => {
    const bounds = await first.boundingBox();
    await page.locator('.file-row[title="Other.md"]').dragTo(first, { targetPosition: { x: bounds.width - 10, y: 28 } });
  };
  await checkSplit(first, 56, "preview");
  await page.getByRole("button", { name: "Other.md 탭 닫기", exact: true }).click();
  await addOther();
  await checkSplit(other, 32, "editor");
  await checkSplit(first, 56, "preview");
  report.checks.push("closing and reopening each tab restores its split view and paragraph on the original side");

  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page.getByRole("button", { name: "시작 화면", exact: true }).click();
  await page.getByRole("combobox", { name: "시작 화면" }).selectOption("last");
  await page.getByRole("dialog").getByRole("button", { name: "닫기", exact: true }).click();
  const separator = page.getByRole("separator", { name: "문서 영역 너비" });
  await separator.press("ArrowLeft");
  const layout = () => page.locator(".document-pane").evaluateAll(panes => panes.map(pane => ({
    path: pane.dataset.documentPath, width: Math.round(pane.getBoundingClientRect().width),
    active: pane.classList.contains("focused"),
  })));
  const documentTabs = () => page.locator(".tab[data-tab-key]").evaluateAll(tabs => tabs
    .filter(tab => !tab.dataset.tabKey.startsWith("external:"))
    .map(tab => [tab.dataset.tabKey, tab.classList.contains("active")]));
  await place(other, 68, "editor");
  await tab("Long").click();
  await place(first, 85, "preview");
  await tab("Other").click();
  const expectedLayout = await layout();
  const expectedTabs = await documentTabs();
  assert.equal(expectedLayout.length, 2);
  assert.ok(expectedLayout[1].active);
  const relaunchPanels = async () => {
    await app.close();
    app = await launch();
    await connectWindow();
    first = page.getByRole("region", { name: "문서 Long.md", exact: true });
    other = page.getByRole("region", { name: "문서 Other.md", exact: true });
    await other.waitFor();
  };
  await relaunchPanels();
  await page.waitForFunction(expected => {
    const panes = [...document.querySelectorAll(".document-pane")];
    return panes.length === expected.length && panes.every((pane, i) => Math.round(pane.getBoundingClientRect().width) === expected[i].width);
  }, expectedLayout);
  assert.deepEqual(await layout(), expectedLayout, "restart restores pane order, sizes and the active pane without input");
  assert.deepEqual(await documentTabs(), expectedTabs, "restart restores open note tabs and the active tab");
  await checkSplit(first, 85, "preview");
  await checkSplit(other, 68, "editor");
  for (const [name, pane, section] of [["Other", other, 68], ["Long", first, 85]]) {
    await tab(name).click();
    await switchMode("읽기 보기");
    await page.waitForTimeout(250);
    assert.ok(Math.abs(await paragraphOffset(pane, section) + 3) < 32, `restored tab ${name} follows its reading side`);
  }
  await switchMode("편집 보기");
  await place(first, 42, "editor");
  await relaunchPanels();
  await first.locator(".document-content.edit").waitFor();
  await other.locator(".document-content.read").waitFor();
  await page.waitForTimeout(250);
  assert.ok(Math.abs(await paragraphOffset(first, 42) + 3) < 32, "the source pane resumes its latest paragraph");
  assert.ok(Math.abs(await paragraphOffset(other, 68) + 3) < 32, "the reading pane resumes its own paragraph");
  assert.deepEqual(errors, []);
  report.checks.push("relaunching with both panes open restores the latest preview and editor paragraphs and remembers both reading sides");
  assert.equal(await readFile(`${vaultRoot}/Long.md`, "utf8"), longText);
  assert.equal(await readFile(`${vaultRoot}/Other.md`, "utf8"), longText);
  report.checks.push("two independently scrolled panes retain their paragraphs across live, source, split and reading modes");
  report.errors = errors;
  report.remoteRequests = remoteRequests;
  report.platform = process.platform;
  await writeFile("output/playwright/live-preview-runtime.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page?.screenshot({ path: "output/playwright/live-preview-failure.png" }).catch(() => {});
  console.error(JSON.stringify({ errors, remoteRequests, text: await page?.locator(".workspace").innerText().catch(() => "unavailable") }));
  throw error;
} finally { await app.close(); }
