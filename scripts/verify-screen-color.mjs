// Manual desktop test: use CUA/native clicks for sampling; stdin records evidence.
// Commands: inspect, record chrome, record desktop, restart, finish.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline/promises";
import { createServer } from "node:http";
const { _electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const fixture = await mkdtemp(`${tmpdir()}/dynote-screen-color-`);
const profile = `${fixture}/profile`, vault = `${fixture}/vault`, output = "output/playwright/screen-color";
await Promise.all([profile, vault, output].map(folder => mkdir(folder, { recursive: true })));
await writeFile(`${profile}/settings.json`, JSON.stringify({ vaultRoot: vault }));
await writeFile(`${vault}/Home.md`, "# Screen colors\n\nChrome and desktop\n");
const launch = () => _electron.launch({ executablePath: `${process.cwd()}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`, args: ["."], env: { ...process.env, OPEN_NOTES_DATA: profile } });
let app = await launch(), page = await app.firstWindow();
const errors = [], report = { platform: process.platform, samples: {}, checks: [] };
const observe = () => page.on("pageerror", error => errors.push(error.message));
observe();
const inspect = () => page.evaluate(() => ({
  saved: JSON.parse(localStorage.getItem("dynote.textColors") || "[]"),
  current: document.querySelector(".text-color-menu summary")?.title,
  selection: [...document.querySelectorAll(".cm-content")].map(el => { const view = el.cmTile.root.view; return view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to); }),
  alerts: [...document.querySelectorAll('[role="alert"]')].map(el => el.textContent),
}));
const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end('<!doctype html><title>Dynote screen color test</title><style>html,body{margin:0;height:100%;background:#2c7a90;color:white;font:24px sans-serif}p{padding:24px}</style><p>Chrome test color: #2c7a90</p>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
console.log(JSON.stringify({ ready: true, fixture, chromeTestUrl: `http://127.0.0.1:${server.address().port}/` }));
const input = createInterface({ input: process.stdin, terminal: false });
try {
  for await (const command of input) {
    try {
      if (command === "restart") {
        await app.close(); app = await launch(); page = await app.firstWindow(); observe();
        await page.waitForLoadState("domcontentloaded");
        report.checks.push("restarted isolated Electron profile");
      } else if (command.startsWith("record ")) {
        const source = command.slice(7), state = await inspect();
        assert.ok(["chrome", "desktop"].includes(source));
        assert.match(state.current, /^#[0-9a-f]{6}$/);
        assert.ok(state.saved.includes(state.current), "Sample must be saved through the UI before recording");
        if (source === "chrome") {
          const expected = "#2c7a90";
          const delta = [1, 3, 5].map(i => parseInt(state.current.slice(i, i + 2), 16) - parseInt(expected.slice(i, i + 2), 16));
          report.chromeReference = { expected, actual: state.current, channelDelta: delta };
          assert.ok(delta.every(value => Math.abs(value) <= 1), "Chrome screen sample must be within one channel unit of the CSS fixture color");
        }
        report.samples[source] = state.current;
        report.checks.push(`${source} pixel sampled outside Dynote and explicitly saved`);
        await page.screenshot({ path: `${output}/${source}-saved.png` });
      } else if (command === "finish") {
        const state = await inspect();
        assert.ok(report.samples.chrome && report.samples.desktop);
        assert.ok(report.checks.includes("restarted isolated Electron profile"));
        assert.notEqual(report.samples.chrome, report.samples.desktop);
        for (const color of Object.values(report.samples)) assert.ok(state.saved.includes(color));
        assert.deepEqual(errors, []);
        report.checks.push("both sampled colors remain saved after restart; no renderer errors");
        await writeFile(`${output}/report.json`, JSON.stringify({ ...report, state, errors }, null, 2));
        console.log(JSON.stringify({ ...report, state, errors }));
        break;
      }
      console.log(JSON.stringify(await inspect()));
    } catch (error) { console.log(JSON.stringify({ error: error.message })); }
  }
} finally { await app.close(); await rm(fixture, { recursive: true, force: true }); input.close(); server.close(); }
