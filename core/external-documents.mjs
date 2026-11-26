import { officeKind, isOfficeKind } from "./office-types.mjs";
import { officePreview } from "./office-package.mjs";
import { readSource, sourcePath, decodePreviewText } from "./file-source.mjs";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { readWordContent } from "./word-documents.mjs";
import { attachmentMime, validateAttachment, decodeHtml } from "./attachments.mjs";
import { documentKind, validateDocument } from "./documents.mjs";

const extension = name => path.extname(name).slice(1).toLowerCase();
const kind = name => /\.html?$/i.test(name) ? "html" : /\.(md|markdown)$/i.test(name) ? "markdown" : /\.docx$/i.test(name) ? "word" : officeKind(name) ?? documentKind(name) ??
  (attachmentMime(name)?.startsWith("image/") ? "image" : attachmentMime(name)?.startsWith("audio/") ? "audio" : /\.pdf$/i.test(name) ? "pdf" : "text");
const limit = name => kind(name) === "markdown" ? Infinity : ["canvas", "base"].includes(kind(name)) ? 8 * 1024 * 1024 : 25 * 1024 * 1024;
const sourceExtensions = new Set(["md", "markdown", "docx", "xlsx", "pptx", "canvas", "base", "txt", "text", "log", "json", "jsonl", "csv", "tsv", "yaml", "yml", "xml", "ini", "cfg", "conf", "toml", "pdf", "png", "jpg", "jpeg", "gif", "webp", "webm", "wav", "mp3", "ogg", "m4a"]);

async function preview(name, bytes) {
  const type = kind(name), canOpenSource = sourceExtensions.has(extension(name));
  if (isOfficeKind(type)) return { ...await officePreview(type, bytes), canOpenSource };
  if (type === "word") return { kind: type, canOpenSource, ...await readWordContent(bytes, true) };
  if (["image", "audio", "pdf"].includes(type))
    return { kind: type, canOpenSource, mime: validateAttachment(name, bytes), bytes };
  const content = type === "html" ? decodeHtml(bytes) : decodePreviewText(bytes);
  if (["canvas", "base"].includes(type)) validateDocument(name, content);
  return { kind: type, canOpenSource, content, path: name };
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
    const data = await readSource(source, undefined, limit(source));
    for (const [id, entry] of this.#entries) {
      if (entry.source === source) return this.#update(id, entry, data);
    }
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
      const data = await readSource(entry.source, previousRevision, limit(entry.source));
      if (!data) return null;
      return this.#update(id, entry, data);
    });
  }

  async #update(id, entry, data) {
    const converted = await preview(entry.name, data.bytes);
    const pending = entry.file + ".refresh";
    await writeFile(pending, data.bytes, { mode: 0o600 });
    await rename(pending, entry.file);
    return { id, name: entry.name, revision: data.revision, ...converted };
  }

  copyToVault(id, vault, folder) {
    return this.#enqueue(() => {
      const entry = this.#entry(id);
      return vault.transferDroppedFile(entry.file, folder, "copy", entry.name);
    });
  }

  close(id) {
    return this.#enqueue(async () => {
      const entry = this.#entries.get(id);
      if (!entry) return;
      await rm(entry.directory, { recursive: true, force: true });
      this.#entries.delete(id);
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
