import { readFile, writeFile, rename, mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export class VaultRegistry {
  constructor(file) { this.file = file; this.selected = null; this.roots = []; this.purposes = {}; }
  async load() {
    try {
      const data = JSON.parse(await readFile(this.file, "utf8"));
      if (data.vaultRoot != null && (typeof data.vaultRoot !== "string" || !path.isAbsolute(data.vaultRoot)))
        throw new Error("invalid vault");
      this.selected = data.vaultRoot ? await realpath(data.vaultRoot).catch(() => data.vaultRoot) : null;
      const roots = [this.selected, ...(Array.isArray(data.vaults) ? data.vaults : [])]
        .filter((root) => typeof root === "string" && path.isAbsolute(root));
      this.roots = [...new Set(await Promise.all(roots.map((root) => realpath(root).catch(() => root))))];
      const purposes = await Promise.all(Object.entries(data.vaultPurposes ?? {})
        .filter(([root, purpose]) => path.isAbsolute(root) && ["personal", "team"].includes(purpose))
        .map(async ([root, purpose]) => [await realpath(root).catch(() => root), purpose]));
      this.purposes = Object.fromEntries(purposes.filter(([root]) => this.roots.includes(root)));
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error("보관함 설정을 읽지 못했습니다. 기존 설정 파일을 확인해 주세요.");
    }
  }
  list() { return this.roots.map((root) => ({ root, name: path.basename(root), active: root === this.selected, purpose: this.purposes[root] ?? null })); }
  async save(selected, roots, purposes = this.purposes) {
    purposes = Object.fromEntries(Object.entries(purposes).filter(([root]) => roots.includes(root)));
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ vaultRoot: selected, vaults: roots, vaultPurposes: purposes }), { mode: 0o600 });
    await rename(temporary, this.file);
    this.selected = selected; this.roots = roots; this.purposes = purposes;
  }
  async checkPurpose(root, purpose) {
    if (purpose !== undefined && !["personal", "team"].includes(purpose)) throw new Error("개인 또는 팀 공간 용도를 선택해 주세요.");
    const canonical = await realpath(root);
    if (!(await stat(canonical)).isDirectory()) throw new Error("폴더를 선택해 주세요.");
    const next = purpose ?? this.purposes[canonical];
    if (next && this.roots.some(other => other !== canonical && this.purposes[other] && this.purposes[other] !== next &&
      (canonical.startsWith(other.endsWith(path.sep) ? other : other + path.sep) || other.startsWith(canonical.endsWith(path.sep) ? canonical : canonical + path.sep))))
      throw new Error("개인·팀 폴더는 서로 포함할 수 없습니다. 다른 폴더와 Git 저장소를 선택해 주세요.");
    return canonical;
  }
  async select(root, purpose) {
    const canonical = await this.checkConnection(root, purpose);
    await this.save(canonical, [...new Set([canonical, ...this.roots])], { ...this.purposes, ...(purpose ? { [canonical]: purpose } : {}) });
  }
  async checkConnection(root, purpose) {
    const canonical = await this.checkPurpose(root, purpose);
    if (purpose && this.purposes[canonical] && this.purposes[canonical] !== purpose)
      throw new Error("이미 다른 용도로 등록된 폴더입니다. 별도 폴더를 선택하거나 목록의 ‘공간 용도’에서 변경해 주세요.");
    return canonical;
  }
  async setPurpose(root, purpose) {
    if (!this.roots.includes(root)) throw new Error("등록된 보관함을 선택해 주세요.");
    await this.checkPurpose(root, purpose);
    if (!purpose) throw new Error("개인 또는 팀 공간 용도를 선택해 주세요.");
    await this.save(this.selected, this.roots, { ...this.purposes, [root]: purpose });
  }
  async forget(root) {
    if (root === this.selected) throw new Error("사용 중인 보관함은 목록에서 제거할 수 없습니다.");
    await this.save(this.selected, this.roots.filter((value) => value !== root));
  }
}
