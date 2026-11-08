import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transformWithOxc } from "vite";
import { JSDOM } from "jsdom";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";

const source = await readFile(new URL("../src/TextColorPicker.jsx", import.meta.url), "utf8");
const transformed = await transformWithOxc(source, "TextColorPicker.jsx", { jsx: { runtime: "automatic" } });
const code = transformed.code
  .replace('from "react"', `from ${JSON.stringify(import.meta.resolve("react"))}`)
  .replace('from "react/jsx-runtime"', `from ${JSON.stringify(import.meta.resolve("react/jsx-runtime"))}`)
  .replace('from "../core/text-color.mjs"', `from ${JSON.stringify(new URL("../core/text-color.mjs", import.meta.url).href)}`);
const { default: TextColorPicker } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
let dom, root;
beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>', { url: "https://dynote.test" });
  for (const key of ["window", "document", "localStorage", "Event"]) globalThis[key] = dom.window[key];
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  root = createRoot(document.getElementById("root"));
});
afterEach(async () => { await act(() => root.unmount()); dom.window.close(); });
function Harness({ disabled = false }) {
  const [value, onChange] = useState("#c62828");
  return createElement(TextColorPicker, { value, onChange, disabled });
}
const mount = async props => { await act(() => root.render(createElement(Harness, props))); };
const button = text => [...document.querySelectorAll("button")].find(node => node.textContent === text);
const sample = () => {
  const control = button("화면에서 색 가져오기");
  assert.ok(control, "Screen eyedropper button must be present");
  return control;
};

test("a sampled screen color becomes selectable and can be explicitly saved", async () => {
  window.EyeDropper = class { open() { return Promise.resolve({ sRGBHex: "#1A7B9C" }); } };
  await mount();
  await act(async () => { sample().click(); });
  assert.equal(document.querySelector("summary").title, "#1a7b9c");
  assert.equal(document.querySelector("details").open, true);
  assert.equal(localStorage.getItem("dynote.textColors"), null);
  await act(async () => { button("색상 저장").click(); });
  assert.deepEqual(JSON.parse(localStorage.getItem("dynote.textColors")), ["#1a7b9c"]);
  assert.ok(document.querySelector('[aria-label="저장한 색 #1a7b9c"]'));
});
test("Escape cancellation leaves the selected color and saved palette unchanged", async () => {
  window.EyeDropper = class { open() { return Promise.reject(new DOMException("Cancelled", "AbortError")); } };
  await mount();
  await act(async () => { sample().click(); });
  assert.equal(document.querySelector("summary").title, "#c62828");
  assert.equal(localStorage.getItem("dynote.textColors"), null);
  assert.equal(document.querySelector('[role="alert"]'), null);
  assert.equal(sample().disabled, false);
});
test("screen sampling failures give feedback and allow retry", async () => {
  window.EyeDropper = class { open() { return Promise.reject(new Error("Unavailable")); } };
  await mount();
  await act(async () => { sample().click(); });
  assert.match(document.querySelector('[role="alert"]').textContent, /색.*가져오지 못/);
  assert.equal(sample().disabled, false);
  assert.equal(document.querySelector("summary").title, "#c62828");
});
test("unsupported environments and read-only editors cannot start screen sampling", async () => {
  await mount();
  assert.equal(sample().disabled, true);
  assert.match(document.body.textContent, /지원하지 않/);
  let calls = 0;
  window.EyeDropper = class { open() { calls++; } };
  await mount({ disabled: true });
  await act(async () => { sample().click(); });
  assert.equal(sample().disabled, true);
  assert.equal(calls, 0);
});
test("sampling is disabled while open and is cancelled when its editor unmounts", async () => {
  let signal;
  window.EyeDropper = class { open(options) { signal = options.signal; return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")))); } };
  await mount();
  await act(async () => { sample().click(); });
  assert.equal(sample().disabled, true);
  await act(() => root.render(null));
  assert.equal(signal.aborted, true);
});
