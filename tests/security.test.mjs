import test from "node:test";
import assert from "node:assert/strict";
import { assetPath, safeExternalUrl, trustedFrame } from "../core/security.mjs";

test("app protocol serves only bundled assets inside the distribution folder", () => {
  assert.equal(
    assetPath("notes://app/index.html", "/safe/dist"),
    "/safe/dist/index.html",
  );
  assert.equal(
    assetPath("notes://app/assets/app.js", "/safe/dist"),
    "/safe/dist/assets/app.js",
  );
  for (const url of [
    "file:///etc/passwd",
    "notes://other/index.html",
    "notes://app/%2fetc%2fpasswd",
    "notes://app/%2e%2e%2fsecret.txt",
    "notes://app/a%5cb.js",
  ]) {
    assert.throws(() => assetPath(url, "/safe/dist"));
  }
});

test("only an exact main-frame application origin can invoke native operations", () => {
  assert.equal(trustedFrame("notes://app/index.html", true), true);
  assert.equal(trustedFrame("notes://app/index.html", false), false);
  assert.equal(trustedFrame("https://example.org", true), false);
  assert.equal(trustedFrame("notes://app/elsewhere.html", true), false);
});

test("explicit external links cannot invoke operating system handlers or executable URLs", () => {
  assert.equal(
    safeExternalUrl("https://example.org/page"),
    "https://example.org/page",
  );
  assert.equal(
    safeExternalUrl("mailto:test@example.org"),
    "mailto:test@example.org",
  );
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "obsidian://open",
    "https://user:pass@example.org",
    "https://x\n.invalid",
    "data:text/html,x",
  ]) {
    assert.throws(() => safeExternalUrl(url));
  }
});

test("bundled WASM is allowed without widening vault or traversal access", () => {
  assert.equal(assetPath("notes://app/assets/graph.wasm", "/safe/dist"), "/safe/dist/assets/graph.wasm");
  for (const url of ["notes://vault/graph.wasm", "notes://app/%2e%2e%2fgraph.wasm", "notes://app/.hidden/graph.wasm", "notes://app/secret.dll"])
    assert.throws(() => assetPath(url, "/safe/dist"));
});
