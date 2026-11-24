import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { _electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const executablePath = createRequire(import.meta.url)("electron");
const root = await mkdtemp(path.join(tmpdir(), "dynote-cloud-ui-"));
const repo = path.join(root, "test.git"), gitConfig = path.join(root, "gitconfig");
const channel = randomUUID(), remote = "https://bridge.invalid/approved/ask.git";
const question = "합성 질문 " + randomUUID();
const keys = { client: generateKeyPairSync("ed25519"), worker: generateKeyPairSync("ed25519") };
const apps = new Set();
try {
  execFileSync("git", ["init", "--quiet", "--bare", repo]);
  execFileSync("git", ["config", "--file", gitConfig, "url." + pathToFileURL(repo).href + ".insteadOf", remote]);
  for (const role of ["client", "worker"]) {
    const dir = path.join(root, role);
    const vault = path.join(dir, "vault"), profile = path.join(dir, "profile");
    await mkdir(vault, { recursive: true }); await mkdir(profile);
    await writeFile(path.join(vault, "Home.md"), "# 원본\nprivate-canary\n");
    await writeFile(path.join(profile, "settings.json"), JSON.stringify({ vaultRoot: vault, vaultPurposes: { [vault]: "personal" } }));
    const privateKeyFile = path.join(dir, "private.pem"), peerPublicKeyFile = path.join(dir, "peer.pem");
    await writeFile(privateKeyFile, keys[role].privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    await writeFile(peerPublicKeyFile, keys[role === "client" ? "worker" : "client"].publicKey.export({ type: "spki", format: "pem" }));
    await writeFile(path.join(dir, "managed.json"), JSON.stringify({ channel, role, remote, privateKeyFile, peerPublicKeyFile, model: "auto", copilotLogin: "fixture" }));
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "bridge-ui-fixture", version: "0.0.1", main: "main.cjs" }));
    // Only the disposable launcher redirects the managed policy and replaces SDK inference.
    await writeFile(path.join(dir, "main.cjs"), `
      const fs = require("node:fs");
      const path = require("node:path");
      (async () => {
        const { managedBridgePath } = await import(${JSON.stringify(new URL("../electron/bridge-policy.mjs", import.meta.url).href)});
        const location = managedBridgePath();
        const read = fs.promises.readFile.bind(fs.promises);
        fs.promises.readFile = (file, ...rest) => read(file === location ? path.join(__dirname, "managed.json") : file, ...rest);
        require("node:module").syncBuiltinESMExports();
        const { CopilotController } = await import(${JSON.stringify(new URL("../electron/copilot-controller.mjs", import.meta.url).href)});
        CopilotController.prototype.client = async () => {
          if (${JSON.stringify(role)} === "client") { fs.writeFileSync(path.join(__dirname, "unexpected-sdk"), "called"); throw Error("Local SDK called"); }
          return {
            getAuthStatus: async () => ({ isAuthenticated: true, login: "fixture" }),
            listModels: async () => [{id:"auto"}], deleteSession: async () => {},
            createSession: async () => ({
              sessionId:"fixture", rpc:{options:{update:async()=>{}}}, on:()=>()=>{},
              sendAndWait:async ({prompt}) => {
                fs.appendFileSync(path.join(__dirname, "calls"), prompt + "\\n");
                return {data:{content:"응답 " + JSON.parse(prompt).request}};
              }
            })
          };
        };
        await import(${JSON.stringify(new URL("../electron/main.mjs", import.meta.url).href)});
      })().catch(error => { console.error(error); process.exit(1); });
    `);
  }
  async function launch(role) {
    const dir = path.join(root, role);
    const app = await _electron.launch({ executablePath, args: [dir], env: { ...process.env, OPEN_NOTES_DATA: path.join(dir, "profile"), GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: "1" } });
    apps.add(app);
    const page = await app.firstWindow();
    page.setDefaultTimeout(30000);
    return { app, page };
  }
  async function openPanel(page) {
    await page.locator(".titlebar").getByRole("button", { name: /문서로 이동/ }).click();
    const search = page.getByRole("dialog", { name: "문서로 이동", exact: true });
    await search.getByRole("textbox", { name: "빠른 문서 검색" }).fill("path:Home.md");
    await search.getByRole("button", { name: /Home\.md$/ }).click();
    await search.waitFor({ state: "hidden" });
    const tab = page.getByRole("tab", { name: "Copilot", exact: true });
    if (!(await tab.isVisible())) {
      await page.getByRole("button", { name: "AI 채팅 열기", exact: true }).click();
    }
    await tab.click();
    await page.getByLabel("Cloud Copilot 질문").waitFor();
  }
  await launch("worker");
  const local = await launch("client");
  await openPanel(local.page);
  await local.page.getByLabel("Cloud Copilot 질문").fill(question);
  await local.page.getByRole("button", {name:"Cloud 질문 보내기"}).click();
  await local.page.getByText("응답 " + question, {exact:true}).waitFor();
  await local.app.close(); apps.delete(local.app);
  const reopened = await launch("client");
  await openPanel(reopened.page);
  await reopened.page.getByText("응답 " + question, {exact:true}).waitFor();
  await assert.rejects(readFile(path.join(root, "client", "unexpected-sdk")), {code:"ENOENT"});
  const input = JSON.parse((await readFile(path.join(root, "worker", "calls"), "utf8")).trim());
  assert.equal(input.request, question);
  assert.deepEqual(input.context, {kind:"none"}); assert.deepEqual(input.references, []); assert.deepEqual(input.dialogue, []);
  assert.equal(input.vaultAccess, false);
  console.log("PASS: Electron Local Ask -> Git -> Cloud Copilot controller (fixture model) -> Git -> same panel; recovered after restart; zero Local SDK calls.");
} finally {
  for (const app of apps) await app.close().catch(() => {});
  await rm(root, { recursive: true, force: true });
}
