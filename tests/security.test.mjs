import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { assetPath, safeExternalUrl, trustedFrame } from "../core/security.mjs";

test("app protocol serves only bundled assets inside the distribution folder", () => {
  assert.equal(
    assetPath("notes://app/index.html", "/safe/dist"),
    resolve("/safe/dist/index.html"),
  );
  assert.equal(
    assetPath("notes://app/assets/app.js", "/safe/dist"),
    resolve("/safe/dist/assets/app.js"),
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

test('ESS frame serves bundled assets and exactly the ESS model, without native trust', () => {
  assert.equal(assetPath('notes://ess/ess.html','/safe/dist'),resolve('/safe/dist/ess.html'));
  assert.equal(assetPath('notes://ess/assets/ess-a1.js','/safe/dist'),resolve('/safe/dist/assets/ess-a1.js'));
  assert.equal(assetPath('notes://ess/ess/ess-container.glb','/safe/dist'),resolve('/safe/dist/ess/ess-container.glb'));
  for(const url of ['notes://ess/index.html','notes://ess/plugin.html','notes://ess/secret.glb','notes://ess/ess/other.glb','notes://app/secret.glb','notes://ess/ess/%2e%2e/private.glb','notes://ess/ess/ess-container.glb?path=secret','notes://ess/ess/ess-container.glb#x'])assert.throws(()=>assetPath(url,'/safe/dist'));
  assert.equal(trustedFrame('notes://ess/ess.html',true),false);
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
  assert.equal(assetPath("notes://app/assets/graph.wasm", "/safe/dist"), resolve("/safe/dist/assets/graph.wasm"));
  for (const url of ["notes://vault/graph.wasm", "notes://app/%2e%2e%2fgraph.wasm", "notes://app/.hidden/graph.wasm", "notes://app/secret.dll"])
    assert.throws(() => assetPath(url, "/safe/dist"));
});

test('CORE-AUDIO permits audio only for the exact main application frame',async()=>{
 const tools=await import('../core/security.mjs');assert.equal(typeof tools.allowAudioPermission,'function');
 assert.equal(tools.allowAudioPermission('media','notes://app/index.html',true,['audio']),true);
 for(const [permission,url,main,types] of [['media','https://example.test',true,['audio']],['media','notes://app/index.html',false,['audio']],['media','notes://app/index.html',true,['audio','video']],['media','notes://app/index.html',true,['unknown']],['media','notes://app/index.html',true,[]],['camera','notes://app/index.html',true,['audio']]])assert.equal(tools.allowAudioPermission(permission,url,main,types),false);
});
test('CORE-WEB only permits credential-free HTTP/HTTPS viewer URLs',async()=>{
 const tools=await import('../core/security.mjs');assert.equal(typeof tools.safeWebViewerUrl,'function');
 assert.equal(tools.safeWebViewerUrl('https://example.test/page'),'https://example.test/page');
 for(const url of ['javascript:alert(1)','file:///private/note.md','mailto:test@example.test','https://user:secret@example.test','data:text/html,hello'])assert.throws(()=>tools.safeWebViewerUrl(url));
});
