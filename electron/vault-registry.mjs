import { readFile, writeFile, rename, mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export class VaultRegistry {
  constructor(file) { this.file = file; this.selected = null; this.roots = []; }
  async load() {
    try {
      const data = JSON.parse(await readFile(this.file, "utf8"));
      if (data.vaultRoot != null && (typeof data.vaultRoot !== "string" || !path.isAbsolute(data.vaultRoot)))
        throw new Error("invalid vault");
      this.selected = data.vaultRoot ? await realpath(data.vaultRoot).catch(() => data.vaultRoot) : null;
      const roots = [this.selected, ...(Array.isArray(data.vaults) ? data.vaults : [])]
        .filter((root) => typeof root === "string" && path.isAbsolute(root));
      this.roots = [...new Set(await Promise.all(roots.map((root) => realpath(root).catch(() => root))))];
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error("보관함 설정을 읽지 못했습니다. 기존 설정 파일을 확인해 주세요.");
    }
  }
  list() { return this.roots.map((root) => ({ root, name: path.basename(root), active: root === this.selected })); }
  async save(selected, roots) {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ vaultRoot: selected, vaults: roots }), { mode: 0o600 });
    await rename(temporary, this.file);
    this.selected = selected; this.roots = roots;
  }
  async select(root) {
    const canonical = await realpath(root);
    if (!(await stat(canonical)).isDirectory()) throw new Error("폴더를 선택해 주세요.");
    await this.save(canonical, [...new Set([canonical, ...this.roots])]);
  }
  async forget(root) {
    if (root === this.selected) throw new Error("사용 중인 보관함은 목록에서 제거할 수 없습니다.");
    await this.save(this.selected, this.roots.filter((value) => value !== root));
  }
}
