import {
  open,
  realpath,
  lstat,
  readdir,
  mkdir,
  rename,
  unlink,
  writeFile,
  readFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { rewriteLinks } from "./links.mjs";
import { documentKind, initialDocument, validateDocument } from "./documents.mjs";
import { rewriteCanvas } from "./canvas.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const MAX_BYTES = 8 * 1024 * 1024;

export function validFilePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length < 1024 &&
    !/[\\\0]/.test(value) &&
    !path.isAbsolute(value) &&
    !/^[a-z]:/i.test(value) &&
    value
      .split("/")
      .every(
        (part) =>
          part &&
          !part.startsWith(".") &&
          !/[<>:"|?*]/.test(part) &&
          !/[. ]$/.test(part) &&
          !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      ) &&
    /\.(?:md|canvas|base|png|jpe?g|gif|webp|pdf)$/i.test(value)
  );
}

export const validNotePath = (value) =>
  validFilePath(value) && /\.md$/i.test(value);
export const attachmentMime = (name) =>
  ({
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    pdf: "application/pdf",
  })[name.split(".").at(-1)?.toLowerCase()];

export class Vault {
  #tail = Promise.resolve();

  static async open(root, recoveryRoot) {
    const canonical = await realpath(root);
    if (!(await lstat(canonical)).isDirectory())
      throw new Error("폴더를 선택해 주세요.");
    return new Vault(canonical, recoveryRoot);
  }

  constructor(root, recoveryRoot) {
    this.root = root;
    this.id = digest(root).slice(0, 16);
    this.name = path.basename(root);
    this.recoveryRoot = path.join(recoveryRoot, this.id);
  }

  #enqueue(operation) {
    const result = this.#tail.then(operation);
    this.#tail = result.catch(() => {});
    return result;
  }

  async #file(relative, createParents = false) {
    if (!validFilePath(relative))
      throw new Error("허용되지 않는 Markdown 경로입니다.");
    const parts = relative.split("/");
    let parent = this.root;
    for (const part of parts.slice(0, -1)) {
      parent = path.join(parent, part);
      if (createParents)
        await mkdir(parent).catch((error) => {
          if (error.code !== "EEXIST") throw error;
        });
      const stat = await lstat(parent);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error("심볼릭 링크 경로는 열 수 없습니다.");
    }
    const canonical = await realpath(parent);
    if (canonical !== this.root && !canonical.startsWith(this.root + path.sep))
      throw new Error("보관함 밖 경로입니다.");
    const target = path.join(parent, parts.at(-1));
    try {
      const stat = await lstat(target);
      if (stat.isSymbolicLink() || !stat.isFile())
        throw new Error("일반 Markdown 파일만 열 수 있습니다.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return target;
  }

  async #read(relative) {
    const target = await this.#file(relative);
    const handle = await open(
      target,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const stat = await handle.stat();
      if (stat.size > MAX_BYTES)
        throw new Error("8MB보다 큰 문서는 이 버전에서 열 수 없습니다.");
      const bytes = await handle.readFile();
      const content = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes);
      return { path: relative, content, revision: digest(bytes), metadata: { size: stat.size, mtime: stat.mtimeMs, ctime: stat.birthtimeMs }, ...(documentKind(relative) ? { kind: documentKind(relative) } : {}) };
    } finally {
      await handle.close();
    }
  }

  async snapshot() {
    await this.#tail;
    return this.#snapshot();
  }

  async #snapshot() {
    const notes = [];
    const warnings = [];
    const attachments = [];
    const documents = [];
    const walk = async (directory, prefix = "") => {
      const items = await readdir(directory, { withFileTypes: true });
      for (const item of items) {
        if (item.name.startsWith(".") || item.isSymbolicLink()) continue;
        const relative = prefix + item.name;
        if (item.isDirectory()) {
          try {
            await walk(path.join(directory, item.name), relative + "/");
          } catch {
            warnings.push(`${relative}: 읽을 수 없는 폴더`);
          }
        } else if (item.isFile() && attachmentMime(item.name)) {
          if (validFilePath(relative)) attachments.push({ path: relative });
        } else if (item.isFile() && /\.(?:md|canvas|base)$/i.test(item.name)) {
          try {
            (documentKind(relative) ? documents : notes).push(await this.#read(relative));
          } catch (error) {
            warnings.push(`${relative}: ${error.message}`);
          }
        }
      }
    };
    await walk(this.root);
    notes.sort((a, b) => a.path.localeCompare(b.path, "ko"));
    documents.sort((a, b) => a.path.localeCompare(b.path, "ko"));
    return { id: this.id, name: this.name, notes, documents, attachments, warnings };
  }

  create(relative) {
    return this.#enqueue(async () => {
      if (!validNotePath(relative))
        throw new Error("허용되지 않는 Markdown 경로입니다.");
      const target = await this.#file(relative, true);
      const content = `# ${path.basename(relative, ".md")}\n\n`;
      try {
        await writeFile(target, content, { flag: "wx", mode: 0o600 });
      } catch (error) {
        if (error.code === "EEXIST")
          throw new Error("같은 이름의 문서가 이미 있습니다.");
        throw error;
      }
      return {
        path: relative,
        content,
        revision: digest(Buffer.from(content)),
      };
    });
  }

  save(relative, content, expectedRevision) {
    return this.#enqueue(() => {
      if (!validNotePath(relative)) throw new Error("Markdown 문서만 저장할 수 있습니다.");
      return this.#save(relative, content, expectedRevision);
    });
  }

  createDocument(relative) {
    return this.#enqueue(async () => {
      if (!validFilePath(relative) || !documentKind(relative)) throw new Error("Canvas 또는 Bases 경로여야 합니다.");
      const content = initialDocument(relative);
      await writeFile(await this.#file(relative, true), content, { flag: "wx", mode: 0o600 });
      return { path: relative, content, revision: digest(Buffer.from(content)), kind: documentKind(relative) };
    });
  }

  saveDocument(relative, content, expectedRevision) {
    return this.#enqueue(() => {
      if (!documentKind(relative)) throw new Error("Canvas 또는 Bases 파일이어야 합니다.");
      return this.#save(relative, content, expectedRevision);
    });
  }

  async #save(relative, content, expectedRevision) {
    if (!validFilePath(relative) || (!validNotePath(relative) && !documentKind(relative)))
      throw new Error("저장할 수 없는 문서 형식입니다.");
    if (typeof content !== "string" || Buffer.byteLength(content) > MAX_BYTES)
      throw new Error("문서는 8MB 이하여야 합니다.");
    if (documentKind(relative)) validateDocument(relative, content);
    const current = await this.#read(relative);
    if (current.revision !== expectedRevision)
      throw new Error(
        "외부에서 문서가 변경되었습니다. 초안을 복사한 뒤 새로고침해 주세요.",
      );
    if (current.content === content) return current;
    const target = await this.#file(relative);
    const backups = path.join(this.recoveryRoot, digest(relative).slice(0, 16));
    await mkdir(backups, { recursive: true, mode: 0o700 });
    const backup = path.join(
      backups,
      `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}${path.extname(relative)}`,
    );
    await writeFile(backup, current.content, { flag: "wx", mode: 0o600 });
    const temporary = path.join(
      path.dirname(target),
      `.open-notes-${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
      // Check again after backup/temp IO so normal external edits cannot be silently lost.
      if ((await this.#read(relative)).revision !== current.revision)
        throw new Error(
          "저장 중 외부 변경이 감지되었습니다. 초안을 보관해 주세요.",
        );
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    return {
      path: relative,
      content,
      revision: digest(Buffer.from(content)),
      ...(documentKind(relative) ? { kind: documentKind(relative) } : {}),
    };
  }

  async #binary(relative) {
    const target = await this.#file(relative);
    const handle = await open(
      target,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      if ((await handle.stat()).size > 25 * 1024 * 1024)
        throw new Error("첨부파일은 25MB 이하여야 합니다.");
      const bytes = await handle.readFile();
      return { path: relative, bytes, revision: digest(bytes) };
    } finally {
      await handle.close();
    }
  }

  #checkAttachment(name, bytes) {
    const mime = attachmentMime(name);
    if (!mime || bytes.length > 25 * 1024 * 1024)
      throw new Error("25MB 이하의 PNG·JPEG·GIF·WebP·PDF만 지원합니다.");
    const signatures = {
      "image/png": () =>
        bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
      "image/jpeg": () =>
        bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
      "image/gif": () => /^GIF8[79]a/.test(bytes.subarray(0, 6).toString()),
      "image/webp": () =>
        bytes.subarray(0, 4).toString() === "RIFF" &&
        bytes.subarray(8, 12).toString() === "WEBP",
      "application/pdf": () => bytes.subarray(0, 5).toString() === "%PDF-",
    };
    if (!signatures[mime]())
      throw new Error("확장자와 파일 형식이 일치하지 않습니다.");
    return mime;
  }

  importAttachment(name, input) {
    return this.#enqueue(async () => {
      if (typeof name !== "string" || !(input instanceof Uint8Array))
        throw new Error("첨부파일 데이터가 필요합니다.");
      const bytes = Buffer.from(input);
      this.#checkAttachment(name, bytes);
      const clean = path
        .basename(name)
        .replace(/[^\p{L}\p{N}._-]/gu, "_")
        .slice(-120);
      const relative = `_attachments/${randomUUID().slice(0, 8)}-${clean}`;
      const target = await this.#file(relative, true);
      await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
      return {
        path: relative,
        revision: digest(bytes),
        mime: attachmentMime(name),
      };
    });
  }

  async readAttachment(relative) {
    await this.#tail;
    const value = await this.#binary(relative);
    return { ...value, mime: this.#checkAttachment(relative, value.bytes) };
  }

  moveFile(from, to, expectedRevision) {
    return this.#enqueue(async () => {
      if (
        from === to ||
        path.extname(from).toLowerCase() !== path.extname(to).toLowerCase()
      )
        throw new Error("확장자를 유지한 다른 경로를 입력해 주세요.");
      const current = await this.#binary(from);
      if (current.revision !== expectedRevision)
        throw new Error("외부에서 파일이 변경되었습니다. 새로고침해 주세요.");
      const snapshot = await this.#snapshot();
      const files = [...snapshot.notes, ...snapshot.documents, ...snapshot.attachments];
      const edits = [...snapshot.notes, ...snapshot.documents]
        .map((n) => ({
          ...n,
          next: n.kind === "canvas" ? rewriteCanvas(n.content, n.path, from, to, files)
            : n.kind === "base" ? n.content : rewriteLinks(n.content, n.path, from, to, files),
        }))
        .filter((n) => n.next !== n.content);
      for (const edit of edits)
        if ((await this.#read(edit.path)).revision !== edit.revision)
          throw new Error("연결 문서가 변경되었습니다. 다시 시도해 주세요.");
      const destination = await this.#file(to, true);
      const sourceNote = edits.find((n) => n.path === from);
      const movedBytes = sourceNote
        ? Buffer.from(sourceNote.next)
        : current.bytes;
      // Exclusive creation prevents overwriting an unrelated destination.
      await writeFile(destination, movedBytes, { flag: "wx", mode: 0o600 });
      const saved = [];
      try {
        for (const edit of edits) {
          if (edit.path === from) continue;
          const result = await this.#save(edit.path, edit.next, edit.revision);
          saved.push({ ...edit, savedRevision: result.revision });
        }
        if (
          (await this.#binary(from)).revision !== current.revision ||
          (await this.#binary(to)).revision !== digest(movedBytes)
        )
          throw new Error("이동 중 외부 변경이 감지되었습니다.");
        const backup = path.join(this.recoveryRoot, "moves", randomUUID());
        await mkdir(backup, { recursive: true, mode: 0o700 });
        await writeFile(path.join(backup, path.basename(from)), current.bytes, {
          flag: "wx",
          mode: 0o600,
        });
        await unlink(await this.#file(from));
      } catch (error) {
        for (const edit of saved.reverse())
          try {
            await this.#save(edit.path, edit.content, edit.savedRevision);
          } catch {
            /* Preserve external edits and their recovery copies. */
          }
        try {
          if ((await this.#binary(to)).revision === digest(movedBytes))
            await unlink(destination);
        } catch {
          /* Retain externally modified destination. */
        }
        throw error;
      }
      return this.#snapshot();
    });
  }

  trashFile(relative, expectedRevision) {
    return this.#enqueue(async () => {
      const current = await this.#binary(relative);
      if (current.revision !== expectedRevision)
        throw new Error("외부에서 파일이 변경되었습니다. 새로고침해 주세요.");
      const id = randomUUID();
      const directory = path.join(this.recoveryRoot, "trash", id);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(path.join(directory, "content"), current.bytes, {
        flag: "wx",
        mode: 0o600,
      });
      await writeFile(
        path.join(directory, "entry.json"),
        JSON.stringify({ path: relative, revision: current.revision }),
        { flag: "wx", mode: 0o600 },
      );
      if ((await this.#binary(relative)).revision !== current.revision)
        throw new Error("삭제 전 외부 변경이 감지되었습니다.");
      await unlink(await this.#file(relative));
      return { id, path: relative };
    });
  }

  restoreTrash(id) {
    return this.#enqueue(async () => {
      if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
        throw new Error("잘못된 휴지통 항목입니다.");
      const directory = path.join(this.recoveryRoot, "trash", id);
      const entry = JSON.parse(
        await readFile(path.join(directory, "entry.json"), "utf8"),
      );
      const bytes = await readFile(path.join(directory, "content"));
      if (digest(bytes) !== entry.revision)
        throw new Error("복구 사본이 변경되었습니다.");
      await writeFile(await this.#file(entry.path, true), bytes, {
        flag: "wx",
        mode: 0o600,
      });
      return this.#snapshot();
    });
  }
}
