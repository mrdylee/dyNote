import test from "node:test";
import assert from "node:assert/strict";
import { defaultFonts, normalizeFonts, fontVariables } from "../core/font-preferences.mjs";
import { allowFontPermission } from "../core/security.mjs";

test("font preferences recover invalid storage and bound sizes without changing valid choices", () => {
  assert.deepEqual(normalizeFonts(null), defaultFonts);
  const fonts = normalizeFonts({ bodyFamily: "나눔명조", codeFamily: "D2Coding", uiSize: 900, bodySize: 19, lineHeight: -1, uiFamily: "bad\nfont" });
  assert.equal(fonts.bodyFamily, "나눔명조");
  assert.equal(fonts.codeFamily, "D2Coding");
  assert.equal(fonts.bodySize, 19);
  assert.equal(fonts.uiSize, defaultFonts.uiSize);
  assert.equal(fonts.lineHeight, defaultFonts.lineHeight);
  assert.equal(fonts.uiFamily, "");
  assert.equal(normalizeFonts({ bodyFamily: "Times New " }).bodyFamily, "Times New ");
});

test("font styles quote family names and retain readable fallback stacks", () => {
  const vars = fontVariables(normalizeFonts({ bodyFamily: 'Font "A", serif', codeSize: 15 }));
  assert.ok(vars["--body-font"].startsWith('"Font \\"A\\", serif",'));
  assert.ok(vars["--body-font"].endsWith("sans-serif"));
  assert.ok(vars["--code-font"].endsWith("monospace"));
  assert.equal(vars["--code-size"], "15px");
});

test("local font permission is limited to the trusted application main frame", () => {
  assert.equal(allowFontPermission("local-fonts", "notes://app/index.html", true), true);
  for (const [permission, url, main] of [
    ["camera", "notes://app/index.html", true],
    ["local-fonts", "https://example.org", true],
    ["local-fonts", "notes://app/index.html", false],
  ]) assert.equal(allowFontPermission(permission, url, main), false);
});
