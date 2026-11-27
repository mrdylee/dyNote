import { link } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

function nativeExclusiveRename() {
  const koffi = createRequire(import.meta.url)("koffi");
  if (process.platform === "win32") {
    const move = koffi.load("kernel32.dll").func("int __stdcall MoveFileW(str16, str16)");
    return (from, to) => move(path.toNamespacedPath(from), path.toNamespacedPath(to)) !== 0;
  }
  if (process.platform === "darwin") {
    const move = koffi.load("/usr/lib/libSystem.B.dylib").func("int renamex_np(str, str, unsigned int)");
    return (from, to) => move(from, to, 4 /* RENAME_EXCL */) === 0;
  }
  const move = koffi.load(null).func("int renameat2(int, str, int, str, unsigned int)");
  return (from, to) => move(-100, from, -100, to, 1 /* RENAME_NOREPLACE */) === 0;
}

let renameExclusive;
// Returns true when the filesystem moved the source name as part of publication.
export async function publishFile(from, to) {
  try {
    await link(from, to);
    return false;
  } catch (error) {
    if (!["ENOTSUP", "EOPNOTSUPP", "EPERM", "ENOSYS", "EINVAL", "UNKNOWN", "EACCES"].includes(error.code)) throw error;
    renameExclusive ??= nativeExclusiveRename();
    if (!renameExclusive(from, to)) throw new Error("대상 파일을 만들 수 없습니다. 이름과 폴더 권한을 확인해 주세요.");
    return true;
  }
}
