const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const count = Number(process.argv[2] ?? 1000);
const profile = await mkdtemp(`${tmpdir()}/dynote-graph-runtime-`);
await mkdir("output/playwright", { recursive: true });
const vaultRoot = await mkdtemp(`${tmpdir()}/dynote-graph-vault-`);
const notePath = (i) => `group-${String(Math.floor(i / 100)).padStart(3, "0")}/Note-${String(i).padStart(5, "0")}`;
for (let offset = 0; offset < count; offset += 100) {
  await mkdir(`${vaultRoot}/group-${String(Math.floor(offset / 100)).padStart(3, "0")}`, { recursive: true });
  await Promise.all(Array.from({ length: Math.min(100, count - offset) }, (_, j) => {
    const i = offset + j;
    return writeFile(`${vaultRoot}/${notePath(i)}.md`, `# Note ${String(i).padStart(5, "0")}\n\nSynthetic graph fixture.\n\n[[${notePath((i + 1) % count)}]]\n[[${notePath((i + 31) % count)}]]\n\n#cluster-${String(Math.floor(i / 100)).padStart(3, "0")}\n`);
  }));
}
await writeFile(profile + "/settings.json", JSON.stringify({ vaultRoot }));
const app = await electron.launch({ executablePath: process.argv[3] ?? process.cwd() + "/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron", args: process.argv[3] ? [] : ["."], env: { ...process.env, OPEN_NOTES_DATA: profile }, timeout: 30000 });
const errors = [], report = { count, packaged: !!process.argv[3], viewport: { width: 1420, height: 940 }, checks: [] };
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1420, 940));
  await page.getByRole("button", { name: "그래프 보기", exact: true }).waitFor();
  await page.evaluate(() => {
    window.graphProbe = { frames: 0, renders: [], inputMs: [], points: [], workers: 0, terminated: 0, drawCalls: 0 };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); window.graphProbe.workers++; this.addEventListener("message", ({ data }) => { if (data.type === "frame") { const p = window.graphProbe; p.frames++; p.points = Array.from(new Float32Array(data.buffer)); p.settled = data.settled; p.firstFrame ??= performance.now(); } }); }
      terminate() { window.graphProbe.terminated++; return super.terminate(); }
    };
    for (const api of [WebGLRenderingContext, WebGL2RenderingContext]) {
      for (const name of ["drawElements", "drawArrays"]) {
        const original = api.prototype[name];
        api.prototype[name] = function (...args) { window.graphProbe.drawCalls++; return original.apply(this, args); };
      }
    }
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (fn) => raf((time) => { const start = performance.now(), calls = window.graphProbe.drawCalls; fn(time); const p = window.graphProbe; if (p.drawCalls > calls) { p.renders.push({ start, duration: performance.now() - start }); p.firstRender ??= performance.now(); } if (p.inputStart && p.drawCalls > calls) { p.inputMs.push(performance.now() - p.inputStart); p.inputStart = 0; } });
    window.graphProbe.started = performance.now();
  });
  await page.getByRole("button", { name: "그래프 보기", exact: true }).click();
  await page.waitForFunction(() => window.graphProbe.settled === true, null, { timeout: 20000 });
  assert.equal(await page.locator(".graph-stage canvas").count(), 1);
  assert.match(await page.locator(".graph-legend").innerText(), new RegExp(`${count}개 문서`));
  assert.equal(errors.length, 0, errors.join("\n"));
  report.checks.push("notes://app WASM Worker WebGL load", "node and edge counts");
  report.startup = await page.evaluate(() => ({ graphToFirstWorkerFrameMs: window.graphProbe.firstFrame - window.graphProbe.started, graphToFirstRenderMs: window.graphProbe.firstRender - window.graphProbe.started, workerFrames: window.graphProbe.frames }));
  await page.waitForTimeout(100);
  const beforeIdle = await page.evaluate(() => ({ frames: window.graphProbe.frames, renders: window.graphProbe.renders.length }));
  await page.waitForTimeout(600);
  const afterIdle = await page.evaluate(() => ({ frames: window.graphProbe.frames, renders: window.graphProbe.renders.length }));
  assert.deepEqual(afterIdle, beforeIdle); report.checks.push("idle: no Worker frames or scheduled renders");
  for (let i = 0; i < 30; i++) {
    await page.evaluate((i) => { window.graphProbe.inputStart = performance.now(); document.querySelector(".graph-stage canvas").dispatchEvent(new KeyboardEvent("keydown", { key: i % 2 ? "ArrowLeft" : "ArrowRight", bubbles: true })); }, i);
    await page.waitForTimeout(25);
  }
  report.performance = await page.evaluate(() => {
    const percentile = (array, p) => array.slice().sort((a, b) => a - b)[Math.min(array.length - 1, Math.floor(array.length * p))];
    const probe = window.graphProbe;
    return { renderCallbacks: probe.renders.length, renderCallbackP95Ms: percentile(probe.renders.map((r) => r.duration), 0.95), scriptedKeyboardToRenderP95Ms: percentile(probe.inputMs, 0.95), jsHeapBytes: performance.memory?.usedJSHeapSize };
  });
  const zoomBefore = parseInt(await page.locator(".graph-controls span").innerText());
  // The zoom label rounds to whole percentages; several steps are needed at 3%.
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "그래프 확대", exact: true }).click();
  assert.ok(parseInt(await page.locator(".graph-controls span").innerText()) > zoomBefore);
  const canvasBox = await page.locator(".graph-stage canvas").boundingBox();
  await page.mouse.move(canvasBox.x + 10, canvasBox.y + 10);
  const wheelBefore = parseInt(await page.locator(".graph-controls span").innerText());
  await page.mouse.wheel(0, -160);
  await page.waitForTimeout(100);
  assert.ok(parseInt(await page.locator(".graph-controls span").innerText()) > wheelBefore);
  await page.mouse.down(); await page.mouse.move(canvasBox.x + 60, canvasBox.y + 40, { steps: 3 }); await page.mouse.up();
  assert.equal(await page.locator(".graph-stage canvas").count(), 1);
  report.checks.push("zoom button, wheel and background pan");
  const editStart = await page.evaluate(() => performance.now());
  await writeFile(`${vaultRoot}/${notePath(0)}.md`, `# Note 00000\n[[${notePath(1)}]] [[${notePath(31)}]] [[${notePath(50)}]]`);
  await page.getByRole("button", { name: "문서 새로고침", exact: true }).click();
  await page.waitForFunction((expected) => document.querySelector(".graph-legend")?.textContent.includes(`${expected}개 연결`), count * 2 + 1);
  report.singleNoteEditAndRefreshMs = await page.evaluate(() => performance.now()) - editStart;
  report.checks.push("one-note edit updates edge count");
  await page.getByRole("status").filter({ hasText: "배치 완료" }).waitFor();
  await page.getByRole("button", { name: "그래프 보기 초기화" }).click();
  await page.screenshot({ path: `output/playwright/graph-${count}.png` });
  await page.getByRole("textbox", { name: "그래프 경로 필터" }).fill("Note-00044.md");
  await page.waitForFunction(() => document.querySelector(".graph-legend")?.textContent.includes("1개 문서 · 0개 연결"));
  await page.getByRole("status").filter({ hasText: "배치 완료" }).waitFor({ timeout: 10000 });
  const box = await page.locator(".graph-stage canvas").boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 70, y + 30, { steps: 5 });
  await page.waitForTimeout(80);
  const pinned = await page.evaluate(() => window.graphProbe.points.slice());
  await page.waitForTimeout(80);
  assert.deepEqual(await page.evaluate(() => window.graphProbe.points), pinned);
  await page.mouse.up();
  assert.equal(await page.locator(".graph-stage canvas").count(), 1); report.checks.push("node drag pins coordinates and release does not open document");
  await page.getByRole("status").filter({ hasText: "배치 완료" }).waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "그래프 보기 초기화" }).click();
  await page.waitForTimeout(50);
  await page.screenshot({ path: `output/playwright/before-click-${count}.png` });
  await page.mouse.click(x, y);
  await page.locator(".graph-stage canvas").waitFor({ state: "detached" }); report.checks.push("node click opens note");
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "그래프 보기", exact: true }).click();
    await page.getByRole("checkbox", { name: "현재 문서 주변", exact: true }).check();
    await page.waitForFunction(() => document.querySelector(".graph-legend")?.textContent.includes("5개 문서 · 4개 연결"));
    await page.getByRole("checkbox", { name: "나가는 링크", exact: true }).uncheck();
    await page.waitForFunction(() => document.querySelector(".graph-legend")?.textContent.includes("3개 문서 · 2개 연결"));
    await page.getByRole("checkbox", { name: "나가는 링크", exact: true }).check();
    await page.getByRole("combobox", { name: "그래프 문서 열기", exact: true }).selectOption("group-000/Note-00044.md");
    await page.locator(".graph-stage canvas").waitFor({ state: "detached" });
  }
  report.checks.push("local inbound/outbound counts", "keyboard document picker", "3 graph mount/unmount cycles");
  report.workers = await page.evaluate(() => ({ created: window.graphProbe.workers, terminated: window.graphProbe.terminated }));
  assert.equal(report.workers.created, report.workers.terminated);
  assert.equal(errors.length, 0, errors.join("\n"));
  report.errors = errors;
  report.note = "Real Electron custom scheme; scripted input-to-render callback excludes OS input/presentation latency. Render callback time excludes GPU completion. No matched original app FPS comparison.";
  console.log(JSON.stringify(report, null, 2));
  await writeFile(`output/playwright/graph-runtime-${count}${process.argv[3] ? "-packaged" : ""}.json`, JSON.stringify(report, null, 2));
} finally { await app.close(); }
