import { packager } from "@electron/packager";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, access, mkdtemp, cp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const platform = process.argv[2];
if (!["darwin", "win32", "linux"].includes(platform)) throw new Error("Choose darwin, win32 or linux.");
const arch = platform === "darwin" ? "arm64" : "x64";
const metadata = JSON.parse(await readFile("package.json", "utf8"));
const sdkVersion = metadata.dependencies["@github/copilot-sdk"];
const runtimePackage = `@github/copilot-sdk-${platform}-${arch}`;
const installTargetRuntime = async (buildPath) => {
  const runtimeRoot = path.join(buildPath, "node_modules", runtimePackage);
  // npm installs optional native dependencies only for the build host. When
  // cross-packaging, install the matching runtime into the temporary copy.
  if (platform !== process.platform || arch !== process.arch) {
    if (!process.env.npm_execpath) throw new Error("Run desktop packaging through npm run package:mac/win/linux.");
    const staging = await mkdtemp(path.join(tmpdir(), "dynote-target-runtime-"));
    try {
      await writeFile(path.join(staging, "package.json"), '{"private":true}');
      // The binary is for the target OS; --force permits acquiring it on the
      // build host. No lifecycle scripts or target binaries are executed.
      await promisify(execFile)(process.execPath, [
        process.env.npm_execpath, "install", "--no-save", "--package-lock=false",
        "--ignore-scripts", "--force", "--no-audit", "--no-fund", `${runtimePackage}@${sdkVersion}`,
      ], { cwd: staging, maxBuffer: 4 * 1024 * 1024 });
      await cp(path.join(staging, "node_modules", runtimePackage), runtimeRoot, { recursive: true });
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
  await access(path.join(runtimeRoot, "prebuilds", `${platform}-${arch}`, platform === "win32" ? "copilot-runtime.exe" : "copilot-runtime"));
};
const outputs = await packager({
  dir: ".", name: "Dynote", platform, arch,
  out: process.env.DYNOTE_PACKAGE_OUT || `release/v${metadata.version}`,
  overwrite: true,
  extendInfo: platform === "darwin" ? { NSMicrophoneUsageDescription: "선택한 보관함에 음성을 녹음하려면 마이크 사용을 허용해 주세요." } : undefined,
  asar: { unpackDir: "node_modules/{@github/copilot-sdk-*,koffi}/**" },
  ignore: /^\/(?:(src|tests|docs|release|assembly|scripts|output|examples|node_modules\/@napi-rs)(\/|$)|HANDOFF\.md$)/,
  afterPrune: [async ({ buildPath }) => installTargetRuntime(buildPath)],
});
console.log(outputs.join("\n"));
