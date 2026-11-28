// The model's tool choices are scripted; Electron IPC, approvals, files and SDK shell are real.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import electron from "electron";

const { _electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), "dynote-project-ui-")));
const project = path.join(profile, "project"), vault = path.join(profile, "vault");
await mkdir(project); await mkdir(vault);
await writeFile(path.join(vault, "Home.md"), "# Note");
await writeFile(path.join(profile, "settings.json"), JSON.stringify({ vaultRoot: vault }));
const app = await _electron.launch({ executablePath: electron, args: ["."], env: {
  ...process.env, OPEN_NOTES_DATA: profile, HOME: profile, GH_TOKEN: "", GITHUB_TOKEN: "", COPILOT_GITHUB_TOKEN: "",
} });
try {
  const page = await app.firstWindow();
  const button = name => page.getByRole("button", { name, exact: true });
  await page.getByRole("tab", { name: "Copilot", exact: true }).waitFor();
  await app.evaluate(({ app, dialog }, project) => {
    const require = process.getBuiltinModule("module").createRequire(app.getAppPath() + "/package.json");
    const { CopilotSession, CopilotClient } = require(app.getAppPath() + "/node_modules/@github/copilot-sdk/dist/index.js");
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
    CopilotClient.prototype.getAuthStatus = async () => ({ isAuthenticated: true, login: "fixture" });
    CopilotClient.prototype.listModels = async () => [{ id: "auto", name: "Auto" }];
    CopilotSession.prototype.sendAndWait = async function ({ prompt }) {
      await this.rpc.tools.initializeAndValidate();
      const { tools } = await this.rpc.tools.getCurrentMetadata();
      const request = JSON.parse(prompt).request;
      const run = (name, args) => this.rpc.tools.execute({ name, arguments: args });
      const file = project + "/sample.js";
      if (request === "해제 확인") return { data: { content: tools.some(t => ["edit", "dynote_project_edit", "dynote_project_create"].includes(t.name)) ? "해제 실패" : "프로젝트 도구 해제됨" } };
      if (request === "중지 확인") { await run("dynote_project_edit", { path: file, old_str: "PASS", new_str: "STOP" }); return { data: { content: "종료" } }; }
      const outside = await run("view", { path: project + "/../vault/Home.md" });
      if (outside.resultType !== "denied") throw Error("프로젝트 밖 읽기 허용됨");
      const create = await run("dynote_project_create", { path: file, file_text: "console.log('FIRST')" });
      if (create.resultType !== "success") throw Error(create.textResultForLlm);
      const edit = await run("dynote_project_edit", { path: file, old_str: "FIRST", new_str: "PASS" });
      if (edit.resultType !== "success") throw Error(edit.textResultForLlm);
      const refused = await run("dynote_project_edit", { path: file, old_str: "PASS", new_str: "DECLINED" });
      if (refused.resultType !== "denied") throw Error("거절한 변경 적용됨");
      const shell = process.platform === "win32" ? "powershell" : "bash";
      const blocked = await run(shell, { command: "echo SKIP", description: "건너뛰기" });
      if (blocked.resultType !== "denied") throw Error("거절한 명령 실행됨");
      const result = await run(shell, { command: "node sample.js", description: "코드 실행" });
      if (result.resultType !== "success" || !result.textResultForLlm.includes("PASS")) throw Error(result.textResultForLlm);
      return { data: { content: "프로젝트 검증 완료" } };
    };
  }, project);
  await page.getByRole("tab", { name: "Copilot", exact: true }).click();
  await button("Copilot 연결 상태 확인").click();
  await page.getByLabel("Copilot 모델").selectOption("auto", { timeout: 10000 });
  await button("코드 프로젝트 선택").click();
  await page.getByText(project, { exact: true }).waitFor();
  const send = async text => { await page.getByLabel("Copilot 질문").fill(text); await button("Copilot 보내기").click(); };
  await send("파일을 구현하고 테스트해줘");
  await page.getByText("코드 파일 생성", { exact: true }).waitFor();
  await assert.rejects(readFile(path.join(project, "sample.js")), { code: "ENOENT" });
  await button("코드 적용").click();
  await page.getByText("PASS", { exact: true }).waitFor();
  assert.match(await readFile(path.join(project, "sample.js"), "utf8"), /FIRST/);
  await button("코드 적용").click();
  await page.getByText("DECLINED", { exact: true }).waitFor();
  await button("거절").click();
  await page.getByText("echo SKIP", { exact: true }).waitFor();
  await button("거절").click();
  await page.getByText("node sample.js", { exact: true }).waitFor();
  await button("명령 실행").click();
  await page.getByText("프로젝트 검증 완료", { exact: true }).waitFor();
  assert.equal(await readFile(path.join(project, "sample.js"), "utf8"), "console.log('PASS')");
  await send("중지 확인"); await page.getByText("STOP", { exact: true }).waitFor();
  await button("Copilot 응답 중지").click(); await button("프로젝트 해제").click();
  await send("해제 확인"); await page.getByText("프로젝트 도구 해제됨", { exact: true }).waitFor();
  assert.equal(await readFile(path.join(project, "sample.js"), "utf8"), "console.log('PASS')");
  console.log("PASS: native project tools, reviewed create/edit, declined edit/command, shell output, cancellation and disconnect.");
} finally {
  await app.close();
  await rm(profile, { recursive: true, force: true });
}
