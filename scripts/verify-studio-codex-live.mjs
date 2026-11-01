// Opt-in live Codex inference. Only a generated public schedule is transmitted.
// The installed app uses a disposable vault/profile and the existing account
// through its controller; credentials are never read, copied or printed here.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { BOARD_PATH, readBoard } from "../core/planner.mjs";
const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const accountDirectory = process.env.DYNOTE_LIVE_CODEX_DIRECTORY;
if (!accountDirectory) throw new Error("Set DYNOTE_LIVE_CODEX_DIRECTORY to an existing connected app profile.");
const executable = process.env.DYNOTE_EXECUTABLE || "/Applications/Dynote.app/Contents/MacOS/Dynote";
const output = process.env.DYNOTE_LIVE_OUTPUT || `${process.cwd()}/output/playwright/studio-codex-live`;
const effort = process.env.DYNOTE_BENCH_EFFORT || null;
assert.ok(effort === null || effort === "low", "Benchmark override supports low effort only.");
const root = await mkdtemp(`${tmpdir()}/dynote-studio-live-`), profile = `${root}/profile`, vault = `${root}/vault`;
await mkdir(output, { recursive: true }); await mkdir(profile); await mkdir(vault);
await writeFile(`${profile}/settings.json`, JSON.stringify({ vaultRoot: vault }));
const report = { realCodexInference: true, syntheticImageOnly: true, isolatedVault: true, fixtureRoot: root, checks: [], rendererErrors: [] };
const app = await electron.launch({ executablePath: executable, args: [], env: { ...process.env, OPEN_NOTES_DATA: profile } });
let page;
try {
  page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on("pageerror", error => report.rendererErrors.push(error.message));
  await app.evaluate(async ({ app, ipcMain, BrowserWindow }, { accountDirectory, output, effort }) => {
    const require = process.getBuiltinModule("node:module").createRequire(`${app.getAppPath()}/package.json`);
    const { writeFile } = require("node:fs/promises");
    const { CodexController } = require(`${app.getAppPath()}/electron/codex-controller.mjs`);
    const window = BrowserWindow.getAllWindows()[0]; window.setSize(1440, 1000);
    const probe = globalThis.liveCaptureProbe = { requests: [], terminals: [], loginAttempts: 0, models: [], modelEfforts: {}, maxImageEchoBytes: 0 };
    const controller = globalThis.liveCaptureController = new CodexController({ directory: accountDirectory,
      openExternal() { throw new Error("This test must reuse an existing login."); },
      onEvent(event) {
        const request=probe.requests.find(request=>request.requestId===event.requestId);
        if(event.type==='delta'&&request&&request.firstDeltaMs===undefined)request.firstDeltaMs=Date.now()-request.startedAt;
        if (["done", "error", "canceled"].includes(event.type)) {
          probe.terminals.push({ type: event.type, error: event.error, bytes: Buffer.byteLength(event.content || ""), finishedAt:Date.now(), elapsedMs:request?Date.now()-request.startedAt:null });
          if (event.type === "done") writeFile(`${output}/answer-${probe.terminals.length}.json`, event.content).catch(() => {});
        }
        window.webContents.send("notes:codex-event", event);
      },
    });
    const createRpc = controller.createRpc;
    controller.createRpc = options => {
      const rpc=createRpc({ ...options, onNotification(method, params) {
      if (params.item?.type === "userMessage" && params.item.content.some(input => input.type === "image"))
        probe.maxImageEchoBytes = Math.max(probe.maxImageEchoBytes, Buffer.byteLength(JSON.stringify(params)));
      options.onNotification(method, params);
      } });
      const request=rpc.request.bind(rpc);
      rpc.request=async(method,params)=>{
        const active=probe.requests.at(-1);
        if(method==='turn/start'&&effort){
          if(!probe.modelEfforts[active.model]?.supported.includes(effort))throw new Error('Selected model does not advertise the benchmark effort.');
          params={...params,effort};
        }
        const response=await request(method,params);
        if(method==='model/list')for(const model of response.data)probe.modelEfforts[model.model??model.id]={default:model.defaultReasoningEffort,supported:model.supportedReasoningEfforts?.map(item=>item.reasoningEffort)??[]};
        if(method==='thread/start'&&active){active.defaultEffort=response.reasoningEffort;active.appliedEffort=effort??response.reasoningEffort;}
        return response;
      };
      return rpc;
    };
    const handle = (name, callback) => { ipcMain.removeHandler(`notes:${name}`); ipcMain.handle(`notes:${name}`, callback); };
    handle("copilot-status", () => ({ ok: true, value: { authenticated: false, models: [] } }));
    handle("codex-status", async () => {
      try { const value = await controller.status(); probe.models = value.models; return { ok: true, value }; }
      catch (error) { return { ok: false, error: error.message }; }
    });
    handle("codex-login", () => { probe.loginAttempts++; return { ok: false, error: "Use the existing account only." }; });
    handle("codex-send", async (_, args) => {
      try {
        assertSynthetic(args);
        const bytes = Buffer.from(args.image.data, "base64");
        probe.requests.push({ requestId:args.requestId,startedAt:Date.now(),model: args.model, mimeType: args.image.mimeType, imageBytes: bytes.length,
          audit: args.context.path === "Capture review.json", contextKind: args.context.kind });
        await writeFile(`${output}/sent-${probe.requests.length}.jpg`, bytes);
        return { ok: true, value: controller.send(args) };
      } catch (error) { return { ok: false, error: error.message }; }
    });
    function assertSynthetic(args) {
      if (!args.image || args.references.length || args.history.length ||
          !(args.context.kind === "none" || args.context.path === "Capture review.json"))
        throw new Error("Unexpected context: refusing transmission.");
    }
    handle("codex-cancel", async (_, args) => { await controller.cancel(args?.requestId); return { ok: true }; });
  }, { accountDirectory, output, effort });
  await page.getByRole("button", { name: "개발 플래너", exact: true }).waitFor();
  await page.evaluate(() => { localStorage.setItem("dynote.ai.provider", "codex"); localStorage.setItem("dynote.codex.model", "gpt-6.1-sol"); });
  await page.reload();
  const model = page.getByLabel("Codex 모델", { exact: true }); await model.waitFor();
  const chosen = await model.inputValue(); assert.ok(chosen); report.model = chosen;
  assert.equal(await app.evaluate(() => globalThis.liveCaptureProbe.loginAttempts), 0);
  console.log(JSON.stringify({ phase: "existing Codex account and model ready", model: chosen }));
  const original = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 2400; canvas.height = 1800;
    const x = canvas.getContext("2d"), pixels = x.createImageData(canvas.width, canvas.height); let seed = 42;
    for (let i = 0; i < pixels.data.length; i += 4) {
      for (let c = 0; c < 3; c++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; pixels.data[i + c] = seed >>> 24; }
      pixels.data[i + 3] = 255;
    }
    x.putImageData(pixels, 0, 0); x.fillStyle = "white"; x.fillRect(80, 350, 2240, 750);
    x.fillStyle = "#172b36"; x.font = "bold 64px Arial"; x.fillText("SYNTHETIC TEST SCHEDULE", 160, 460);
    x.font = "36px Arial"; x.fillText("PUBLIC TEST DATA ONLY - ALL DATES ARE IN 2026", 160, 530);
    x.strokeStyle = "#334155"; x.lineWidth = 3; x.strokeRect(150, 600, 2100, 360); x.beginPath(); x.moveTo(150, 780); x.lineTo(2250, 780); x.stroke();
    x.font = "bold 48px Arial"; x.fillText("LINK   DV REVIEW", 200, 710); x.fillText("BMS   PD REVIEW", 200, 890);
    x.font = "48px Arial"; x.fillText("2026-11-20 - 2026-11-21", 980, 710); x.fillText("2026-12-02", 980, 890);
    return canvas.toDataURL("image/png").split(",")[1];
  }), "base64");
  assert.ok(original.length > 6 * 1024 * 1024 && original.length < 25 * 1024 * 1024);
  await writeFile(`${output}/original-synthetic.png`, original);
  report.originalBytes = original.length;
  await page.getByRole("button", { name: "개발 플래너", exact: true }).click();
  const uploadStartedAt=Date.now();
  await page.getByLabel("일정 캡처 파일", { exact: true }).setInputFiles({ name: "synthetic-large-schedule.png", mimeType: "image/png", buffer: original });
  await page.waitForFunction(() => globalThis.document.querySelector(".planner-progress") || globalThis.document.querySelector(".planner-alert"));
  await page.waitForFunction(() => document.querySelectorAll('.planner-card').length===2 || document.querySelector('.planner-alert'), null, { timeout: 280000 });
  const alerts = await page.locator(".planner-alert").allTextContents();
  const probe = await app.evaluate(() => {
    const { requests, terminals, loginAttempts, maxImageEchoBytes } = globalThis.liveCaptureProbe;
    return { requests, terminals, loginAttempts, maxImageEchoBytes };
  });
  report.transport = probe;
  report.timings={prepareAndImportMs:probe.requests[0].startedAt-uploadStartedAt,firstResultMs:probe.terminals[0].finishedAt-uploadStartedAt,totalMs:probe.terminals.at(-1).finishedAt-uploadStartedAt};
  assert.deepEqual(alerts, []);
  assert.equal(probe.requests.length, 2); assert.deepEqual(probe.requests.map(r => r.audit), [false, true]);
  assert.ok(probe.requests.every(r => r.model === chosen && r.mimeType === "image/jpeg" && r.imageBytes <= 6 * 1024 * 1024));
  assert.deepEqual(probe.terminals.map(e => e.type), ["done", "done"]); assert.equal(probe.loginAttempts, 0);
  const transmitted = await readFile(`${output}/sent-1.jpg`);
  report.transmittedBytes = transmitted.length; report.savingsPercent = Math.round((1 - transmitted.length / original.length) * 100);
  report.dimensions = await page.evaluate(async data => {
    const image = await createImageBitmap(new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], { type: "image/jpeg" }));
    const size = [image.width, image.height]; image.close(); return size;
  }, transmitted.toString("base64"));
  assert.deepEqual(report.dimensions, [2400, 1800]);
  const board = readBoard(await readFile(`${vault}/${BOARD_PATH}`, "utf8"));
  const sourcePath = board.items[0].source.path;
  assert.deepEqual(await readFile(`${vault}/${sourcePath}`), original);
  report.originalSha256 = createHash("sha256").update(original).digest("hex");
  report.checks.push("Original PNG retained byte-for-byte; AI copy automatically becomes JPEG with unchanged dimensions");
  await page.screenshot({ path: `${output}/review.png` });
  assert.ok(board.items.every(item=>item.status==='draft'));
  report.items = board.items.map(({ title, target, stage, start, end }) => ({ title, target, stage, start, end }));
  const link = board.items.find(item => /link/i.test(item.target)), bms = board.items.find(item => /bms/i.test(item.target));
  assert.ok(link); assert.ok(bms); assert.equal(link.start, "2026-11-20"); assert.equal(link.end, "2026-11-21");
  assert.equal(bms.start || bms.end, "2026-12-02"); assert.equal(board.items.length, 2);
  report.checks.push("Actual Codex extraction and independent row audit complete without size errors or new login");
  report.checks.push("Both known schedule rows/dates recognized and saved through the installed Studio into the isolated board");
  assert.deepEqual(report.rendererErrors, []);
  await page.screenshot({ path: `${output}/registered.png` });
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = error.message;
  if (page) { await page.screenshot({ path: `${output}/failure.png` }).catch(() => {}); report.alerts = await page.locator(".planner-alert").allTextContents().catch(() => []); }
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)); throw error;
} finally {
  await app.evaluate(async () => { await globalThis.liveCaptureController?.close(); }).catch(() => {});
  await app.close();
}
