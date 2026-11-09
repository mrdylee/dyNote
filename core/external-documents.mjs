import { constants } from "node:fs";
import { lstat, mkdtemp, open, realpath, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { readWordContent } from "./word-documents.mjs";
import { attachmentMime, validateAttachment } from "./attachments.mjs";
import { documentKind, validateDocument } from "./documents.mjs";

const extension = name => path.extname(name).slice(1).toLowerCase();
const kind = name => /\.(md|markdown)$/i.test(name) ? "markdown" : /\.docx$/i.test(name) ? "word" : documentKind(name) ??
  (attachmentMime(name)?.startsWith("image/") ? "image" : attachmentMime(name)?.startsWith("audio/") ? "audio" : /\.pdf$/i.test(name) ? "pdf" : "text");
const limit = name => kind(name) === "markdown" ? Infinity : ["canvas", "base"].includes(kind(name)) ? 8 * 1024 * 1024 : 25 * 1024 * 1024;
const sourceExtensions = new Set(["md", "markdown", "docx", "canvas", "base", "txt", "text", "log", "json", "jsonl", "csv", "tsv", "yaml", "yml", "xml", "ini", "cfg", "conf", "toml", "pdf", "png", "jpg", "jpeg", "gif", "webp", "webm", "wav", "mp3", "ogg", "m4a"]);
const revision = ({ dev, ino, size, mtimeNs, ctimeNs }) => `${dev}:${ino}:${size}:${mtimeNs}:${ctimeNs}`;

async function preview(name, bytes) {
  const type = kind(name), canOpenSource = sourceExtensions.has(extension(name));
  if (type === "word") return { kind: type, canOpenSource, ...await readWordContent(bytes, true) };
  if (["image", "audio", "pdf"].includes(type))
    return { kind: type, canOpenSource, mime: validateAttachment(name, bytes), bytes };
  let content;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (content.includes("\0")) throw new Error();
  } catch { throw new Error("지원하지 않는 파일 형식이거나 UTF-8 텍스트가 아닙니다."); }
  if (["canvas", "base"].includes(type)) validateDocument(name, content);
  return { kind: type, canOpenSource, content, path: name };
}

async function sourcePath(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || path.basename(value).startsWith("~$"))
    throw new Error("디스크에 저장된 파일을 선택해 주세요.");
  const stat = await lstat(value);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("일반 파일만 열 수 있습니다.");
  return realpath(value);
}

async function readSource(source, previousRevision) {
  await sourcePath(source);
  const handle = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile()) throw new Error("일반 파일만 열 수 있습니다.");
    const maxBytes = limit(source);
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

export class ExternalDocuments {
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
    const directory = await mkdtemp(path.join(this.directory, "dynote-file-open-"));
    const file = path.join(directory, "document" + path.extname(source).toLowerCase());
    try {
      await writeFile(file, data.bytes, { flag: "wx", mode: 0o600 });
      const converted = await preview(path.basename(source), data.bytes);
      const id = randomUUID(), name = path.basename(source);
      this.#entries.set(id, { source, directory, file, name });
      return { id, name, revision: data.revision, ...converted };
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  #entry(id) {
    const entry = this.#entries.get(id);
    if (!entry) throw new Error("임시 문서를 다시 열어 주세요.");
    return entry;
  }

  read(id, previousRevision) {
    return this.#enqueue(async () => {
      const entry = this.#entry(id);
      const data = await readSource(entry.source, previousRevision);
      if (!data) return null;
      const converted = await preview(entry.name, data.bytes);
      await writeFile(entry.file, data.bytes, { mode: 0o600 });
      return { id, name: entry.name, revision: data.revision, ...converted };
    });
  }

  async sourcePath(id) {
    await this.#tail;
    const source = this.#entry(id).source;
    if (!sourceExtensions.has(extension(source))) throw new Error("이 형식의 원본은 편집기에서 열어 주세요.");
    return sourcePath(source);
  }

  dispose() {
    return this.#enqueue(async () => {
      const entries = [...this.#entries.values()];
      this.#entries.clear();
      await Promise.all(entries.map(entry => rm(entry.directory, { recursive: true, force: true })));
    });
  }
}
