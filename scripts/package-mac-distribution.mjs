// Build the installable disk image and updater-compatible ZIP from a verified Mac bundle.
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

if (process.platform !== "darwin") throw new Error("Build Mac distribution files on macOS.");
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const output = path.resolve(`release/v${version}`);
const app = path.join(output, "Dynote-darwin-arm64", "Dynote.app");
execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
const staging = await mkdtemp(path.join(tmpdir(), "dynote-dmg-"));
try {
  execFileSync("ditto", [app, path.join(staging, "Dynote.app")]);
  await symlink("/Applications", path.join(staging, "Applications"));
  await writeFile(path.join(staging, "설치 안내.txt"), `Dynote ${version} · Apple Silicon Mac\n\n1. Dynote 앱을 Applications 폴더로 끌어 넣으세요.\n2. 기존 Dynote를 종료하고 응용 프로그램 폴더의 Dynote를 실행하세요.\n3. 디스크 이미지는 설치 후 추출해도 됩니다. 노트 보관함과 기존 설정은 유지됩니다.\n\n이 시험판은 앱 무결성 서명을 적용했지만 Apple 배포 공증은 없습니다.\nmacOS가 개발자를 확인할 수 없다고 안내하면, 배포 출처와 체크섬을 확인한 후\n시스템 설정 > 개인정보 보호 및 보안에서 이 앱의 열기 허용 여부를 직접 결정하세요.\n보안 기능 전체를 끄거나 자동으로 보안 검사를 우회하는 설치 스크립트는 포함하지 않습니다.\n\n공식 배포: https://github.com/mrdylee/dyNote/releases/tag/v${version}\n`);
  const dmg = path.join(output, `Dynote-${version}-macos-arm64.dmg`);
  const zip = path.join(output, `Dynote-${version}-macos-arm64.zip`);
  execFileSync("hdiutil", ["create", "-volname", `Dynote ${version}`, "-srcfolder", staging, "-fs", "HFS+", "-format", "UDZO", "-ov", dmg], { stdio: "inherit" });
  execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip]);
  const checksums = [];
  for (const file of [dmg, zip]) checksums.push(`${createHash("sha256").update(await readFile(file)).digest("hex")}  ${path.basename(file)}`);
  await writeFile(path.join(output, "SHA256SUMS-macos-arm64.txt"), checksums.join("\n") + "\n");
  console.log(checksums.join("\n"));
} finally { await rm(staging, { recursive: true, force: true }); }
