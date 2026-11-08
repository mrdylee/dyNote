import { readFile, readdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { extractFile, listPackage } from "@electron/asar";
import { Data, NtExecutable, NtExecutableResource, Resource } from "resedit";
import assert from "node:assert/strict";

const version = JSON.parse(await readFile("package.json", "utf8")).version;
const packageRoot = process.env.DYNOTE_PACKAGE_OUT || `release/v${version}`;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const extract = (archive, file) => extractFile(archive, path.normalize(file));
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
const packages = [
  ["darwin-arm64", "Dynote-darwin-arm64/Dynote.app/Contents/Resources/app.asar"],
  ["win32-x64", "Dynote-win32-x64/resources/app.asar"],
];
const selected = process.argv[2];
if (selected && !packages.some(([platform]) => platform === selected)) throw new Error("Choose darwin-arm64 or win32-x64.");
for (const [platform, relative] of packages.filter(([platform]) => !selected || selected === platform)) {
  const archive = `${packageRoot}/${relative}`;
  if (platform === "darwin-arm64") {
    const app = path.join(packageRoot, "Dynote-darwin-arm64", "Dynote.app");
    execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], { stdio: "pipe" });
    const iconFile = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print CFBundleIconFile", path.join(app, "Contents", "Info.plist")], { encoding: "utf8" }).trim();
    assert.deepEqual(await readFile(path.join(app, "Contents", "Resources", iconFile)), await readFile("branding/dynote.icns"), "Dynote.app must embed the approved icon");
  } else {
    const exe = NtExecutable.from(await readFile(path.join(packageRoot, "Dynote-win32-x64", "Dynote.exe")));
    const { entries } = NtExecutableResource.from(exe);
    const groups = Resource.IconGroupEntry.fromEntries(entries);
    assert.equal(groups.length, 1, "Dynote.exe must contain one application icon group");
    const fingerprint = icon => ({
      width: icon.width || 256,
      height: icon.height || 256,
      sha256: hash(Buffer.from(icon.bin)),
    });
    const embedded = groups[0].getIconItemsFromEntries(entries).map(fingerprint);
    const expected = Data.IconFile.from(await readFile("branding/dynote.ico")).icons.map(({ data }) => fingerprint(data));
    assert.deepEqual(embedded, expected, "Dynote.exe must embed the approved icon at every size");
  }
  const contents = listPackage(archive).map(name => name.replaceAll("\\", "/"));
  assert.ok(!contents.some((name) => name.includes("graph-simulation.wasm")));
  const runtimes = contents.filter(name => /^\/node_modules\/@github\/copilot-sdk-[^/]+$/.test(name));
  assert.deepEqual(runtimes, [`/node_modules/@github/copilot-sdk-${platform}`], "Package only the target Copilot runtime");
  const runtime = `node_modules/@github/copilot-sdk-${platform}/prebuilds/${platform}`;
  await access(path.join(`${archive}.unpacked`, runtime, platform.startsWith("win32") ? "copilot-runtime.exe" : "copilot-runtime"));
  await access(path.join(`${archive}.unpacked`, runtime, "runtime.node"));
  assert.ok(!contents.some((name) => /^\/(?:research|output|tests|docs|assembly|src|public|examples)\//.test(name)));
  assert.ok(!contents.includes("/HANDOFF.md"), "local session handoff must not ship");
  for (const file of sources)
    assert.deepEqual(extract(archive, file), await readFile(file), `${platform}: ${file}`);
  const metadata = JSON.parse(extract(archive, "package.json"));
  assert.equal(metadata.version, version);
  assert.equal(metadata.productName, "Dynote");
  const source = JSON.parse(await readFile("package.json", "utf8"));
  assert.deepEqual(metadata.dependencies, source.dependencies);
  assert.equal(JSON.parse(extract(archive, "node_modules/zod/package.json")).version, source.overrides["@github/copilot-sdk"].zod);
  assert.ok(!contents.includes('/dist/ess.html'), 'The removed ESS viewer must not ship');
  assert.ok(!contents.some(name => name.startsWith('/dist/ess/')), 'Unused ESS model assets must not ship');
  assert.ok(contents.includes('/licenses/three.txt'));
  const wasm = contents.find((name) => /^\/dist\/assets\/graph-.*\.wasm$/.test(name));
  assert.ok(wasm);
  assert.ok(contents.some((name) => /^\/dist\/assets\/graph.worker-.*\.js$/.test(name)));
  report.packages.push({ platform, asarSha256: hash(await readFile(archive)), matchedSourceAndBundleFiles: sources.length, wasmSha256: hash(extract(archive, wasm.slice(1))), copilotRuntimeIncluded: true });
}
await writeFile(process.env.DYNOTE_PACKAGE_REPORT || (process.env.DYNOTE_PACKAGE_OUT ? "docs/verification/copilot-package.json" : `docs/verification/dynote-v${version}-release-package.json`), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
