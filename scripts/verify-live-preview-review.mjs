const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const profile = await mkdtemp(`${tmpdir()}/dynote-review-profile-`);
const vaultRoot = await mkdtemp(`${tmpdir()}/dynote-review-vault-`);
await mkdir("output/playwright", { recursive: true });
const links = [
  ["Formatted", "[Formatted](Guide.md#Procedure)", "## **Procedure**"],
  ["wiki", "[[Guide#Procedure|wiki]]", "## **Procedure**"],
  ["Code", "[Code](Guide.md#Code)", "## `Code`"],
  ["Linked", "[Linked](Guide.md#Visible)", "## [Visible](Other.md)"],
  ["Encoded", "[Encoded](Guide.md#%EC%A0%88%EC%B0%A8)", "## **절차**"],
  ["Slug", "[Slug](Guide.md#visible)", "## [Visible](Other.md)"],
  ["Legacy", "[Legacy](Guide.md#visibleothermd)", "## [Visible](Other.md)"],
];
await writeFile(`${vaultRoot}/Home.md`, "# Home\n\n" + links.map((l) => l[1]).join("\n\n") + "\n\nend");
await writeFile(`${vaultRoot}/Guide.md`, "---\ntags: [fixture]\n---\n\n# Guide\n\n" + [...new Set(links.map((l) => l[2]))].join("\n\nSection\n\n") + "\n");
const fixtures = [
  ["CRLF.md", "\r\n", ""],
  ["BOM-CRLF.md", "\r\n", "\uFEFF"],
  ["LF.md", "\n", ""],
].map(([name, eol, bom]) => ({ name, eol, content: bom + ["# Windows", "", "- [ ] task", "", "end", ""].join(eol) }));
for (const { name, content } of fixtures) await writeFile(`${vaultRoot}/${name}`, content);
await writeFile(`${profile}/settings.json`, JSON.stringify({ vaultRoot }));
const launch = () => electron.launch({ executablePath: process.env.DYNOTE_EXECUTABLE || `${process.cwd()}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`, args: process.env.DYNOTE_EXECUTABLE ? [] : ["."], env: { ...process.env, OPEN_NOTES_DATA: profile } });
const report = { checks: [], errors: [], remoteRequests: [], platform: process.platform };
let app = await launch(), page;
report.runtime = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, platform: process.platform, arch: process.arch, electron: process.versions.electron, version: app.getVersion() }));
const setup = async () => {
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") report.errors.push(m.text()); });
  page.on("request", (r) => { if (/^https?:/.test(r.url())) report.remoteRequests.push(r.url()); });
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1280, 900); w.setIgnoreMouseEvents(true); });
};
const file = (name) => page.locator(`.file-row[title="${name}"]`).click();
const mode = (name) => page.locator(".view-segments").getByRole("button", { name, exact: true }).click();
const cursorEnd = () => page.evaluate(() => {
  const v = document.querySelector(".cm-content").cmTile.root.view;
  v.dispatch({ selection: { anchor: v.state.doc.length } }); v.focus();
});
const saved = async (name) => {
  await page.locator(".save-status").filter({ hasText: "모든 변경사항 저장됨" }).waitFor();
  return readFile(`${vaultRoot}/${name}`, "utf8");
};
const check = (name, actual, expected) => report.checks.push({ name, passed: actual === expected, ...(actual === expected ? {} : { actual, expected }) });
try {
  await setup();
  for (const [label, , expected] of links) {
    await file("Home.md"); await mode("Live Preview"); await cursorEnd();
    await page.locator("[data-live-target]").filter({ hasText: new RegExp(`^${label}$`) }).click({ modifiers: ["Meta"] });
    await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("Section"));
    const actual = await page.evaluate(() => { const v = document.querySelector(".cm-content").cmTile.root.view; return v.state.doc.lineAt(v.state.selection.main.head).text; });
    check(`heading ${label}`, actual, expected);
  }
  for (const { name, eol, content } of fixtures) {
    await file(name); await mode("Live Preview"); await cursorEnd();
    await page.locator(".cm-live-checkbox").click();
    check(`${name}: checkbox saves exact bytes`, await saved(name), content.replace("[ ]", "[x]"));
    await page.locator(".cm-content").press("Meta+z");
    check(`${name}: undo saves exact bytes`, await saved(name), content);
    await cursorEnd(); await page.locator(".cm-content").press("Enter");
    await page.keyboard.insertText("새 줄");
    check(`${name}: new lines keep file convention`, await saved(name), content + eol + "새 줄");
    await mode("편집 보기"); await mode("Live Preview");
    const head = await page.evaluate(() => { const v = document.querySelector(".cm-content").cmTile.root.view; return v.state.selection.main.head; });
    check(`${name}: prop synchronization retains cursor`, head, content.replace(/\r\n/g, "\n").length + 4);
  }
  await app.close(); app = await launch(); await setup();
  for (const { name, eol, content } of fixtures) {
    await file(name); await mode("Live Preview"); await cursorEnd();
    await page.locator(".cm-live-checkbox").click();
    check(`${name}: reopen retains file convention`, await saved(name), content.replace("[ ]", "[x]") + eol + "새 줄");
  }
  await page.screenshot({ path: "output/playwright/live-preview-review.png" });
  await writeFile("output/playwright/live-preview-review.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.remoteRequests, []);
  assert.deepEqual(report.checks.filter((c) => !c.passed), []);
} finally { await app.close(); }
