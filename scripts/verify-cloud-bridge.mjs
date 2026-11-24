import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:https";

const { _electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const executablePath = createRequire(import.meta.url)("electron");
const root = await mkdtemp(path.join(tmpdir(), "dynote-cloud-ui-"));
const repo = path.join(root, "test.git"), gitConfig = path.join(root, "gitconfig");
const channel = randomUUID();
const question = "합성 질문 " + randomUUID();
const keys = { client: generateKeyPairSync("ed25519"), worker: generateKeyPairSync("ed25519") };
const apps = new Set();
let server, offline = false;
try {
  execFileSync("git", ["init", "--quiet", "--bare", repo]);
  execFileSync("git", ["-C", repo, "config", "http.receivepack", "true"]);
  await writeFile(gitConfig, "");
  const cert = path.join(root, "test-cert.pem"), key = path.join(root, "test-key.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost",
    "-addext", "subjectAltName=IP:127.0.0.1", "-out", cert, "-keyout", key], {stdio: "ignore"});
  server = createServer({cert: await readFile(cert), key: await readFile(key)}, (request, response) => {
    if (offline) { response.writeHead(503).end(); return; }
    const url = new URL(request.url, "https://127.0.0.1");
    if (!["/test.git/info/refs", "/test.git/git-receive-pack", "/test.git/git-upload-pack"].includes(url.pathname)) {
      response.writeHead(404).end(); return;
    }
    const cgi = spawn("git", ["http-backend"], {env: { ...process.env, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: "1",
      REQUEST_METHOD: request.method, PATH_INFO: url.pathname, QUERY_STRING: url.search.slice(1),
      CONTENT_TYPE: request.headers["content-type"] || "", REMOTE_USER: "fixture" }});
    const chunks = [];
    request.pipe(cgi.stdin);
    cgi.stdout.on("data", chunk => chunks.push(chunk));
    cgi.on("close", code => {
      const bytes = Buffer.concat(chunks), end = bytes.indexOf("\r\n\r\n");
      if (code || end < 0) { response.writeHead(500).end(); return; }
      for (const line of bytes.subarray(0, end).toString().split("\r\n")) {
        const at = line.indexOf(":");
        if (line.startsWith("Status:")) response.statusCode = parseInt(line.slice(at + 1), 10);
        else response.setHeader(line.slice(0, at), line.slice(at + 1).trim());
      }
      response.end(bytes.subarray(end + 4));
    });
  });
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const remote = "https://127.0.0.1:" + server.address().port + "/test.git";
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
                while (fs.existsSync(path.join(__dirname, "pause-answer"))) await new Promise(resolve => setTimeout(resolve, 100));
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
    const app = await _electron.launch({ executablePath, args: [dir], env: { ...process.env, OPEN_NOTES_DATA: path.join(dir, "profile"), GIT_SSL_CAINFO: cert, NO_PROXY: "127.0.0.1", GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: "1" } });
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
  const delayed = "지연 응답 " + randomUUID();
  const pause = path.join(root, "worker", "pause-answer");
  await writeFile(pause, "");
  await reopened.page.getByLabel("Cloud Copilot 질문").fill(delayed);
  await reopened.page.getByRole("button", {name:"Cloud 질문 보내기"}).click();
  await reopened.page.getByText("Cloud Copilot 답변 생성 중", {exact:true}).waitFor();
  // Local can see expiry while disconnected; Cloud still has time to finish.
  offline = true;
  await reopened.app.evaluate(() => { const now = Date.now; Date.now = () => now() + 11 * 60000; });
  await reopened.page.getByText("기한 경과 · 서버 확인 대기", {exact:true}).waitFor();
  await reopened.page.getByText(/Git 연결 또는 채널 서명/).waitFor();
  const recheck = reopened.page.getByRole("button", {name:"기존 답변 다시 확인"});
  await recheck.waitFor();
  offline = false;
  await reopened.page.getByText("대기 시간이 지났습니다. 도착한 답변을 다시 확인할 수 있습니다.", {exact:true}).waitFor();
  await rm(pause);
  const request = JSON.parse(execFileSync("git", ["-C", repo, "show", "refs/heads/dynote-bridge/" + channel + "/request:packet.json"], {encoding:"utf8"})).data.value;
  const resultRef = "refs/heads/dynote-bridge/" + channel + "/job/" + request.id + ":packet.json";
  const until = Date.now() + 30000;
  while (JSON.parse(execFileSync("git", ["-C", repo, "show", resultRef], {encoding:"utf8"})).data.value.state !== "COMPLETED") {
    assert.ok(Date.now() < until, "worker did not publish the delayed result");
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  await recheck.click();
  await reopened.page.getByText("응답 " + delayed, {exact:true}).waitFor();
  await assert.rejects(readFile(path.join(root, "client", "unexpected-sdk")), {code:"ENOENT"});
  const calls = (await readFile(path.join(root, "worker", "calls"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(calls.map(input => input.request), [question, delayed]);
  for (const input of calls) {
    assert.deepEqual(input.context, {kind:"none"}); assert.deepEqual(input.references, []); assert.deepEqual(input.dialogue, []);
    assert.equal(input.vaultAccess, false);
  }
  console.log("PASS: Electron Cloud Ask over HTTPS Git, restart and offline expiry recovery. Two fixture questions, two Cloud model calls, zero Local SDK calls.");
} finally {
  for (const app of apps) await app.close().catch(() => {});
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
