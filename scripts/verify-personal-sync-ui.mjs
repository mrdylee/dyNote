import { appendFile, mkdtemp, mkdir, writeFile, realpath, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import { verifyGitHubLogin } from "./verify-github-login-ui.mjs";
const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const executablePath = process.env.DYNOTE_EXECUTABLE || createRequire(import.meta.url)("electron");
const temp = await realpath(await mkdtemp(path.join(tmpdir(), "dynote-ui-sync-")));
const bare = path.join(temp, "shared.git"),
  apps = [],
  remote = "https://dynote.invalid/test.git";
execFileSync("git", ["init", "--bare", "--initial-branch=main", bare], { stdio: "ignore" });
const cfg = path.join(temp, "gitconfig");
execFileSync("git", ["config", "--file", cfg, "url." + bare.replaceAll("\\", "/") + ".insteadOf", remote]);
const cmd = process.platform === "darwin" ? "Meta" : "Control";
async function launch(name, seed) {
  const root = path.join(temp, name),
    profile = path.join(temp, name + "-profile");
  const team = path.join(temp, name + "-team");
  await mkdir(root);
  await mkdir(profile);
  if (seed) {
    await mkdir(team);
    await writeFile(path.join(team, "팀 문서.md"), "팀 내용\n");
  }
  if (seed) await writeFile(path.join(root, "회의록.md"), "회의 1시\n");
  else execFileSync("git", ["clone", remote, root], {
    env: { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: "1" }, stdio: "ignore"
  });
  await writeFile(
    path.join(profile, "settings.json"),
    JSON.stringify({ vaultRoot: root, vaults: seed ? [root, team] : [root], vaultPurposes: { [root]: "personal", ...(seed && { [team]: "team" }) } })
  );
  const app = await electron.launch({
    executablePath,
    args: [...(process.platform === "darwin" ? ["--use-mock-keychain"] : []), ...(process.env.DYNOTE_PACKAGED === "1" ? [] : ["."])],
    env: { ...process.env, OPEN_NOTES_DATA: profile, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: "1" },
    timeout: 30000,
  });
  apps.push(app);
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.waitForFunction(() => typeof window.notes?.connectGit === "function");
  const tree = page.getByRole("region", { name: "개인 노트 · " + name, exact: true });
  if (seed) {
    const teamTree = page.getByRole("region", { name: "팀 공유 노트 · " + name + "-team", exact: true });
    await teamTree.getByRole("heading").click({ button: "right" });
    const menu = page.getByRole("menu", { name: "문서·폴더 작업" });
    await menu.waitFor();
    assert.equal(await menu.getByRole("menuitem", { name: "지금 동기화", exact:true }).count(), 1, "team vault has its own quick sync");
    await menu.getByRole("menuitem", { name: "지금 동기화", exact:true }).click();
    const setup = page.getByRole("form", { name: "팀 저장소 연결" });
    await setup.waitFor();
    await setup.getByText(new RegExp("선택한 팀 노트 · " + name + "-team")).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state:"hidden" });
    await teamTree.getByRole("status").getByRole("button").click();
    await setup.waitFor({ timeout: 3000 });
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state:"hidden" });
    await tree.getByRole("heading").click({ button: "right" });
    await menu.getByRole("menuitem", { name: /동기화 설정/ }).click({ timeout: 3000 });
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "개인 노트 동기화" }).waitFor();
    await dialog.getByLabel("Git 사용 방식").selectOption("github-api");
    await dialog.getByRole("button", {name:"GitHub 로그인", exact:true}).waitFor({timeout:3500});
    assert(!await dialog.getByLabel("GitHub 토큰").isVisible());
    assert(!await dialog.getByLabel("브랜치", {exact:true}).isVisible());
    await dialog.getByText("주소와 토큰으로 직접 연결", {exact:true}).click();
    const connect = dialog.getByRole("button", { name: "연결하고 동기화" });
    assert(await connect.isDisabled());
    await dialog.getByLabel("GitHub 저장소 주소").fill(remote);
    const token = dialog.getByLabel("GitHub 토큰");
    assert.equal(await token.getAttribute("type"), "password");
    await token.fill("synthetic-test-token");
    await connect.click();
    await dialog.getByRole("alert").filter({ hasText: "GitHub.com 저장소" }).waitFor();
    await dialog.getByText("주소와 토큰으로 직접 연결", {exact:true}).click();
    await verifyGitHubLogin(app, dialog, root, profile);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  }
  const invoke = async (method, args = {}) =>
    page.evaluate(
      async ({ method, args }) => {
        const { value: scope } = await window.notes.snapshot({});
        const result = await window.notes[method]({ vaultId: scope.id, workspace: true, ...args });
        if (!result.ok) throw new Error(result.error);
        return result.value;
      },
      { method, args }
    );
  let status = await invoke("connectGit", {
    config: {
      remote,
      branch: "main",
      mode: "personal-sync",
      deviceName: name,
      authorName: "Synthetic Writer",
      authorEmail: "test@example.invalid",
      zipPaths: [],
    },
  });
  if (status.phase === "pending") status = await invoke("syncGit");
  assert.equal(status.phase, "synced", status.message);
  return { page, root, tree, invoke, sync: () => invoke("syncGit") };
}
async function syncFromPanel(pc, target = pc.tree.getByRole("heading")) {
  await target.click({ button: "right" });
  await pc.page.getByRole("menuitem", { name: "지금 동기화", exact: true }).click();
  try { await pc.tree.getByRole("status").filter({ hasText: "동기화됨" }).waitFor(); }
  catch (cause) {
    const status = await pc.invoke("gitStatus");
    throw new Error("Panel sync did not finish: " + JSON.stringify({ phase: status.phase, message: status.message,
      panel: await pc.tree.getByRole("status").allTextContents(), diagnostics: status.diagnostics }), { cause });
  }
}
async function editor(pc) {
  await pc.page.keyboard.press(cmd + "+k");
  await pc.page.getByRole("textbox", { name: "빠른 문서 검색" }).fill("path:회의록.md");
  await pc.page.keyboard.press("Enter");
  await pc.page.locator(".breadcrumbs").filter({ hasText: "회의록" }).waitFor();
  await pc.page.getByRole("button", { name: "편집 보기", exact: true }).click();
  return pc.page.getByRole("textbox", { name: "Markdown 편집기" });
}
async function verifySavingLocation(pc) {
  const [sample] = await Promise.all([
    pc.page.waitForFunction(() => {
      const message = "변경사항 저장 중…";
      const footer = [...document.querySelectorAll(".statusbar button")].filter(button => button.textContent.split(" · ").at(-1) === message);
      if (footer.length) return { count: footer.length, inTree: document.querySelector(".space-trees").textContent.includes(message) };
    }),
    pc.sync(),
  ]);
  assert.deepEqual(await sample.jsonValue(), { count: 1, inTree: false });
  await pc.page.locator(".statusbar button").filter({ hasText: "변경사항 저장 중…" }).waitFor({ state: "hidden" });
}
async function verifyJournalConflict(a, b) {
  const today = pc => pc.page.locator(".journal-feed article").first();
  const editor = pc => today(pc).locator(".cm-content");
  for (const pc of [a, b]) {
    await pc.page.getByRole("button", { name: "저널", exact: true }).click();
    await editor(pc).waitFor();
  }
  const journal = await today(a).getAttribute("data-document-path");
  assert.equal(await today(b).getAttribute("data-document-path"), journal);
  async function edit(pc, text) {
    await editor(pc).click();
    await editor(pc).press(cmd + "+a");
    await editor(pc).press("Backspace");
    await pc.page.keyboard.insertText(text);
    const file = path.join(pc.root, journal);
    const deadline = Date.now() + 10000;
    while (await readFile(file, "utf8") !== text && Date.now() < deadline) await delay(50);
    assert.equal(await readFile(file, "utf8"), text);
  }
  async function sync(pc) {
    let status = await pc.sync();
    const deadline = Date.now() + 10000;
    while (status.phase === "pending" && Date.now() < deadline) {
      await delay(100);
      status = await pc.sync();
    }
    assert.equal(status.phase, "synced", status.message);
  }
  // Establish an unresolved conflict whose published text is 0.
  await edit(a, "기준");
  await sync(a);
  await sync(b);
  await editor(b).filter({ hasText: "기준" }).waitFor();
  await edit(a, "0");
  await edit(b, "이전 편집");
  await sync(a);
  await sync(b);
  await sync(a);
  for (const pc of [a, b]) {
    await today(pc).getByRole("button", { name: "버전 확인 · 2개" }).waitFor();
    assert.equal(await editor(pc).innerText(), "0");
  }
  await edit(a, "a");
  await edit(b, "b");
  await sync(b);
  await sync(a);
  await sync(b);
  for (const pc of [a, b]) {
    await today(pc).getByRole("button", { name: "버전 확인 · 4개" }).waitFor();
    assert.equal(await editor(pc).innerText(), "0");
    assert.equal(await readFile(path.join(pc.root, journal), "utf8"), "0");
  }
  await today(b).getByRole("button", { name: "버전 확인 · 4개" }).click();
  const review = b.page.getByRole("dialog", { name: "버전 확인" });
  await review.getByRole("radio", { name: /^b · Local/ }).waitFor();
  await review.getByRole("radio", { name: /^a · Cloud/ }).check();
  await review.getByRole("button", { name: "a로 적용" }).click();
  await review.waitFor({ state: "hidden" });
  await sync(a);
  for (const pc of [a, b]) {
    await today(pc).getByRole("button", { name: /버전 확인/ }).waitFor({ state: "hidden" });
    assert.equal(await readFile(path.join(pc.root, journal), "utf8"), "a");
  }
}
try {
  const a = await launch("Cloud", true),
    b = await launch("Local", false);
  await writeFile(path.join(a.root, "보내기.md"), "Cloud에서 보냄\n");
  await writeFile(path.join(b.root, "받기.md"), "Local에서 보냄\n");
  const syncButton = b.page.locator(".toolbar-actions").getByRole("button", { name: "지금 동기화", exact: true });
  assert.equal(await syncButton.evaluate(button => button.nextElementSibling?.getAttribute("aria-label")), "오른쪽 패널 표시/숨기기");
  await syncButton.click();
  await b.tree.getByRole("status").filter({ hasText: "동기화됨" }).waitFor();
  await a.tree.getByTitle("회의록.md", { exact: true }).click();
  await a.page.getByTitle("팀 문서.md", { exact: true }).click();
  const personalTab = a.page.locator(".tab-label").filter({ hasText: "회의록" });
  await personalTab.click({ button: "right" });
  await a.page.getByRole("menu", { name: "문서 탭 작업" }).getByRole("menuitem", { name: "지금 동기화" }).click();
  await a.tree.getByRole("status").filter({ hasText: "동기화됨" }).waitFor();
  assert.match(await a.page.locator(".tab.active").innerText(), /팀 문서/);
  assert.equal(await readFile(path.join(a.root, "받기.md"), "utf8"), "Local에서 보냄\n");
  assert.equal(execFileSync("git", ["--git-dir", bare, "show", "main:보내기.md"], { encoding: "utf8" }), "Cloud에서 보냄\n");
  await syncFromPanel(a);
  await syncFromPanel(b, b.tree.getByTitle("회의록.md", { exact: true }));
  await verifySavingLocation(a);
  await verifySavingLocation(b);
  assert.equal(await readFile(path.join(b.root, "보내기.md"), "utf8"), "Cloud에서 보냄\n");
  const view = await editor(b);
  await a.invoke("saveNote", {
    path: "회의록.md",
    content: "회의 2시\n",
    revision: (await a.invoke("snapshot")).notes.find((n) => n.path === "회의록.md").revision,
  });
  await a.sync();
  await b.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await b.page.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("회의 2시"));
  await view.click();
  await view.press(cmd + "+End");
  await b.page.keyboard.insertText("Local에서 이어 씀");
  await syncFromPanel(b);
  await b.page.waitForFunction(async () => {
    const { value: v } = await window.notes.snapshot({});
    return v.notes.some((n) => n.content.includes("Local에서 이어 씀"));
  });
  await a.sync();
  assert.match(await readFile(path.join(a.root, "회의록.md"), "utf8"), /Local에서 이어 씀/);
  await view.click();
  await view.press(cmd + "+End");
  await b.page.keyboard.insertText(" 창을 떠날 때 보냄");
  await b.page.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("창을 떠날 때 보냄"));
  await b.page.evaluate(() => window.dispatchEvent(new Event("blur")));
  const publishedNote = () => execFileSync("git", ["--git-dir", bare, "show", "main:회의록.md"], { encoding:"utf8" });
  const deadline = Date.now() + 10000;
  while (!publishedNote().includes("창을 떠날 때 보냄") && Date.now() < deadline) await delay(100);
  assert.match(publishedNote(), /창을 떠날 때 보냄/);
  const third = await launch("Laptop", false);
  await a.sync();
  await b.sync();
  await Promise.all([
    writeFile(path.join(a.root, "회의록.md"), "회의 2시\n"),
    writeFile(path.join(b.root, "회의록.md"), "회의 3시\n"),
  ]);
  await a.sync();
  await b.sync();
  await a.sync();
  await apps[1].evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
  await b.page.getByRole("button", { name: /버전 확인 · 2개/ }).click();
  const dialog = b.page.getByRole("dialog", { name: "버전 확인" });
  const selection = dialog.getByRole("radio", { name: /회의 3시.*Local/ }).first();
  await selection.check();
  await writeFile(path.join(third.root, "회의록.md"), "회의 4시\n");
  await third.sync();
  await b.sync();
  await dialog.getByText("검토할 버전 3개").waitFor();
  assert(await selection.isChecked());
  await dialog.getByRole("button", { name: /3시.*적용/ }).click();
  await dialog.waitFor({ state: "hidden" });
  await a.sync();
  assert.equal(await readFile(path.join(a.root, "회의록.md"), "utf8"), "회의 3시\n");
  await verifyJournalConflict(a, b);
  const stored = path.join(a.root, "File Storage");
  await mkdir(stored, { recursive: true });
  await appendFile(path.join(a.root, ".git", "info", "exclude"), "\n/File Storage/local-only.txt\n");
  await writeFile(path.join(stored, "local-only.txt"), "private sample");
  const before = (await a.invoke("gitStatus")).lastSuccess;
  const excluded = await a.sync();
  assert.equal(excluded.lastSuccess, before);
  await a.tree.getByRole("status").getByRole("button").click();
  const settings = a.page.getByRole("dialog", { name: "설정" });
  await settings.locator("summary").filter({ hasText: "이 PC에만 있는 항목" }).click();
  await settings.getByText(/File Storage\/local-only\.txt/).waitFor();
  await settings.getByText(/마지막 원격 확인/).waitFor();
  await settings.getByText(/마지막 업로드/).waitFor();
  execFileSync("git", ["--git-dir", bare, "config", "receive.hideRefs", "refs/heads/main"]);
  await writeFile(path.join(a.root, "쓰기 권한.md"), "보존할 편집\n");
  await settings.getByRole("button", { name: "지금 동기화", exact: true }).click();
  await settings.getByRole("button", { name: "진단 복사", exact: true }).waitFor();
  const failure = await a.invoke("gitStatus");
  assert.equal(failure.phase, "error");
  await apps[0].evaluate(({ clipboard }) => { clipboard.writeText = text => { globalThis.testSyncClipboard = text; }; });
  await settings.getByRole("button", { name: "진단 복사", exact: true }).click();
  await settings.getByRole("button", { name: "진단 복사됨", exact: true }).waitFor();
  const copied = await apps[0].evaluate(() => globalThis.testSyncClipboard);
  assert.equal(copied, failure.diagnostics);
  assert.ok(copied && !copied.includes(remote) && !copied.includes(a.root));
  execFileSync("git", ["--git-dir", bare, "config", "--unset", "receive.hideRefs"]);
  await settings.getByRole("button", { name: "지금 동기화", exact: true }).click();
  await settings.locator("p.settings-message.local-only").waitFor();
  await settings.getByRole("button", { name: /진단 복사/ }).waitFor({ state: "hidden" });
  assert.equal(execFileSync("git", ["--git-dir", bare, "show", "main:쓰기 권한.md"], { encoding: "utf8" }), "보존할 편집\n");
  console.log(
    "PASS three Electron profiles: personal panel setup, immediate two-way sync from background vault and file menu, editor flush, focus receive, conflict resolution"
  );
} finally {
  for (const app of apps.reverse()) await app.close().catch(() => app.process().kill());
  await rm(temp, { recursive: true, force: true, maxRetries: 3 });
}
