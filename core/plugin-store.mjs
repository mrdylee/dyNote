import { mkdir, lstat, open, readFile, writeFile, readdir, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const pluginId = id => {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) throw new Error('올바른 플러그인 ID가 아닙니다.');
  return id;
};
const vaultId = id => {
  if (typeof id !== 'string' || !/^[a-f0-9]{16}$/.test(id)) throw new Error('올바른 보관함 ID가 아닙니다.');
  return id;
};
const manifestValue = data => {
  pluginId(data?.id);
  if (typeof data.name !== 'string' || !data.name.trim() || typeof data.version !== 'string' || !data.version.trim()) throw new Error('플러그인 manifest의 이름과 버전이 필요합니다.');
  return data;
};
async function programFile(folder, name, optional = false) {
  try {
    const file = path.join(folder, name), stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('플러그인 프로그램은 링크가 아닌 일반 파일이어야 합니다.');
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      if ((await handle.stat()).size > 8 * 1024 * 1024) throw new Error('플러그인 파일은 8MB 이하여야 합니다.');
      return await handle.readFile();
    } finally { await handle.close(); }
  } catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
}
async function json(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
async function saveJson(file, data) {
  const content = JSON.stringify(data);
  if (typeof content !== 'string' || Buffer.byteLength(content) > 1024 * 1024) throw new Error('플러그인 설정은 1MB 이하여야 합니다.');
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, content, { mode: 0o600 }); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}

export class PluginStore {
  #tail = Promise.resolve();
  constructor(directory) { this.directory = directory; }
  #enqueue(operation) { const result = this.#tail.then(operation); this.#tail = result.catch(() => {}); return result; }
  import(folder) {
    return this.#enqueue(async () => {
      const stat = await lstat(folder);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('플러그인 폴더는 링크가 아닌 일반 폴더여야 합니다.');
      const manifestBytes = await programFile(folder, 'manifest.json');
      const manifest = manifestValue(JSON.parse(manifestBytes.toString('utf8')));
      const source = await programFile(folder, 'main.js'), css = await programFile(folder, 'styles.css', true);
      const programs = path.join(this.directory, 'programs'); await mkdir(programs, { recursive: true });
      const temporary = path.join(programs, `.import-${randomUUID()}`), target = path.join(programs, manifest.id), old = `${temporary}-old`;
      await mkdir(temporary);
      try {
        await writeFile(path.join(temporary, 'manifest.json'), manifestBytes, { mode: 0o600 });
        await writeFile(path.join(temporary, 'main.js'), source, { mode: 0o600 });
        if (css) await writeFile(path.join(temporary, 'styles.css'), css, { mode: 0o600 });
        let moved = false;
        try { await rename(target, old); moved = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
        try { await rename(temporary, target); }
        catch (error) { if (moved) await rename(old, target); throw error; }
        await rm(old, { recursive: true, force: true });
        return manifest;
      } finally { await rm(temporary, { recursive: true, force: true }); }
    });
  }
  async program(id) {
    const folder = path.join(this.directory, 'programs', pluginId(id));
    const manifest = manifestValue(JSON.parse((await programFile(folder, 'manifest.json')).toString('utf8')));
    if (manifest.id !== id) throw new Error('플러그인 ID가 폴더와 다릅니다.');
    return { manifest, source: (await programFile(folder, 'main.js')).toString('utf8'), css: (await programFile(folder, 'styles.css', true))?.toString('utf8') || '' };
  }
  async list(vault) {
    const enabled = await json(path.join(this.directory, 'vaults', vaultId(vault), 'enabled.json'), []);
    let entries;
    try { entries = await readdir(path.join(this.directory, 'programs'), { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const result = [];
    for (const entry of entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))) {
      const { manifest } = await this.program(entry.name);
      result.push({ ...manifest, enabled: enabled.includes(manifest.id) });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }
  setEnabled(vault, id, enabled) {
    return this.#enqueue(async () => {
      await this.program(id);
      const file = path.join(this.directory, 'vaults', vaultId(vault), 'enabled.json');
      const ids = new Set(await json(file, []));
      if (enabled) ids.add(id); else ids.delete(id);
      await saveJson(file, [...ids]);
    });
  }
  async loadData(vault, id) { return json(path.join(this.directory, 'vaults', vaultId(vault), `${pluginId(id)}.json`), null); }
  saveData(vault, id, data) { return this.#enqueue(() => saveJson(path.join(this.directory, 'vaults', vaultId(vault), `${pluginId(id)}.json`), data)); }
}
