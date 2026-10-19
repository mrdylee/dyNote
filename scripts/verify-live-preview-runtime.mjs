const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const profile = await mkdtemp(`${tmpdir()}/dynote-live-profile-`);
const vaultRoot = await mkdtemp(`${tmpdir()}/dynote-live-vault-`);
await mkdir(`${vaultRoot}/assets`);
await mkdir("output/playwright", { recursive: true });
const original = '# Live Preview\n\n**bold** and *italic* and ~~old~~ and `code`\n\n[[Guide|가이드]] · [절차](Guide.md#Procedure)\n\n- [ ] Test task\n- ordinary item\n\n![[assets/pixel.png]]\n\n![remote](https://example.invalid/pixel.png)\n\n```md\n**literal** [[not-a-link]]\n```\n\n한글 편집 끝\n';
await writeFile(`${vaultRoot}/Home.md`, original);
await writeFile(`${vaultRoot}/Guide.md`, "---\ntags: [fixture]\n---\n\n# Guide\n\n## Procedure\nTesting instructions\n");
await writeFile(`${vaultRoot}/Long.md`, Array.from({ length: 120 }, (_, i) => `### Section ${i}\n\n**내용 ${i}** · *한글* · [[Guide]]\n\n`).join(""));
await writeFile(`${vaultRoot}/assets/pixel.png`, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAPAAAABICAYAAADIzHiKAAAA/ElEQVR4nO3TOQ2AQAAAwVOMCDQhhxoH1ODhEp5Npph+mx3Hfl5A0/g6AJhnYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwqYGXpcNeICBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGGvDAz8g4EhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAi7AdxvIjaEtAftAAAAAElFTkSuQmCC", "base64"));
await writeFile(`${profile}/settings.json`, JSON.stringify({ vaultRoot }));
const launch = () => electron.launch({ executablePath: `${process.cwd()}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`, args: ["."], env: { ...process.env, OPEN_NOTES_DATA: profile }, timeout: 30000 });
const errors = [], remoteRequests = [], report = { checks: [], vaultRoot, profile };
let app = await launch();
let page;
// CodeMirror's current installed DOM bridge is used only by this harness to
// inspect state and place deterministic selections. User actions use real input.
const setup = async () => {
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", (request) => { if (/^https?:/.test(request.url())) remoteRequests.push(request.url()); });
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]; win.setSize(1280, 900); win.setIgnoreMouseEvents(true);
  });
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
  const withPaste = await doc();
  await cursor("end");
  await page.waitForFunction(() => document.querySelectorAll(".cm-live-image").length === 2);
  await saved(withPaste);
  await page.evaluate((base64) => {
    const buffer = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const data = new DataTransfer(); data.items.add(new File([buffer], "dropped.png", { type: "image/png" }));
    document.querySelector(".cm-content").dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
  }, (await readFile(`${vaultRoot}/assets/pixel.png`)).toString("base64"));
  await page.waitForFunction(() => window.liveView.state.doc.toString().includes("dropped.png"));
  const finalContent = await doc();
  await saved(finalContent);
  await cursor(0);
  await cursor(original.indexOf("한글 편집 끝"));
  await page.evaluate(() => { document.querySelector(".document-area").scrollTop = 0; });
  await page.screenshot({ path: "output/playwright/live-preview.png" });
  assert.equal(remoteRequests.length, 0, remoteRequests.join("\n"));
  assert.equal(errors.length, 0, errors.join("\n"));
  await app.close();
  app = await launch();
  await setup();
  assert.equal(await doc(), finalContent);
  await cursor("end");
  await page.waitForFunction(() => [...document.querySelectorAll(".cm-live-image")].filter((image) => image.naturalWidth > 0).length === 3);
  report.checks.push("raw Markdown copy; undo/redo; clipboard and drop image import; exact disk save and app reopen; no remote image requests");
  await page.locator('.file-row[title="Long.md"]').click();
  await page.waitForTimeout(150);
  await page.evaluate(() => { document.querySelector(".document-area").scrollTop = 1600; });
  await page.waitForTimeout(100);
  const scrollAnchor = await page.evaluate(() => {
    const area = document.querySelector(".document-area");
    const view = document.querySelector(".cm-content").cmTile.root.view;
    window.liveView = view;
    return view.posAtCoords({ x: view.contentDOM.getBoundingClientRect().left + 24, y: area.getBoundingClientRect().top + 24 }, false);
  });
  assert.ok(scrollAnchor > 0);
  for (const mode of ["편집 보기", "Live Preview"]) {
    await page.locator(".view-segments").getByRole("button", { name: mode, exact: true }).click();
    await page.waitForTimeout(100);
    const offset = await page.evaluate((anchor) => window.liveView.coordsAtPos(anchor).top - document.querySelector(".document-area").getBoundingClientRect().top, scrollAnchor);
    assert.ok(Math.abs(offset - 24) < 60, `scroll anchor offset ${offset} after ${mode}`);
  }
  report.checks.push("long document source/live switching preserves the visible text anchor");
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
