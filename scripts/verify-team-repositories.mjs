import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { _electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const root = await realpath(await mkdtemp(path.join(tmpdir(), "dynote-team-repos-")));
const profile = path.join(root, "profile"), personal = path.join(root, "Personal"), config = path.join(root, "gitconfig");
const env = { ...process.env, OPEN_NOTES_DATA: profile, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" };
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const repositories = [
  { name: "JF3", remote: "https://team-repos.invalid/jf3.git", branch: "main" },
  { name: "A 모델", remote: "https://team-repos.invalid/a.git", branch: "notes" },
  { name: "B 모델", remote: "https://team-repos.invalid/b.git", branch: "main" },
].map(repository => ({ ...repository, folder: path.join(root, repository.name) }));
const launch = () => _electron.launch({
  executablePath: process.env.DYNOTE_EXECUTABLE || path.resolve("node_modules/electron/dist", process.platform === "darwin"
    ? "Electron.app/Contents/MacOS/Electron" : process.platform === "win32" ? "electron.exe" : "electron"),
  args: process.env.DYNOTE_EXECUTABLE ? [] : ["."],
  env,
});
let app;
try {
  await mkdir(profile); await mkdir(personal); await writeFile(config, "");
  await writeFile(path.join(personal, "개인.md"), "# 비공개 메모\n");
  await writeFile(path.join(profile, "settings.json"), JSON.stringify({
    vaultRoot: personal, vaults: [personal], vaultPurposes: { [personal]: "personal" },
  }));
  git(root, "config", "--global", "user.name", "Dynote test");
  git(root, "config", "--global", "user.email", "dynote@example.invalid");
  for (const [index, repository] of repositories.entries()) {
    const bare = path.join(root, `remote-${index}.git`), seed = path.join(root, `seed-${index}`);
    await mkdir(seed); await mkdir(repository.folder);
    git(root, "init", "--bare", "--initial-branch", repository.branch, bare);
    git(seed, "init", "--initial-branch", repository.branch);
    await writeFile(path.join(seed, "회의록.md"), `# ${repository.name} 회의록\n`);
    git(seed, "add", "회의록.md"); git(seed, "commit", "-m", "Fixture"); git(seed, "push", bare, repository.branch);
    git(root, "config", "--global", `url.${pathToFileURL(bare).href}.insteadOf`, repository.remote);
  }

  app = await launch();
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(5000);
  const openSettings = () => page.getByRole("button", { name: "공간 전환·관리", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "설정", exact: true });
  const teamRow = index => settings.getByRole("group", { name: `팀 저장소 ${index + 1}`, exact: true });
  const connect = () => settings.getByRole("button", { name: "입력한 저장소 연결", exact: true }).click();
  const mockPicker = folder => app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
  }, folder);

  await openSettings();
  await settings.getByRole("button", { name: "팀 저장소 연결", exact: true }).click();
  const unauthorized = path.join(root, "Unpicked");
  await mkdir(unauthorized);
  const response = await page.evaluate(({ remote, branch, folder }) => window.notes.connectTeamRepositories({ repositories: [{ remote, branch, folder }] }), { ...repositories[0], folder: unauthorized });
  assert.equal(response.value[0].ok, false);
  await assert.rejects(access(path.join(unauthorized, ".git")), { code: "ENOENT" });

  await mockPicker(personal);
  await teamRow(0).getByRole("button", { name: "폴더 선택", exact: true }).click();
  await teamRow(0).getByRole("alert").waitFor();
  for (const [index, repository] of repositories.entries()) {
    if (index > 0) await settings.getByRole("button", { name: "저장소 추가", exact: true }).click();
    const row = teamRow(index);
    await row.getByRole("textbox", { name: "저장소 주소", exact: true }).fill(repository.remote);
    await row.getByRole("textbox", { name: "브랜치", exact: true }).fill(index === 2 ? "wrong-branch" : repository.branch);
    await mockPicker(repository.folder);
    await row.getByRole("button", { name: "폴더 선택", exact: true }).click();
    await row.getByText(repository.folder, { exact: true }).waitFor();
  }

  await connect();
  await settings.getByText("팀 저장소 2개를 연결했습니다.", { exact: true }).waitFor();
  await teamRow(0).getByRole("alert").waitFor();
  assert.equal(await teamRow(0).getByRole("textbox", { name: "저장소 주소", exact: true }).inputValue(), repositories[2].remote);
  for (const repository of repositories.slice(0, 2)) {
    assert.equal(git(repository.folder, "config", "--local", "--get", "remote.origin.url"), repository.remote);
    assert.equal(git(repository.folder, "branch", "--show-current"), repository.branch);
    assert.equal(await readFile(path.join(repository.folder, "회의록.md"), "utf8"), `# ${repository.name} 회의록\n`);
  }
  const retry = repositories[2];
  git(retry.folder, "clone", "--branch", retry.branch, retry.remote, ".");
  await teamRow(0).getByRole("textbox", { name: "브랜치", exact: true }).fill(repositories[2].branch);
  await connect();
  await settings.getByText("팀 저장소 1개를 연결했습니다.", { exact: true }).waitFor();
  await settings.getByRole("button", { name: "닫기", exact: true }).click();
  const registered = JSON.parse(await readFile(path.join(profile, "settings.json"), "utf8"));
  assert.equal(registered.vaultRoot, personal);
  assert.equal(registered.vaultPurposes[personal], "personal");
  for (const repository of repositories) assert.equal(registered.vaultPurposes[repository.folder], "team");
  await assert.rejects(access(path.join(profile, "git-backup.json")), { code: "ENOENT" });

  await page.getByRole("button", { name: "파일 목록", exact: true }).click();
  for (const repository of repositories) {
    const tree = page.getByRole("region", { name: `팀 공유 노트 · ${repository.name}`, exact: true });
    await tree.getByRole("button", { name: "회의록", exact: true }).click();
    await page.locator(".navigator").getByRole("button", { name: "새 문서", exact: true }).click();
    await page.getByRole("textbox", { name: "문서 이름", exact: true }).fill("검증 노트");
    await page.getByRole("button", { name: "문서 만들기", exact: true }).click();
    await tree.getByRole("button", { name: "검증 노트", exact: true }).waitFor();
    await access(path.join(repository.folder, "검증 노트.md"));
  }
  await assert.rejects(access(path.join(personal, "검증 노트.md")), { code: "ENOENT" });
  assert.equal(await readFile(path.join(personal, "개인.md"), "utf8"), "# 비공개 메모\n");
  await app.close();
  app = await launch();
  const reopened = await app.firstWindow();
  reopened.on("pageerror", error => errors.push(error.message));
  for (const repository of repositories)
    await reopened.getByRole("region", { name: `팀 공유 노트 · ${repository.name}`, exact: true }).waitFor({ timeout: 5000 });
  assert.deepEqual(errors, []);
  console.log("Verified batch Git registration, targeted retries with an existing clone, native folder selection, vault-scoped note creation, and restart.");
} finally {
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
