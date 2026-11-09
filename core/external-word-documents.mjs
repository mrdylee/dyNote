import { constants } from "node:fs";
import { lstat, mkdtemp, open, realpath, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { readWordContent } from "./word-documents.mjs";

const MAX_BYTES = 25 * 1024 * 1024;
const revision = ({ dev, ino, size, mtimeNs, ctimeNs }) => `${dev}:${ino}:${size}:${mtimeNs}:${ctimeNs}`;

async function sourcePath(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || !/\.docx$/i.test(value) || path.basename(value).startsWith("~$"))
    throw new Error("Word 문서(.docx)를 선택해 주세요.");
  const stat = await lstat(value);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("일반 Word 파일만 열 수 있습니다.");
  return realpath(value);
}

async function readSource(source, previousRevision) {
  await sourcePath(source);
  const handle = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile()) throw new Error("일반 Word 파일만 열 수 있습니다.");
    if (stat.size > BigInt(MAX_BYTES)) throw new Error("Word 미리보기는 25MB 이하를 지원합니다.");
    const current = revision(stat);
    if (current === previousRevision) return null;
    const chunks = [];
    let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      size += chunk.length;
      if (size > MAX_BYTES) throw new Error("Word 미리보기는 25MB 이하를 지원합니다.");
      chunks.push(chunk);
    }
    if (current !== revision(await handle.stat({ bigint: true })))
      throw new Error("읽는 중 Word 문서가 변경되었습니다. 다시 열어 주세요.");
    return { bytes: Buffer.concat(chunks), revision: current };
  } finally {
    await handle.close();
  }
}

export class ExternalWordDocuments {
  #entries = new Map();
  #tail = Promise.resolve();

  constructor(directory) { this.directory = directory; }

  #enqueue(operation) {
    const result = this.#tail.then(operation);
    this.#tail = result.catch(() => {});
    return result;
  }

  open(value) { return this.#enqueue(() => this.#open(value)); }

  async #open(value) {
    const source = await sourcePath(value);
    const data = await readSource(source);
    const directory = await mkdtemp(path.join(this.directory, "dynote-word-open-"));
    const file = path.join(directory, "document.docx");
    try {
      await writeFile(file, data.bytes, { flag: "wx", mode: 0o600 });
      const preview = await readWordContent(data.bytes, true);
      const id = randomUUID(), name = path.basename(source);
      this.#entries.set(id, { source, directory, file, name });
      return { id, name, revision: data.revision, ...preview };
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  #entry(id) {
    const entry = this.#entries.get(id);
    if (!entry) throw new Error("임시 Word 문서를 다시 열어 주세요.");
    return entry;
  }

  read(id, previousRevision) {
    return this.#enqueue(async () => {
      const entry = this.#entry(id);
      const data = await readSource(entry.source, previousRevision);
      if (!data) return null;
      await writeFile(entry.file, data.bytes, { mode: 0o600 });
      return { id, name: entry.name, revision: data.revision, ...await readWordContent(data.bytes, true) };
    });
  }

  async sourcePath(id) { await this.#tail; return sourcePath(this.#entry(id).source); }

  dispose() {
    return this.#enqueue(async () => {
      const entries = [...this.#entries.values()];
      this.#entries.clear();
      await Promise.all(entries.map(entry => rm(entry.directory, { recursive: true, force: true })));
    });
  }
}
