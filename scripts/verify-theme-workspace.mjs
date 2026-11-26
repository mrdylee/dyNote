import assert from "node:assert/strict";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import electronPath from "electron";

const { _electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const root = await mkdtemp(path.join(tmpdir(), "dynote-theme-"));
const vault = path.join(root, "vault");
const markdown = '# Theme\n\n[Link](https://example.org)\n\n> Quote\n\n- [ ] Task\n\n<span style="color:#c62828">Custom</span>\n';
let app;
try {
  await mkdir(vault);
  await writeFile(path.join(vault, "Theme.md"), markdown);
  const nodes = ["a", "b", "c"].map((id, index) => ({ id, type: "text", text: id, x: index * 280, y: 0, width: 200, height: 100 }));
  const edges = [
    { id: "default", fromNode: "a", toNode: "b", fromEnd: "arrow" },
    { id: "custom", fromNode: "b", toNode: "c", color: "#c62828", fromEnd: "arrow" },
  ];
  await writeFile(path.join(vault, "Board.canvas"), JSON.stringify({ nodes, edges }));
  await copyFile("tests/fixtures/office-preview.pptx", path.join(vault, "Slides.pptx"));
  await writeFile(path.join(root, "settings.json"), JSON.stringify({ vaultRoot: vault }));
  app = await _electron.launch({ executablePath: electronPath, args: ["."], env: { ...process.env, OPEN_NOTES_DATA: root } });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const button = name => page.getByRole("button", { name, exact: true });
  await button("파일 목록").click();
  await page.locator('.file-row[title="Theme.md"]').click();
  await button("읽기 보기").click();
  await button("설정").click();
  await button("테마").click();
  const radios = page.getByRole("group", { name: "색상 테마" }).getByRole("radio");
  assert.equal(await radios.count(), 10);
  const samples = [];
  for (const radio of await radios.all()) {
    await radio.check();
    await page.waitForFunction(id => JSON.parse(localStorage.getItem("dynote.theme")) === id, await radio.inputValue());
    samples.push(await page.evaluate(async () => {
      const brand = document.querySelector(".brand-mark");
      await Promise.all(brand.getAnimations().map(animation => animation.finished));
      const style = selector => getComputedStyle(document.querySelector(selector));
      return {
        brand: style(".brand-mark").backgroundColor,
        sidebar: style(".navigator").backgroundColor,
        status: style(".statusbar").color,
        dialogBorder: style(".modal").borderTopColor,
        body: style(".markdown-preview").color,
        link: style(".markdown-preview a").color,
        quote: style(".markdown-preview blockquote").backgroundColor,
        custom: style(".markdown-preview span[style*=color]").color,
      };
    }));
  }
  for (const key of Object.keys(samples[0]).filter(key => key !== "custom")) {
    assert.equal(new Set(samples.map(sample => sample[key])).size, 10, key);
  }
  assert.ok(samples.every(sample => sample.custom === "rgb(198, 40, 40)"));
  const closeSettings = () => page.getByRole("dialog").getByRole("button", { name: "닫기", exact: true }).click();
  await closeSettings();
  await button("Live Preview").click();
  assert.equal(await page.locator(".cm-live-checkbox").first().evaluate(el => getComputedStyle(el).accentColor), samples.at(-1).brand);
  await button("개발 플래너").click();
  assert.equal(await page.locator(".planner-brand > span").evaluate(el => getComputedStyle(el).color), samples.at(-1).brand);
  await button("그래프 보기").click();
  await page.locator(".graph-stage canvas").waitFor();
  await page.getByText("배치 완료", { exact: true }).waitFor();
  async function chooseTheme(name) {
    await button("설정").click();
    await button("테마").click();
    const radio = page.getByRole("radio", { name, exact: true });
    await radio.check();
    const accent = await radio.evaluate(el => getComputedStyle(el).accentColor);
    await closeSettings();
    return accent;
  }

  await button("파일 목록").click();
  await page.locator('.file-row[title="Board.canvas"]').click();
  const defaultStrokes = new Set();
  for (const theme of ["포레스트", "로즈"]) {
    await chooseTheme(theme);
    for (const edge of edges) {
      const line = page.locator(`.react-flow__edge[data-id="${edge.id}"] .react-flow__edge-path`);
      const { stroke, arrows } = await line.evaluate(el => {
        const arrows = ["marker-start", "marker-end"].map(attr => {
          const url = el.getAttribute(attr);
          const id = url.slice(url.indexOf("#") + 1, -2);
          return getComputedStyle(document.getElementById(id).querySelector("polyline")).fill;
        });
        return { stroke: getComputedStyle(el).stroke, arrows };
      });
      assert.deepEqual(arrows, [stroke, stroke]);
      if (edge.color) assert.equal(stroke, "rgb(198, 40, 40)");
      else defaultStrokes.add(stroke);
    }
  }
  assert.equal(defaultStrokes.size, 2);

  await page.locator(".file-tree").getByRole("button", { name: "Slides.pptx", exact: true }).click();
  const frame = page.frameLocator(".office-preview iframe");
  await frame.getByRole("button", { name: "다음 슬라이드" }).click();
  await frame.getByText("시험 결과", { exact: true }).first().waitFor();
  const slideContent = frame.getByText("시험 결과", { exact: true }).first();
  const originalAppearance = await slideContent.screenshot();
  const backgrounds = new Set();
  for (const theme of ["포레스트", "슬레이트"]) {
    const accent = await chooseTheme(theme);
    assert.equal(await frame.locator("#previous").evaluate(el => getComputedStyle(el).color), accent);
    backgrounds.add(await frame.locator("body").evaluate(el => getComputedStyle(el).backgroundColor));
    assert.ok(originalAppearance.equals(await slideContent.screenshot()), "Theme changes must preserve slide content");
    assert.equal(await frame.locator("#position").textContent(), "2 / 2");
  }
  assert.equal(backgrounds.size, 2);

  await page.locator('.file-row[title="Theme.md"]').click();
  await page.getByRole("tab", { name: "Copilot", exact: true }).click();
  const question = page.getByLabel("Copilot 질문", { exact: true });
  await question.focus();
  await question.press("Tab");
  const focusedMode = page.locator(".copilot-send-row select:focus-visible");
  assert.equal(await focusedMode.evaluate(el => getComputedStyle(el).outlineColor), samples.at(-1).brand);
  assert.equal(await page.locator(".copilot-input-box:focus-within").evaluate(el => getComputedStyle(el).outlineColor), samples.at(-1).brand);
  assert.deepEqual(errors, []);
  await page.reload();
  await button("설정").click();
  await button("테마").click();
  assert.equal(await page.getByRole("radio", { name: "슬레이트" }).isChecked(), true);
  assert.equal(await readFile(path.join(vault, "Theme.md"), "utf8"), markdown);
  console.log("Verified all ten themes, explicit note colors, canvas arrows, slide navigation and appearance, Copilot keyboard focus, and selection after reload.");
} finally {
  try { await app?.close(); } finally { await rm(root, { recursive: true, force: true }); }
}
