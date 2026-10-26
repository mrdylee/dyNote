const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const fixture = await mkdtemp(`${tmpdir()}/dynote-graph-drag-`);
const profile = `${fixture}/profile`, vault = `${fixture}/vault`;
await mkdir(profile); await mkdir(vault);
await writeFile(`${profile}/settings.json`, JSON.stringify({ vaultRoot: vault }));
await writeFile(`${vault}/A.md`, "# Alpha\n[[B]]\n");
await writeFile(`${vault}/B.md`, "# Beta\n[[A]]\n");
await mkdir("output/playwright", { recursive: true });
const app = await electron.launch({
  executablePath: process.env.DYNOTE_EXECUTABLE || `${process.cwd()}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`,
  args: process.env.DYNOTE_EXECUTABLE ? [] : ["."],
  env: { ...process.env, OPEN_NOTES_DATA: profile },
});
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setSize(1420, 940); window.setIgnoreMouseEvents(true);
  });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "그래프 보기", exact: true }).waitFor();
  await page.evaluate(() => {
    const NativeWorker = window.Worker;
    window.dragProbe = { frames: 0, points: [], pins: [], releases: 0, settled: false };
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.type !== "frame") return;
          const p = window.dragProbe;
          p.frames++; p.points = Array.from(new Float32Array(data.buffer)); p.settled = data.settled;
        });
      }
      postMessage(message, ...args) {
        if (message.type === "pin") window.dragProbe.pins.push({ index: message.index, x: message.x, y: message.y });
        if (message.type === "unpin") window.dragProbe.releases++;
        return super.postMessage(message, ...args);
      }
    };
  });
  await page.getByRole("button", { name: "그래프 보기", exact: true }).click();
  await page.waitForFunction(() => window.dragProbe.settled);
  await page.getByRole("button", { name: "그래프 보기 초기화", exact: true }).click();
  const box = await page.locator(".graph-stage canvas").boundingBox();
  const before = await page.evaluate(() => window.dragProbe.points.slice());
  const xs = [before[0], before[2]], ys = [before[1], before[3]];
  const scale = Math.min(1.5, Math.max(1, box.width - 80) / Math.max(100, Math.max(...xs) - Math.min(...xs)), Math.max(1, box.height - 80) / Math.max(100, Math.max(...ys) - Math.min(...ys)));
  const start = { x: box.x + box.width / 2 + (before[0] - (before[0] + before[2]) / 2) * scale, y: box.y + box.height / 2 + (before[1] - (before[1] + before[3]) / 2) * scale };
  const target = { x: box.x + box.width * 0.45, y: box.y + box.height * 0.25 };
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.waitForFunction(() => window.dragProbe.pins.length > 1);
  const pin = await page.evaluate(() => window.dragProbe.pins.at(-1));
  // Longer than the initial cooling time: holding still must keep neighbors moving.
  await page.waitForTimeout(3200);
  const held = await page.evaluate(() => ({ frames: window.dragProbe.frames, points: window.dragProbe.points.slice() }));
  await page.waitForTimeout(160);
  assert.ok(await page.evaluate((frames) => window.dragProbe.frames > frames, held.frames), "stationary drag must keep simulation active until release");
  assert.ok(Math.hypot(held.points[pin.index * 2] - pin.x, held.points[pin.index * 2 + 1] - pin.y) < 0.01, "dragged node must follow the held pointer");
  const suffix = process.env.DYNOTE_EXECUTABLE ? "-packaged" : "";
  await page.screenshot({ path: `output/playwright/graph-drag-held${suffix}.png` });
  await page.mouse.up();
  await page.waitForFunction(() => window.dragProbe.settled);
  const after = await page.evaluate(() => ({ frames: window.dragProbe.frames, points: window.dragProbe.points.slice(), releases: window.dragProbe.releases }));
  const angle = (p) => Math.atan2(p[1] - p[3], p[0] - p[2]);
  const rotation = Math.abs(Math.atan2(Math.sin(angle(after.points) - angle(before)), Math.cos(angle(after.points) - angle(before))));
  assert.ok(rotation > 0.5, "dragged pair must settle into a changed arrangement instead of its original orientation");
  assert.equal(after.releases, 1);
  assert.equal(await page.locator(".graph-stage canvas").count(), 1, "drag release must not open the note");
  await page.waitForTimeout(160);
  assert.equal(await page.evaluate(() => window.dragProbe.frames), after.frames, "released graph must cool and stop scheduling");
  await page.screenshot({ path: `output/playwright/graph-drag-released${suffix}.png` });
  for (const event of ["pointercancel", "lostpointercapture"]) {
    const points = await page.evaluate(() => window.dragProbe.points.slice());
    const x = box.x + box.width / 2 + (points[0] - (before[0] + before[2]) / 2) * scale;
    const y = box.y + box.height / 2 + (points[1] - (before[1] + before[3]) / 2) * scale;
    const releases = await page.evaluate(() => window.dragProbe.releases);
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 20, y + 10, { steps: 3 });
    await page.locator(".graph-stage canvas").dispatchEvent(event);
    await page.mouse.up();
    await page.waitForFunction(() => window.dragProbe.settled);
    assert.equal(await page.evaluate(() => window.dragProbe.releases), releases + 1, `${event} releases the active pin exactly once`);
  }
  assert.deepEqual(errors, []);
  const report = { packaged: !!process.env.DYNOTE_EXECUTABLE, checks: ["stationary drag keeps physics active", "held node follows pointer", "release retains changed arrangement", "release does not open note", "released graph stops scheduling", "pointercancel and lostpointercapture release active pins"], before, pin, held, after, rotation, errors };
  await writeFile(`output/playwright/graph-drag${suffix}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await app.close(); await rm(fixture, { recursive: true, force: true }); }
