import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

const revision = ({ dev, ino, size, mtimeNs, ctimeNs }) => `${dev}:${ino}:${size}:${mtimeNs}:${ctimeNs}`;

export async function sourcePath(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || path.basename(value).startsWith("~$"))
    throw new Error("디스크에 저장된 파일을 선택해 주세요.");
  const stat = await lstat(value);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("일반 파일만 열 수 있습니다.");
  return realpath(value);
}

export async function readSource(source, previousRevision, maxBytes) {
  await sourcePath(source);
  const handle = await open(source, constants.O_RDONLY | (process.platform === "darwin" ? 0x20000000 : (constants.O_NOFOLLOW ?? 0)));
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile()) throw new Error("일반 파일만 열 수 있습니다.");
    const sizeError = () => new Error(`이 파일의 미리보기는 ${maxBytes / (1024 * 1024)}MB 이하를 지원합니다.`);
    if (maxBytes !== Infinity && stat.size > BigInt(maxBytes)) throw sizeError();
    const current = revision(stat);
    if (current === previousRevision) return null;
    const chunks = [];
    let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      size += chunk.length;
      if (size > maxBytes) throw sizeError();
      chunks.push(chunk);
    }
    if (current !== revision(await handle.stat({ bigint: true })))
      throw new Error("읽는 중 파일이 변경되었습니다. 다시 열어 주세요.");
    return { bytes: Buffer.concat(chunks), revision: current };
  } finally {
    await handle.close();
  }
}

export function decodePreviewText(bytes) {
  let content;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (content.includes("\0")) throw new Error();
  } catch { throw new Error("지원하지 않는 파일 형식이거나 UTF-8 텍스트가 아닙니다."); }
  return content;
}
