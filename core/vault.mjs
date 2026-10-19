import {
  open,
  realpath,
  lstat,
  readdir,
  mkdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const MAX_BYTES = 8 * 1024 * 1024;

export function validNotePath(value) {
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
    /\.md$/i.test(value)
  );
}

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
    if (!validNotePath(relative))
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
      if ((await handle.stat()).size > MAX_BYTES)
        throw new Error("8MB보다 큰 문서는 이 버전에서 열 수 없습니다.");
      const bytes = await handle.readFile();
      const content = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes);
      return { path: relative, content, revision: digest(bytes) };
    } finally {
      await handle.close();
    }
  }

  async snapshot() {
    await this.#tail;
    const notes = [];
    const warnings = [];
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
        } else if (item.isFile() && /\.md$/i.test(item.name)) {
          try {
            notes.push(await this.#read(relative));
          } catch (error) {
            warnings.push(`${relative}: ${error.message}`);
          }
        }
      }
    };
    await walk(this.root);
    notes.sort((a, b) => a.path.localeCompare(b.path, "ko"));
    return { id: this.id, name: this.name, notes, warnings };
  }

  create(relative) {
    return this.#enqueue(async () => {
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
    return this.#enqueue(async () => {
      if (typeof content !== "string" || Buffer.byteLength(content) > MAX_BYTES)
        throw new Error("문서는 8MB 이하여야 합니다.");
      const current = await this.#read(relative);
      if (current.revision !== expectedRevision)
        throw new Error(
          "외부에서 문서가 변경되었습니다. 초안을 복사한 뒤 새로고침해 주세요.",
        );
      if (current.content === content) return current;
      const target = await this.#file(relative);
      const backups = path.join(
        this.recoveryRoot,
        digest(relative).slice(0, 16),
      );
      await mkdir(backups, { recursive: true, mode: 0o700 });
      const backup = path.join(
        backups,
        `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}.md`,
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
      };
    });
  }
}
