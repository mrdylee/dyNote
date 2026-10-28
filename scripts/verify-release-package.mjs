import { readFile, readdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { extractFile, listPackage } from "@electron/asar";
import assert from "node:assert/strict";

const version = JSON.parse(await readFile("package.json", "utf8")).version;
const packageRoot = process.env.DYNOTE_PACKAGE_OUT || `release/v${version}`;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    result.push(...(entry.isDirectory() ? await files(path) : [path]));
  }
  return result;
}
const sources = ["README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"];
for (const directory of ["core", "electron", "dist", "licenses"])
  sources.push(...await files(directory));
const report = { version, packages: [], windowsRuntimeTested: false, distributionSigned: false, notarized: false };
for (const [platform, relative] of [
  ["darwin-arm64", "Dynote-darwin-arm64/Dynote.app/Contents/Resources/app.asar"],
  ["win32-x64", "Dynote-win32-x64/resources/app.asar"],
]) {
  const archive = `${packageRoot}/${relative}`;
  if (platform === "darwin-arm64") {
    execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", `${packageRoot}/Dynote-darwin-arm64/Dynote.app`], { stdio: "pipe" });
  }
  const contents = listPackage(archive);
  assert.ok(!contents.some((name) => name.includes("graph-simulation.wasm")));
  const runtime = `node_modules/@github/copilot-sdk-${platform}/prebuilds/${platform}`;
  await access(path.join(`${archive}.unpacked`, runtime, platform.startsWith("win32") ? "copilot-runtime.exe" : "copilot-runtime"));
  await access(path.join(`${archive}.unpacked`, runtime, "runtime.node"));
  assert.ok(!contents.some((name) => /^\/(?:research|output|tests|docs|assembly|src|public|examples)\//.test(name)));
  assert.ok(!contents.includes("/HANDOFF.md"), "local session handoff must not ship");
  for (const file of sources)
    assert.deepEqual(extractFile(archive, file), await readFile(file), `${platform}: ${file}`);
  const metadata = JSON.parse(extractFile(archive, "package.json"));
  assert.equal(metadata.version, version);
  assert.equal(metadata.productName, "Dynote");
  assert.ok(contents.includes('/dist/ess.html'));
  assert.deepEqual(extractFile(archive, 'dist/ess/ess-container.glb'), await readFile('public/ess/ess-container.glb'));
  assert.ok(contents.includes('/licenses/three.txt'));
  const wasm = contents.find((name) => /^\/dist\/assets\/graph-.*\.wasm$/.test(name));
  assert.ok(wasm);
  assert.ok(contents.some((name) => /^\/dist\/assets\/graph.worker-.*\.js$/.test(name)));
  report.packages.push({ platform, asarSha256: hash(await readFile(archive)), matchedSourceAndBundleFiles: sources.length, wasmSha256: hash(extractFile(archive, wasm.slice(1))), copilotRuntimeIncluded: true });
}
await writeFile(process.env.DYNOTE_PACKAGE_REPORT || (process.env.DYNOTE_PACKAGE_OUT ? "docs/verification/copilot-package.json" : `docs/verification/dynote-v${version}-release-package.json`), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
