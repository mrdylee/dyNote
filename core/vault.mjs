import {
  open,
  realpath,
  lstat,
  readdir,
  mkdir,
  rename,
  rmdir,
  link,
  unlink,
  writeFile,
  readFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { attachmentMime, validateAttachment, decodeHtml } from "./attachments.mjs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createLinkIndex, resolvePath, rewriteLinks, rewriteLinkPaths, scanLinks } from "./links.mjs";
import { renamedTreePath } from "./file-tree.mjs";
import { documentKind, initialDocument, validateDocument } from "./documents.mjs";
import { parseCanvas, rewriteCanvas, rewriteCanvasPaths } from "./canvas.mjs";
import { noteAliases, parseMetadata } from "./metadata.mjs";
import { officeKind } from "./office-types.mjs";
import { officePreview } from "./office-package.mjs";
import { readSource, decodePreviewText } from "./file-source.mjs";
import { readWordContent } from "./word-documents.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const MAX_BYTES = 8 * 1024 * 1024;
const sameEntry = (a, b) => a.dev === b.dev && a.ino === b.ino;
// macOS O_NOFOLLOW_ANY from sys/fcntl.h rejects symlinks in ancestor directories too.
const noFollow = process.platform === "darwin" ? 0x20000000 : (constants.O_NOFOLLOW ?? 0);
const documentRevision = (snapshot) => digest(JSON.stringify({
  documents: [...snapshot.notes, ...snapshot.documents].map(file => [file.path, file.revision]).sort((a, b) => a[0].localeCompare(b[0])),
  attachments: snapshot.attachments.map(file => file.path).sort(),
  warnings: [...snapshot.warnings].sort(),
}));

function validRelativePath(value) {
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
      )
  );
}

function unusedCopyName(filename, entries) {
  const fold = name => name.normalize("NFC").toLowerCase();
  const taken = new Set(entries.map(fold));
  const { name: stem, ext } = path.parse(filename);
  let candidate = filename;
  for (let index = 1; taken.has(fold(candidate)); index++)
    candidate = `${stem} (복사본${index === 1 ? "" : " " + index})${ext}`;
  return candidate;
}

export const FILE_STORAGE_FOLDER = "File Storage";

export const validFilePath = (value) =>
  validRelativePath(value) && !(officeKind(value) && path.posix.basename(value).startsWith("~$")) && /\.(?:html?|xlsx|pptx|md|canvas|base|png|jpe?g|gif|webp|pdf|webm|wav|mp3|ogg|m4a)$/i.test(value);
export const validPersonalFilePath = value =>
  validRelativePath(value) && !/[\x00-\x1f\x7f]/u.test(value) && !path.posix.basename(value).startsWith("~$") &&
  (value.startsWith(FILE_STORAGE_FOLDER + "/") || validFilePath(value) || /\.zip$/i.test(value));
const validWordPath = (value) =>
  validRelativePath(value) && /\.docx$/i.test(value) && !path.posix.basename(value).startsWith("~$");
const wordRevision = ({ dev, ino, size, mtimeNs, ctimeNs }) =>
  `${dev}:${ino}:${size}:${mtimeNs}:${ctimeNs}`;

export const validNotePath = (value) =>
  validFilePath(value) && /\.md$/i.test(value);
export { attachmentMime } from "./attachments.mjs";

export class Vault {
  #tail = Promise.resolve();
  #wordIndex = new Map();

  static async open(root, recoveryRoot, purpose) {
    const canonical = await realpath(root);
    if (!(await lstat(canonical)).isDirectory())
      throw new Error("폴더를 선택해 주세요.");
    const vault = new Vault(canonical, recoveryRoot);
    if (purpose === "personal" || purpose === "team") await vault.prepareFileStorage();
    return vault;
  }

  constructor(root, recoveryRoot) {
    this.root = root;
    this.id = digest(root).slice(0, 16);
    this.name = path.basename(root);
    this.recoveryRoot = path.join(recoveryRoot, this.id);
  }

  async prepareFileStorage() {
    const folder = path.join(this.root, FILE_STORAGE_FOLDER);
    this.fileStorageWarning = "";
    try {
      if (await realpath(this.root) !== this.root) throw new Error("보관함 위치가 변경되었습니다.");
      await mkdir(folder);
    } catch (error) {
      if (error.code === "EEXIST" && (await lstat(folder).catch(() => null))?.isDirectory()) return;
      this.fileStorageWarning = "File Storage 폴더를 준비하지 못했습니다. 같은 이름의 항목이나 폴더 권한을 확인해 주세요.";
    }
  }

  #enqueue(operation) {
    const result = this.#tail.then(operation);
    this.#tail = result.catch(() => {});
    return result;
  }

  async #file(relative, createParents = false, validPath = validFilePath) {
    if (!validPath(relative))
      throw new Error(validPath === validWordPath ? "허용되지 않는 Word 문서 경로입니다." : "허용되지 않는 Markdown 경로입니다.");
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
      if (!validNotePath(relative) && stat.size > MAX_BYTES)
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
    const snapshot = await this.#snapshot();
    if (this.fileStorageWarning) snapshot.warnings.push(this.fileStorageWarning);
    return snapshot;
  }

  captureFiles() { return this.#enqueue(() => this.#captureFiles()); }

  documentSnapshot() {
    return this.#enqueue(async () => { const snapshot = await this.#snapshot(); return { ...snapshot, revision: documentRevision(snapshot) }; });
  }

  applyDocumentChanges(changes, expectedRevision) {
    return this.#enqueue(async () => {
      const before = await this.#snapshot();
      if (before.warnings.length) throw new Error(`읽을 수 없는 문서를 먼저 확인해 주세요: ${before.warnings[0]}`);
      if (documentRevision(before) !== expectedRevision) throw new Error("미리보기 이후 문서가 변경되었습니다. 다시 확인해 주세요.");
      const current = new Map([...before.notes, ...before.documents].map(file => [file.path, file]));
      const names = new Map(), seen = new Set();
      for (const name of [...current.keys(), ...before.attachments.map(file => file.path), ...changes.map(change => change.path)]) {
        if (!validFilePath(name)) throw new Error("잘못된 문서 경로입니다.");
        const parts = name.split("/");
        for (let i = 1; i <= parts.length; i++) {
          const prefix = parts.slice(0, i).join("/"), key = prefix.normalize("NFC").toLowerCase();
          if (names.has(key) && names.get(key) !== prefix) throw new Error("대소문자 또는 유니코드 표기만 다른 경로가 있습니다.");
          names.set(key, prefix);
        }
      }
      for (const change of changes) {
        if ((!validNotePath(change.path) && !documentKind(change.path)) || seen.has(change.path)) throw new Error("잘못되었거나 중복된 문서 경로입니다.");
        seen.add(change.path);
        if (change.content !== null) {
          if (typeof change.content !== "string") throw new Error("문서 내용이 잘못되었습니다.");
          if (!validNotePath(change.path) && Buffer.byteLength(change.content) > MAX_BYTES) throw new Error("문서는 8MB 이하여야 합니다.");
          if (documentKind(change.path)) validateDocument(change.path, change.content);
        } else if (!current.has(change.path)) throw new Error("삭제할 문서를 찾을 수 없습니다.");
      }
      await mkdir(this.recoveryRoot, { recursive: true, mode: 0o700 });
      const recoveryRoot = await realpath(this.recoveryRoot);
      if (recoveryRoot === this.root || recoveryRoot.startsWith(this.root + path.sep)) throw new Error("복구 사본은 보관함 밖에 보관해야 합니다.");
      const recoveryPath = path.join(recoveryRoot, "compose", randomUUID());
      await mkdir(path.join(recoveryPath, "files"), { recursive: true, mode: 0o700 });
      for (const change of changes) {
        const file = current.get(change.path); if (!file) continue;
        const backup = path.join(recoveryPath, "files", file.path);
        await mkdir(path.dirname(backup), { recursive: true, mode: 0o700 });
        await writeFile(backup, file.content, { flag: "wx", mode: 0o600 });
      }
      await writeFile(path.join(recoveryPath, "manifest.json"), JSON.stringify({ createdAt: new Date().toISOString(), revision: expectedRevision, files: changes.map(change => ({ path: change.path, revision: current.get(change.path)?.revision ?? null })) }), { flag: "wx", mode: 0o600 });
      if (documentRevision(await this.#snapshot()) !== expectedRevision) throw new Error(`복구 사본 생성 중 문서가 변경되었습니다. 복구 사본: ${recoveryPath}`);
      const readCurrent = (name) => this.#read(name).catch(error => { if (error.code !== "ENOENT") throw error; return null; });
      const applied = [];
      try {
        for (const change of changes) {
          const previous = current.get(change.path);
          if ((await readCurrent(change.path))?.revision !== previous?.revision) throw new Error(`적용 중 문서가 변경되었습니다: ${change.path}`);
          if (change.content === null) await unlink(await this.#file(change.path));
          else if (previous) await this.#save(change.path, change.content, previous.revision);
          else await writeFile(await this.#file(change.path, true), change.content, { flag: "wx", mode: 0o600 });
          applied.push(change);
        }
        return { recoveryPath, snapshot: await this.#snapshot() };
      } catch (error) {
        for (const change of applied.reverse()) {
          try {
            const actual = await readCurrent(change.path), previous = current.get(change.path);
            if (actual?.revision !== (change.content === null ? undefined : digest(Buffer.from(change.content)))) continue;
            if (!previous) await unlink(await this.#file(change.path));
            else if (actual) await this.#save(change.path, previous.content, actual.revision);
            else await writeFile(await this.#file(change.path, true), previous.content, { flag: "wx", mode: 0o600 });
          } catch { /* Preserve external edits and the recovery copies. */ }
        }
        throw new Error(`${error.message} 복구 사본: ${recoveryPath}`);
      }
    });
  }

  async #captureFiles() {
    const files = [];
    let total = 0;
    const walk = async (directory, prefix = "") => {
      for (const item of await readdir(directory, { withFileTypes: true })) {
        if (item.name.startsWith(".")) continue;
        const relative = prefix + item.name;
        if (item.isSymbolicLink()) {
          if (validFilePath(relative)) throw new Error(`심볼릭 링크는 복원할 수 없습니다: ${relative}`);
          continue;
        }
        if (item.isDirectory()) await walk(path.join(directory, item.name), relative + "/");
        else if (validFilePath(relative)) {
          const file = await this.#binary(relative);
          total += file.bytes.length;
          if (total > 512 * 1024 * 1024) throw new Error("한 번에 복원할 보관함은 512MB 이하여야 합니다.");
          files.push(file);
        }
      }
    };
    await walk(this.root);
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, revision: digest(JSON.stringify(files.map((file) => [file.path, file.revision]))) };
  }

  async #captureSelection(paths) {
    const files = [];
    for (const name of paths) {
      if (!validPersonalFilePath(name)) throw new Error("잘못된 파일 경로입니다.");
      const file = await this.#binary(name, validPersonalFilePath).catch(error => {
        if (error.code !== "ENOENT") throw error;
      });
      if (file) files.push(file);
    }
    return { files, revision: digest(JSON.stringify(files.map(file => [file.path, file.revision]))) };
  }

  captureSelection(paths) { return this.#enqueue(() => this.#captureSelection(paths)); }
  applyPersonalSync(operation) { return this.#enqueue(operation); }

  async #restoreTarget(relative, validPath = validFilePath) {
    if (!validPath(relative)) throw new Error("잘못된 복원 경로입니다.");
    let target = this.root;
    const parts = relative.split("/");
    for (let i = 0; i < parts.length; i++) {
      if (validPath === validPersonalFilePath) {
        const entries = await readdir(target).catch(error => { if (error.code !== "ENOENT") throw error; return []; });
        if (entries.some(name => name !== parts[i] && name.normalize("NFC").toLowerCase() === parts[i].normalize("NFC").toLowerCase()))
          throw new Error("대소문자 또는 유니코드 표기만 다른 파일이 있습니다.");
      }
      target = path.join(target, parts[i]);
      const info = await lstat(target).catch((error) => { if (error.code !== "ENOENT") throw error; });
      if (info && (info.isSymbolicLink() || (i < parts.length - 1 ? !info.isDirectory() : !info.isFile())))
        throw new Error(`복원 경로에 링크 또는 다른 종류의 파일이 있습니다: ${relative}`);
    }
    return target;
  }

  applySnapshot(files, expectedRevision, selection = null, { includeSnapshot = true } = {}) {
    const capture = () => selection ? this.#captureSelection(selection) : this.#captureFiles();
    const validPath = selection ? validPersonalFilePath : validFilePath;
    if (selection && files.some(file => !selection.includes(file.path))) throw new Error("복원 대상이 변경되었습니다.");
    return this.#enqueue(async () => {
      await mkdir(this.recoveryRoot, { recursive: true, mode: 0o700 });
      const recoveryRoot = await realpath(this.recoveryRoot);
      if (recoveryRoot === this.root || recoveryRoot.startsWith(this.root + path.sep))
        throw new Error("복구 사본 폴더가 보관함 안에 있습니다. 별도 노트 폴더를 선택해 주세요.");
      const before = await capture();
      if (before.revision !== expectedRevision) throw new Error("미리보기 이후 파일이 변경되었습니다. 복원 내용을 다시 확인해 주세요.");
      const current = new Map(before.files.map((file) => [file.path, file]));
      const target = new Map();
      const names = new Map();
      for (const file of [...before.files, ...files]) {
        if (!validPath(file.path)) throw new Error("잘못된 복원 경로입니다.");
        const parts = file.path.split("/");
        for (let i = 1; i <= parts.length; i++) {
          const name = parts.slice(0, i).join("/"), key = name.normalize("NFC").toLowerCase();
          if (names.has(key) && names.get(key) !== name)
            throw new Error("대소문자 또는 유니코드 표기만 다른 중복 경로가 있습니다. Git 도구에서 경로를 정리해 주세요.");
          names.set(key, name);
        }
      }
      let total = 0;
      for (const file of files) {
        if (!Buffer.isBuffer(file.bytes) || file.bytes.length > 25 * 1024 * 1024 || target.has(file.path))
          throw new Error("잘못되었거나 너무 큰 복원 파일입니다.");
        total += file.bytes.length;
        if (total > 512 * 1024 * 1024) throw new Error("복원 파일은 총 512MB 이하여야 합니다.");
        await this.#restoreTarget(file.path, validPath);
        target.set(file.path, { ...file, revision: digest(file.bytes) });
      }
      const changes = [...new Set([...current.keys(), ...target.keys()])]
        .filter((name) => current.get(name)?.revision !== target.get(name)?.revision);
      const recoveryPath = path.join(this.recoveryRoot, "git-restore", randomUUID());
      await mkdir(path.join(recoveryPath, "files"), { recursive: true, mode: 0o700 });
      for (const file of before.files) {
        const saved = path.join(recoveryPath, "files", file.path);
        await mkdir(path.dirname(saved), { recursive: true, mode: 0o700 });
        await writeFile(saved, file.bytes, { flag: "wx", mode: 0o600 });
      }
      await writeFile(path.join(recoveryPath, "manifest.json"), JSON.stringify({
        createdAt: new Date().toISOString(), revision: before.revision,
        files: before.files.map(({ path, revision }) => ({ path, revision })),
      }), { flag: "wx", mode: 0o600 });
      if ((await capture()).revision !== expectedRevision)
        throw new Error(`복구 사본 생성 중 파일이 변경되었습니다. 다시 확인해 주세요. 복구 사본: ${recoveryPath}`);
      const readCurrent = (name) => this.#binary(name, validPath).catch((error) => { if (error.code !== "ENOENT") throw error; return null; });
      const replace = async (name, file) => {
        if (!file) { await unlink(await this.#file(name, false, validPath)); return; }
        const destination = await this.#file(name, true, validPath);
        const temporary = path.join(path.dirname(destination), `.open-notes-${randomUUID()}.tmp`);
        try {
          await writeFile(temporary, file.bytes, { flag: "wx", mode: 0o600 });
          await rename(temporary, destination);
        } finally { await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
      };
      const applied = [];
      try {
        for (const name of changes) {
          if ((await readCurrent(name))?.revision !== current.get(name)?.revision)
            throw new Error(`복원 중 외부 변경이 감지되었습니다: ${name}`);
          await replace(name, target.get(name)); applied.push(name);
        }
        return { recoveryPath, snapshot: includeSnapshot ? await this.#snapshot() : undefined };
      } catch (error) {
        for (const name of applied.reverse()) {
          try {
            if ((await readCurrent(name))?.revision === target.get(name)?.revision) await replace(name, current.get(name));
          } catch { /* Keep recovery copies; never overwrite an external edit during rollback. */ }
        }
        throw new Error(`${error.message} 복구 사본: ${recoveryPath}`);
      }
    });
  }

  async #snapshot() {
    const notes = [];
    const warnings = [];
    const attachments = [];
    const documents = [];
    const wordDocuments = [];
    const otherFiles = [];
    const folders = [];
    const walk = async (directory, prefix = "") => {
      const items = await readdir(directory, { withFileTypes: true });
      for (const item of items) {
        if (item.name.startsWith(".") || item.isSymbolicLink()) continue;
        const relative = prefix + item.name;
        if (item.isDirectory()) {
          if (validFilePath(relative + "/folder.md")) folders.push(relative);
          try {
            await walk(path.join(directory, item.name), relative + "/");
          } catch {
            warnings.push(`${relative}: 읽을 수 없는 폴더`);
          }
        } else if (item.isFile() && attachmentMime(item.name)) {
          if (validFilePath(relative)) attachments.push({ path: relative });
        } else if (item.isFile() && validWordPath(relative)) {
          try {
            wordDocuments.push(await this.#readWordDocument(relative, false));
          } catch {
            wordDocuments.push({ path: relative, title: item.name, kind: "word", content: "" });
          }
        } else if (item.isFile() && /\.(?:md|canvas|base)$/i.test(item.name)) {
          try {
            (documentKind(relative) ? documents : notes).push(await this.#read(relative));
          } catch (error) {
            warnings.push(`${relative}: ${error.message}`);
          }
        } else if (item.isFile() && validRelativePath(relative) && !item.name.startsWith("~$")) {
          otherFiles.push({ path: relative, kind: "other" });
        }
      }
    };
    await walk(this.root);
    notes.sort((a, b) => a.path.localeCompare(b.path, "ko"));
    documents.sort((a, b) => a.path.localeCompare(b.path, "ko"));
    wordDocuments.sort((a, b) => a.path.localeCompare(b.path, "ko"));
    const indexedPaths = new Set(wordDocuments.map(file => file.path));
    for (const relative of this.#wordIndex.keys()) {
      if (!indexedPaths.has(relative)) this.#wordIndex.delete(relative);
    }
    return { id: this.id, name: this.name, notes, documents, wordDocuments, attachments, otherFiles, folders, warnings };
  }

  async officeFilePath(relative) {
    await this.#tail;
    if (!officeKind(relative)) throw new Error("Excel 또는 PowerPoint 파일을 선택해 주세요.");
    const file = await this.#file(relative);
    if (await realpath(file) !== file) throw new Error("보관함 안의 원본 파일을 선택해 주세요.");
    return file;
  }

  async readOfficeDocument(relative, previousRevision) {
    const data = await readSource(await this.officeFilePath(relative), previousRevision, 25 * 1024 * 1024);
    return data && { path: relative, revision: data.revision, ...await officePreview(officeKind(relative), data.bytes) };
  }

  async wordFilePath(relative) {
    await this.#tail;
    const target = await this.#file(relative, false, validWordPath);
    if (await realpath(target) !== target || !(await lstat(target)).isFile())
      throw new Error("보관함 안의 Word 문서를 선택해 주세요.");
    return target;
  }

  async #readWordDocument(relative, preview, previousRevision) {
    const target = await this.#file(relative, false, validWordPath);
    const handle = await open(target, constants.O_RDONLY | noFollow);
    let bytes, revision, cached;
    try {
      const stat = await handle.stat({ bigint: true });
      if (!stat.isFile()) throw new Error("일반 Word 문서만 열 수 있습니다.");
      if (stat.size > 25n * 1024n * 1024n) throw new Error("Word 미리보기와 본문 검색은 25MB 이하를 지원합니다.");
      revision = wordRevision(stat);
      if (revision === previousRevision) return null;
      const indexed = this.#wordIndex.get(relative);
      if (indexed?.revision === revision) {
        if (!preview) return indexed;
        cached = indexed.content;
      }
      bytes = await handle.readFile();
      if (revision !== wordRevision(await handle.stat({ bigint: true })))
        throw new Error("읽는 중 Word 문서가 변경되었습니다. 다시 열어 주세요.");
    } finally {
      await handle.close();
    }
    const { content, html } = await readWordContent(bytes, preview, cached);
    const file = { path: relative, title: path.posix.basename(relative), kind: "word", content, revision };
    this.#wordIndex.set(relative, file);
    return preview ? { ...file, html } : file;
  }

  async readWordDocument(relative, previousRevision, preview = true) {
    await this.#tail;
    return this.#readWordDocument(relative, preview, previousRevision);
  }

  async readNote(relative) {
    if (!validNotePath(relative)) throw new Error("허용되지 않는 Markdown 경로입니다.");
    await this.#tail;
    return this.#read(relative);
  }

  create(relative, initialContent) {
    return this.#enqueue(() => this.#create(relative, initialContent));
  }

  openOrCreate(relative, initialContent) {
    return this.#enqueue(async () => {
      if (!validNotePath(relative)) throw new Error("허용되지 않는 Markdown 경로입니다.");
      try { return await this.#read(relative); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      return this.#create(relative, initialContent, true);
    });
  }

  async #create(relative, initialContent, openExisting = false) {
      if (!validNotePath(relative))
        throw new Error("허용되지 않는 Markdown 경로입니다.");
      const content = initialContent === undefined ? `# ${path.basename(relative, ".md")}\n\n` : initialContent;
      if (typeof content !== "string")
        throw new Error("문서 내용이 잘못되었습니다.");
      const target = await this.#file(relative, true);
      try {
        await writeFile(target, content, { flag: "wx", mode: 0o600 });
      } catch (error) {
        if (error.code === "EEXIST" && openExisting) return this.#read(relative);
        if (error.code === "EEXIST")
          throw new Error("같은 이름의 문서가 이미 있습니다.");
        throw error;
      }
      const stat = await lstat(target);
      return {
        path: relative,
        content,
        revision: digest(Buffer.from(content)),
        metadata: { size: Buffer.byteLength(content), mtime: stat.mtimeMs, ctime: stat.birthtimeMs },
      };
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
    if (typeof content !== "string")
      throw new Error("문서 내용이 잘못되었습니다.");
    if (!validNotePath(relative) && Buffer.byteLength(content) > MAX_BYTES)
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
    const stat = await lstat(target);
    return {
      path: relative,
      content,
      revision: digest(Buffer.from(content)),
      metadata: { size: Buffer.byteLength(content), mtime: stat.mtimeMs, ctime: stat.birthtimeMs },
      ...(documentKind(relative) ? { kind: documentKind(relative) } : {}),
    };
  }

  async #binary(relative, validPath = validFilePath) {
    const target = await this.#file(relative, false, validPath);
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


  importAttachment(name, input) {
    return this.#enqueue(async () => {
      if (typeof name !== "string" || !(input instanceof Uint8Array))
        throw new Error("첨부파일 데이터가 필요합니다.");
      const bytes = Buffer.from(input);
      validateAttachment(name, bytes);
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
    return { ...value, mime: validateAttachment(relative, value.bytes) };
  }

  replacePdf(relative, input, expectedRevision) {
    return this.#enqueue(async () => {
      if (attachmentMime(relative) !== "application/pdf" || !(input instanceof Uint8Array)) throw new Error("PDF 데이터가 필요합니다.");
      const bytes = Buffer.from(input); validateAttachment(relative, bytes);
      const current = await this.#binary(relative);
      if (current.revision !== expectedRevision) throw new Error("외부에서 PDF가 변경되었습니다. 다시 확인해 주세요.");
      await mkdir(this.recoveryRoot, { recursive: true, mode: 0o700 });
      const recoveryRoot = await realpath(this.recoveryRoot);
      if (recoveryRoot === this.root || recoveryRoot.startsWith(this.root + path.sep)) throw new Error("복구 사본은 보관함 밖에 보관해야 합니다.");
      const directory = path.join(recoveryRoot, "pdf", randomUUID());
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const recoveryPath = path.join(directory, "original.pdf");
      await writeFile(recoveryPath, current.bytes, { flag: "wx", mode: 0o600 });
      await writeFile(path.join(directory, "entry.json"), JSON.stringify({ path: relative, revision: current.revision }), { flag: "wx", mode: 0o600 });
      const target = await this.#file(relative), temporary = path.join(path.dirname(target), `.dynote-pdf-${randomUUID()}`);
      try {
        await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
        if ((await this.#binary(relative)).revision !== current.revision) throw new Error("저장 전 PDF가 변경되었습니다.");
        if (await this.#file(relative) !== target) throw new Error("PDF 경로가 변경되었습니다.");
        await rename(temporary, target);
      } finally { await unlink(temporary).catch(() => {}); }
      return { recoveryPath, attachment: { path: relative, bytes, revision: digest(bytes), mime: "application/pdf" } };
    });
  }

  async #checkCrossVaultLinks(file, to, source) {
    if (file.kind === "base") return;
    let links;
    if (file.kind === "canvas") {
      let data;
      try { ({ data } = parseCanvas(file.content)); }
      catch { return; } // The app cannot resolve cards in an invalid canvas.
      links = (data.nodes ?? []).flatMap(node => {
        if (node.type === "text") return scanLinks(node.text);
        const target = node.type === "file" ? node.file : node.type === "group" ? node.background : null;
        return target ? [{ target, kind: "canvas" }] : [];
      });
    } else {
      links = scanLinks(parseMetadata(file.content).body);
    }
    if (!links.length) return;

    const [before, after] = await Promise.all([source.#snapshot(), this.#snapshot()]);
    (file.kind ? after.documents : after.notes).push({ ...file, path: to });
    const resolver = ({ notes, documents, attachments }) => {
      const entries = [...notes.map(note => ({ ...note, aliases: noteAliases(parseMetadata(note.content).properties) })), ...documents];
      const byPath = new Map([...entries, ...attachments].map(entry => [entry.path, entry]));
      const docIndex = createLinkIndex(entries), assetIndex = createLinkIndex(attachments);
      return ({ target, kind }, from) => {
        if (kind === "canvas") return byPath.get(target);
        const asset = resolvePath(target, from, attachments, { kind, index: assetIndex });
        if (asset.path && attachmentMime(asset.path)) return byPath.get(asset.path);
        return byPath.get(resolvePath(target, from, entries, { kind, index: docIndex }).path);
      };
    };
    const resolveSource = resolver(before), resolveDestination = resolver(after);
    for (const link of links) {
      const original = resolveSource(link, file.path), copied = resolveDestination(link, to);
      if (!original && !copied) continue;
      if (original && copied) {
        if (original.path === file.path && copied.path === to) continue;
        if (original.path !== file.path && copied.path !== to) {
          const left = original.revision ?? (await source.#binary(original.path)).revision;
          const right = copied.revision ?? (await this.#binary(copied.path)).revision;
          if (left === right) continue;
        }
      }
      throw new Error(`링크 “${link.target}”의 대상이 복사 후 달라집니다. 대상 보관함에서 연결 파일을 확인해 주세요.`);
    }
  }

  async #createCopy(to, parent, validPath, write, staged = false) {
    const changed = () => new Error("복사 중 대상 폴더가 변경되었습니다. 다시 시도해 주세요.");
    const destination = await this.#file(to, false, validPath);
    if (!sameEntry(await lstat(path.dirname(destination), { bigint: true }), parent)) throw changed();
    const working = staged ? path.join(path.dirname(destination), ".dynote-drop-" + randomUUID()) : destination;
    const handle = await open(working, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600)
      .catch(error => {
        if (error.code === "EEXIST") throw new Error("대상 폴더에 같은 이름의 문서가 있습니다.");
        if (error.code === "ELOOP") throw changed();
        throw error;
      });
    let actual, opened, completed = false;
    try {
      opened = await handle.stat({ bigint: true });
      actual = await realpath(working);
      // Verify the file descriptor before writing private bytes, then write through that descriptor.
      if (!actual.startsWith(path.join(this.root, path.sep)) ||
          !sameEntry(await lstat(path.dirname(actual), { bigint: true }), parent) ||
          !sameEntry(await lstat(actual, { bigint: true }), opened)) throw changed();
      await write(handle);
      if (await realpath(working) !== actual || !sameEntry(await lstat(actual, { bigint: true }), opened)) throw changed();
      const result = await handle.stat({ bigint: staged });
      if (staged) {
        await handle.sync();
        if (!sameEntry(await lstat(path.dirname(destination), { bigint: true }), parent)) throw changed();
        await link(actual, destination);
        if (!sameEntry(await lstat(destination, { bigint: true }), opened)) throw changed();
      }
      completed = true;
      return result;
    } finally {
      // Remove only the entry created by this operation.
      const candidate = actual ?? working;
      if (staged || !completed) {
        const created = await lstat(candidate, { bigint: true }).catch(() => null);
        if (created && opened && sameEntry(created, opened)) await unlink(candidate).catch(() => {});
      }
      await handle.close();
    }
  }

  async #writeCopy(file, to, content, parent) {
    if (file.kind && Buffer.byteLength(content) > MAX_BYTES)
      throw new Error("8MB보다 큰 문서는 이 버전에서 열 수 없습니다.");
    const stat = await this.#createCopy(to, parent, validFilePath, handle => handle.writeFile(content));
    return { ...file, path: to, content, revision: digest(content), metadata: { size: stat.size, mtime: stat.mtimeMs, ctime: stat.birthtimeMs } };
  }

  transferDroppedFile(source, folder, operation) {
    return this.#enqueue(async () => {
      if (typeof source !== "string" || !path.isAbsolute(source) || typeof folder !== "string")
        throw new Error("디스크에서 파일을 선택해 주세요.");
      if (!["copy", "move"].includes(operation)) throw new Error("파일 작업을 선택해 주세요.");
      const name = path.basename(source);
      const inFolder = leaf => folder ? folder + "/" + leaf : leaf;
      if (!validRelativePath(inFolder(name)) || name.startsWith("~$"))
        throw new Error("보관함에서 사용할 수 없는 파일 이름입니다.");
      const directory = path.dirname(await this.#file(inFolder(randomUUID() + ".md"), false, validRelativePath));
      const parent = await lstat(directory, { bigint: true });
      const stat = await lstat(source, { bigint: true });
      if (!stat.isFile()) throw new Error("일반 파일만 복사할 수 있습니다.");
      const original = await realpath(source);
      if (operation === "move" && sameEntry(await lstat(path.dirname(original), { bigint: true }), parent))
        return { path: inFolder(name), unchanged: true };
      const copied = inFolder(unusedCopyName(name, await readdir(directory)));
      const input = await open(original, constants.O_RDONLY | noFollow);
      try {
        const before = await input.stat({ bigint: true });
        if (!sameEntry(stat, before)) throw new Error("원본 파일이 변경되었습니다.");
        if (validFilePath(copied) && before.size > 25n * 1024n * 1024n)
          throw new Error("Git 복원 대상 파일은 25MB 이하만 옮기거나 복사할 수 있습니다.");
        if (documentKind(copied) && before.size > BigInt(MAX_BYTES))
          throw new Error("Canvas와 Bases 문서는 8MB 이하여야 합니다.");
        const revision = wordRevision(before);
        const written = await this.#createCopy(copied, parent, validRelativePath, async output => {
          if (attachmentMime(name) === "text/html") {
            const data = await readSource(original, undefined, 25 * 1024 * 1024);
            if (data.revision !== revision) throw new Error("원본 파일이 변경되었습니다.");
            decodeHtml(data.bytes);
            await output.writeFile(data.bytes);
          } else if (before.size) {
            await output.writeFile(input.createReadStream({ autoClose: false, end: Number(before.size - 1n) }));
          }
          if (operation === "move") {
            if (process.platform !== "win32") await output.chmod(Number(before.mode & 0o777n));
            await output.utimes(Number(before.atimeMs) / 1000, Number(before.mtimeMs) / 1000);
          }
          if (wordRevision(await input.stat({ bigint: true })) !== revision)
            throw new Error("파일을 전송하는 동안 원본이 변경되었습니다.");
        }, true);
        if (operation === "move") {
          try {
            const target = await lstat(path.join(this.root, copied), { bigint: true });
            if (wordRevision(await lstat(original, { bigint: true })) !== revision ||
                !sameEntry(target, written) || target.size !== before.size || target.mtimeNs !== written.mtimeNs)
              throw new Error("파일이 변경되었습니다.");
            await unlink(original);
          } catch (error) {
            return { path: copied, warning: "대상에 복사했지만 원본을 이동할 수 없습니다. " + error.message };
          }
        }
        return { path: copied };
      } finally { await input.close(); }
    });
  }

  async readOtherFile(relative) {
    await this.#tail;
    const file = await this.#file(relative, false, validRelativePath);
    const { bytes } = await readSource(file, undefined, 25 * 1024 * 1024);
    return attachmentMime(relative) === "text/html" ? decodeHtml(bytes) : decodePreviewText(bytes);
  }

  async copyDocument(from, folder, expectedRevision, source = this) {
    if (!validFilePath(from) || (!validNotePath(from) && !documentKind(from)) || typeof folder !== "string")
      throw new Error("복사할 수 없는 문서 또는 폴더입니다.");
    const readSource = async () => {
      const file = await source.#read(from);
      if (file.revision !== expectedRevision)
        throw new Error("외부에서 파일이 변경되었습니다. 새로고침해 주세요.");
      return file;
    };
    let original;
    if (source !== this) {
      await source.#tail;
      original = await readSource();
    }
    return this.#enqueue(async () => {
      const file = original ?? await readSource();
      const inFolder = name => folder ? folder + "/" + name : name;
      const filename = path.basename(from);
      const directory = path.dirname(await this.#file(inFolder(filename)));
      const parent = await lstat(directory, { bigint: true });
      if (!parent.isDirectory()) throw new Error("복사할 수 없는 폴더입니다.");
      const to = inFolder(unusedCopyName(filename, await readdir(directory)));
      let content = file.content;
      if (source === this && file.kind !== "base") {
        const { notes, documents, attachments } = await this.#snapshot();
        const files = [...notes, ...documents, ...attachments];
        content = file.kind === "canvas" ? rewriteCanvas(content, from, from, to, files)
          : rewriteLinks(content, from, from, to, files);
      }
      if (source !== this) await this.#checkCrossVaultLinks(file, to, source);
      return this.#writeCopy(file, to, content, parent);
    });
  }

  async moveDocumentTo(from, folder, revision, target) {
    const snapshot = await this.documentSnapshot();
    const entries = [...snapshot.notes.map(note => ({ ...note, aliases: noteAliases(parseMetadata(note.content).properties) })), ...snapshot.documents, ...snapshot.attachments];
    for (const file of [...snapshot.notes, ...snapshot.documents]) {
      if (file.path === from) continue;
      const links = file.kind === 'canvas' ? (parseCanvas(file.content).data.nodes ?? []).flatMap(node =>
        node.type === 'text' ? scanLinks(node.text) : node.file || node.background ? [{ target: node.file || node.background, kind: 'wiki' }] : []) : scanLinks(file.content);
      if (links.some(link => resolvePath(link.target, file.path, entries, { kind: link.kind }).path === from))
        throw new Error('이 문서를 참조하는 링크가 있습니다. 다른 보관함에는 Ctrl을 눌러 복사해 주세요.');
    }
    const destination = folder ? `${folder}/${path.basename(from)}` : path.basename(from);
    const existing = await target.documentSnapshot();
    if ([...existing.notes, ...existing.documents, ...existing.attachments, ...(existing.folders ?? []).map(path => ({ path }))]
      .some(file => file.path.normalize('NFC').toLowerCase() === destination.normalize('NFC').toLowerCase()))
      throw new Error('대상 폴더에 같은 이름의 문서가 있습니다.');
    const saved = await target.copyDocument(from, folder, revision, this);
    try {
      const trash = await this.trashFile(from, revision);
      return { saved, trash };
    } catch (error) {
      await target.trashFile(saved.path, saved.revision).catch(() => {});
      throw error;
    }
  }

  createFolder(relative) {
    return this.#enqueue(async () => {
      if (!validRelativePath(relative)) throw new Error("허용되지 않는 폴더 경로입니다.");
      const parent = path.dirname(await this.#file(`${relative}-${randomUUID()}.md`));
      const target = path.join(parent, path.basename(relative));
      const names = await readdir(path.dirname(target));
      if (names.some(name => name.normalize('NFC').toLowerCase() === path.basename(target).normalize('NFC').toLowerCase()))
        throw new Error("같은 이름의 파일 또는 폴더가 있습니다.");
      await mkdir(target);
      return { path: relative };
    });
  }

  renameTreeEntry(from, to, { folder, revision } = {}) {
    return this.#enqueue(async () => {
      const word = !folder && validWordPath(from);
      const valid = folder ? validRelativePath : word ? validWordPath : validFilePath;
      if (!valid(from) || !valid(to) || from === to || path.posix.dirname(from) !== path.posix.dirname(to))
        throw new Error("같은 위치에서 사용할 수 있는 다른 이름을 입력해 주세요.");
      if (!folder && path.extname(from).toLowerCase() !== path.extname(to).toLowerCase())
        throw new Error("기존 확장자를 유지해 주세요.");
      const checkedPath = async name => folder
        ? path.dirname(await this.#file(`${name}/rename-${randomUUID()}.md`))
        : this.#file(name, false, valid);
      const source = await checkedPath(from);
      const entry = await lstat(source, { bigint: true });
      if (entry.isSymbolicLink() || !(folder ? entry.isDirectory() : entry.isFile()))
        throw new Error("보관함 안의 일반 파일이나 폴더를 선택해 주세요.");
      if (!folder && (revision || !word) && (word ? wordRevision(entry) : (await this.#binary(from)).revision) !== revision)
        throw new Error("외부에서 파일이 변경되었습니다. 새로고침해 주세요.");
      const destination = path.join(this.root, to);
      const existing = await lstat(destination, { bigint: true }).catch(error => {
        if (error.code !== "ENOENT") throw error;
        return null;
      });
      const sameName = from.normalize('NFC').toLowerCase() === to.normalize('NFC').toLowerCase();
      if (existing && !(sameName && sameEntry(entry, existing))) throw new Error("같은 이름의 파일 또는 폴더가 있습니다.");
      const snapshot = await this.#snapshot();
      const files = [...snapshot.notes, ...snapshot.documents, ...snapshot.wordDocuments, ...snapshot.attachments];
      const index = createLinkIndex(files), moved = name => renamedTreePath(name, from, to);
      const edits = [...snapshot.notes, ...snapshot.documents].flatMap(file => {
        const content = file.kind === "canvas" ? rewriteCanvasPaths(file.content, file.path, moved, files, index)
          : file.kind === "base" ? file.content : rewriteLinkPaths(file.content, file.path, moved, files, index);
        return content === file.content ? [] : [{ file, content, path: moved(file.path) }];
      });
      const current = await lstat(await checkedPath(from), { bigint: true });
      if (!sameEntry(entry, current) || current.mtimeNs !== entry.mtimeNs || current.ctimeNs !== entry.ctimeNs)
        throw new Error("이름을 바꾸기 전에 파일이나 폴더가 변경되었습니다.");
      // Reserve the destination on platforms where rename can replace an empty folder.
      const reserve = folder && !existing && process.platform !== "win32";
      if (reserve) await mkdir(destination);
      try {
        if (!folder && !existing) {
          await link(source, destination);
          try { await unlink(source); }
          catch (error) { await unlink(destination).catch(() => {}); throw error; }
        } else await rename(source, destination);
      }
      catch (error) { if (reserve) await rmdir(destination).catch(() => {}); throw error; }
      const saved = [];
      try {
        // Keep the renamed file's inode available for rollback until the other links are saved.
        edits.sort((a, b) => Number(a.file.path === from) - Number(b.file.path === from));
        for (const edit of edits) {
          const result = await this.#save(edit.path, edit.content, edit.file.revision);
          saved.push({ ...edit, revision: result.revision });
        }
      } catch (error) {
        for (const edit of saved.reverse()) await this.#save(edit.path, edit.file.content, edit.revision).catch(() => {});
        const actual = await lstat(destination, { bigint: true }).catch(() => null);
        if (actual && sameEntry(entry, actual) &&
            await realpath(destination).catch(() => null) === destination &&
            (existing || !await lstat(source).catch(() => null))) await rename(destination, source);
        throw error;
      }
      return this.#snapshot();
    });
  }

  moveFile(from, to, expectedRevision) {
    if (typeof from === 'string' && typeof to === 'string' && from !== to &&
        from.normalize('NFC').toLowerCase() === to.normalize('NFC').toLowerCase() &&
        path.posix.dirname(from) === path.posix.dirname(to))
      return this.renameTreeEntry(from, to, { folder: false, revision: expectedRevision });
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
      try {
        await writeFile(destination, movedBytes, { flag: "wx", mode: 0o600 });
      } catch (error) {
        if (error.code === "EEXIST") throw new Error("대상 폴더에 같은 이름의 문서가 있습니다.");
        throw error;
      }
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
