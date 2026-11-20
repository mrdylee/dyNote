import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class DocumentDrafts {
  #tail = Promise.resolve();
  constructor(directory) { this.directory = directory; }
  file(id) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('잘못된 임시 문서입니다.');
    return path.join(this.directory, `${id}.json`);
  }
  enqueue(operation) {
    const result = this.#tail.then(operation);
    this.#tail = result.catch(() => {});
    return result;
  }
  list() {
    return this.enqueue(async () => {
      const names = await readdir(this.directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
      return Promise.all(names.filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).map(name => readFile(path.join(this.directory, name), 'utf8').then(JSON.parse)));
    });
  }
  write(value) {
    return this.enqueue(async () => {
      const { id, vaultId, source, fileName, content, promptId } = value;
      const file = this.file(id);
      if (!/^[a-f0-9]{16}$/.test(vaultId) || !source ||
          (content !== null && typeof content !== 'string') ||
          ![source.path, source.title, source.content, fileName, promptId].every(item => typeof item === 'string'))
        throw new Error('잘못된 임시 문서 내용입니다.');
      const draft = { id, vaultId, source: { path: source.path, title: source.title, content: source.content }, fileName, content, promptId };
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(draft), { flag: 'wx', mode: 0o600 });
        await rename(temporary, file);
      } finally { await rm(temporary, { force: true }); }
      return draft;
    });
  }
  remove(id) { return this.enqueue(() => rm(this.file(id), { force: true })); }
}
