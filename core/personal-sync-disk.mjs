import { constants } from "node:fs";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { assertSyncEntry, blobLimit, isSyncDocumentText, isSyncRecordText, textConflictFolders, syncPrefix } from "./personal-sync-store.mjs";
import { checkTreeChanges } from "./personal-sync-merge.mjs";

export const batchLimit = 512 * 1024 * 1024;
const missing = (error) => {
  if (error.code !== "ENOENT") throw error;
  return null;
};
const fold = (s) => s.normalize("NFC").toLowerCase();

function storageError(error, operation) {
  if (typeof error.code !== "string" || error.syncReason) {
    error.syncStage ??= "apply";
    return error;
  }
  let advice = "저장 위치의 연결 상태를 확인한 뒤 다시 동기화해 주세요.";
  if (["ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV"].includes(error.code))
    advice = "이 위치에서 필요한 파일 교체를 지원하지 않습니다. 하드링크와 이름 변경을 지원하는 같은 드라이브에 보관함을 연결해 주세요.";
  else if (["EBUSY", "EAGAIN", "ETXTBSY"].includes(error.code))
    advice = "파일을 사용하는 프로그램을 닫은 뒤 다시 동기화해 주세요.";
  else if (["EACCES", "EPERM", "EROFS"].includes(error.code))
    advice = "열린 파일을 닫고 보관함의 쓰기·이름 변경 권한을 확인한 뒤 다시 동기화해 주세요.";
  else if (["ENOSPC", "EDQUOT"].includes(error.code))
    advice = "저장 위치에 여유 공간을 확보한 뒤 다시 동기화해 주세요.";
  else if (error.code === "EEXIST")
    advice = "같은 경로에 생긴 파일을 보존했습니다. 다시 동기화하면 변경된 버전을 확인할 수 있습니다.";
  return Object.assign(new Error(operation + " " + advice, { cause: error }), { code: error.code, syncStage: "apply" });
}

export async function atomicJson(file, object) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + "." + randomUUID() + ".tmp";
  try {
    await writeFile(tmp, JSON.stringify(object), { flag: "wx", mode: 0o600, flush: true });
    await rename(tmp, file);
  } finally {
    await rm(tmp, { force: true });
  }
}

async function target(root, name, createParents = false) {
  assertSyncEntry(name, null);
  if ((await realpath(root)) !== root) throw new Error("보관함 위치가 변경되었습니다.");
  let current = root;
  const parts = name.split("/");
  for (const [index, part] of parts.entries()) {
    const entries = await readdir(current).catch(missing);
    if (entries && entries.some((other) => other !== part && fold(other) === fold(part)))
      throw new Error("대소문자 또는 유니코드 경로 충돌: " + name);
    current = path.join(current, part);
    const info = await lstat(current).catch(missing);
    if (info && (index === parts.length - 1 ? !info.isFile() : !info.isDirectory()))
      throw new Error("링크 또는 특수 파일을 동기화할 수 없습니다: " + name);
    if (!info && createParents && index < parts.length - 1) {
      await mkdir(current, { mode: 0o700 }).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
      if (!(await lstat(current)).isDirectory()) throw new Error("동기화 경로가 변경되었습니다.");
    }
  }
  return current;
}

function signature(info) {
  return [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(":");
}

export async function readStable(file, format, limit = blobLimit) {
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(missing);
  if (!handle) return null;
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(limit))
      throw new Error("파일당 25 MiB 한도를 확인해 주세요: " + path.basename(file));
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await lstat(file, { bigint: true }).catch(missing);
    if (
      bytes.length !== offset ||
      !after ||
      signature(before) !== signature(after) ||
      signature(before) !== signature(await handle.stat({ bigint: true }))
    )
      throw new Error("복사 또는 편집 중인 파일입니다: " + path.basename(file));
    const oid = createHash(format)
      .update("blob " + bytes.length + "\0")
      .update(bytes)
      .digest("hex");
    return { oid, bytes, mode: Number(before.mode), signature: signature(after) };
  } finally {
    await handle.close();
  }
}

export function windowsCheckoutBytes(stored) {
  if (stored.includes(13) || stored.includes(0) || !stored.includes(10)) return null;
  let length = stored.length;
  for (const byte of stored) if (byte === 10) length++;
  const checkout = Buffer.allocUnsafe(length);
  let offset = 0;
  for (const byte of stored) {
    if (byte === 10) checkout[offset++] = 13;
    checkout[offset++] = byte;
  }
  return checkout;
}

export class PersonalSyncDisk {
  constructor(store, format, limit = batchLimit) {
    this.store = store;
    this.format = format;
    this.limit = limit;
    this.dir = path.join(store.root, ".git", "dynote-personal");
    this.journal = path.join(this.dir, "apply.json");
  }
  async read(name) {
    return readStable(await target(this.store.root, name), this.format);
  }
  async matchesBlob(name, current, oid, folders, exact = false) {
    if (process.platform !== "win32" && name.startsWith(syncPrefix + "devices/") && (current?.mode & 0o111))
      throw Object.assign(new Error("동기화 관리 파일의 실행 권한이 변경되었습니다. 파일 권한을 확인해 주세요: " + name),
        { syncReason: "managed-record", syncStage: "apply" });
    if ((current?.oid ?? null) === oid) return true;
    if (exact || !current || !oid || !(isSyncRecordText(name, folders) || isSyncDocumentText(name)) || !current.bytes.includes("\r\n")) return false;
    const stored = await this.store.blob(oid);
    // Compare the complete Windows checkout representation without decoding or rewriting either file.
    return stored.length < current.bytes.length && windowsCheckoutBytes(stored)?.equals(current.bytes) === true;
  }
  async head(ref = "HEAD") {
    return (await this.store.git(["rev-parse", "--verify", "-q", ref], { allow: [0, 1] })).stdout.trim() || null;
  }
  async job() {
    const raw = await readFile(this.journal, "utf8").catch(missing);
    if (!raw) return null;
    const job = JSON.parse(raw),
      uuid = (s) => typeof s === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(s);
    const oid = (s) => typeof s === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(s);
    if (
      !uuid(job.id) ||
      !oid(job.next) ||
      (job.previous !== null && !oid(job.previous)) ||
      !Array.isArray(job.records) ||
      !Array.isArray(job.captured) ||
      !Number.isSafeInteger(job.offset) ||
      job.offset < 0 ||
      job.offset > job.records.length
    )
      throw new Error("중단된 동기화의 로컬 기록을 확인해 주세요.");
    for (const row of job.records) {
      assertSyncEntry(row.name, null);
      if (!uuid(row.saved) || (row.before !== null && !oid(row.before)) || (row.after !== null && !oid(row.after)))
        throw new Error("파일 복구 기록이 손상되었습니다.");
    }
    return job;
  }

  async recoveryPath(id) {
    const unavailable = () => new Error("진행 중인 수신 작업의 복구 사본을 확인할 수 없습니다.");
    if (await realpath(this.dir) !== this.dir || !(await this.job())?.records.some(row => row.saved === id))
      throw unavailable();
    const file = path.join(this.dir, id);
    if (!(await lstat(file).catch(missing))?.isFile()) throw unavailable();
    return file;
  }

  async restoreOriginal(job, row, failure, onlyMissing = false) {
    if (onlyMissing && row.verified !== undefined) return;
    const backup = path.join(this.dir, row.saved);
    if (!(await lstat(backup).catch(missing))?.isFile()) return;
    const showBackup = () => {
      if (failure.recoveryFile) return;
      failure.recoveryFile = row.saved;
      failure.message += " 원본 복구 사본은 " + path.join(".git", "dynote-personal", row.saved) + "에 있습니다.";
    };
    if (onlyMissing && row.restored === row.saved) {
      showBackup();
      return;
    }
    try {
      const file = await target(this.store.root, row.name);
      if (onlyMissing && await lstat(file).catch(missing)) {
        if (!(await this.matchesBlob(row.name, await readStable(file, this.format), row.after, new Set()))) showBackup();
        return;
      }
      // Keep the displaced inode for open editors. Both recovery operations refuse an occupied name.
      try {
        await link(backup, file);
      } catch (error) {
        if (error.code === "EEXIST") throw error;
        await copyFile(backup, file, constants.COPYFILE_EXCL);
      }
      failure.message += " ‘" + row.name + "’의 이전 내용을 원래 경로에 복구했습니다.";
    } catch (error) {
      showBackup();
      if (error.code !== "EEXIST") return;
    }
    if (row.restored !== row.saved) {
      // If this visible path disappears before retry, the user's deletion is a separate version.
      row.restored = row.saved;
      await atomicJson(this.journal, job);
    }
  }

  async checkStorage() {
    if (this.storageChecked) return;
    try {
      const work = await mkdtemp(path.join(this.store.root, ".dynote-probe-"));
      try {
        const recovery = await mkdtemp(path.join(this.dir, "probe-"));
        try {
          const file = path.join(work, "file"), moved = path.join(recovery, "moved");
          await writeFile(file, "probe", { flag: "wx", mode: 0o600, flush: true });
          await rename(file, moved);
          await link(moved, file);
        } finally {
          await rm(recovery, { recursive: true, force: true });
        }
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    } catch (error) {
      const failure = storageError(error, "개인 동기화 저장 위치 검사에 실패했습니다.");
      const job = await this.job();
      for (const row of job?.records.slice(job.offset) ?? [])
        if (row.before && row.after) await this.restoreOriginal(job, row, failure, true);
      throw failure;
    }
    this.storageChecked = true;
  }

  async begin(branch, previous, next, captured = []) {
    if (previous === next) return;
    const [before, after] = await Promise.all([this.store.tree(previous), this.store.tree(next)]);
    const changes = checkTreeChanges(before, after);
    const records = [...changes].map((name) => ({
      name,
      before: before.get(name)?.oid ?? null,
      after: after.get(name)?.oid ?? null,
      mode: after.get(name)?.mode,
      size: after.get(name)?.size ?? 0,
      saved: randomUUID(),
    }));
    await this.startJob(branch, previous, next, records, captured);
  }
  async startJob(branch, previous, next, records, captured = []) {
    const job = { branch, previous, next, records, captured, offset: 0, id: randomUUID() };
    // No worktree write precedes the durable candidate and the recovery manifest.
    await this.store.git(["update-ref", "refs/dynote-sync/apply", next]);
    await atomicJson(this.journal, job);
  }

  async finishIndex(job) {
    const store = this.store,
      head = await this.head();
    const nextIndex = path.join(this.dir, job.id + ".index"),
      actual = path.join(store.root, ".git", "index"),
      lock = actual + ".lock";
    if (!(await stat(nextIndex).catch(missing)))
      await store.git(["read-tree", job.next], { privateIndex: nextIndex });
    await link(nextIndex, lock).catch(async (error) => {
      if (error.code !== "EEXIST") throw error;
      const [ours, theirs] = await Promise.all([stat(nextIndex, { bigint: true }), stat(lock, { bigint: true })]);
      if (ours.ino !== theirs.ino || ours.dev !== theirs.dev)
        throw new Error("다른 Git 작업이 인덱스를 사용 중입니다.");
    });
    let locked = true;
    try {
      const check = path.join(this.dir, job.id + ".check");
      await rm(check, { force: true });
      const copied = await copyFile(actual, check)
        .then(() => true)
        .catch(missing);
      if (!copied) await store.git(["read-tree", "--empty"], { privateIndex: check });
      const indexed = (await store.git(["write-tree"], { privateIndex: check })).stdout.trim();
      const treeOf = async (ref) =>
        (await store.git(ref ? ["rev-parse", ref + "^{tree}"] : ["mktree"], { input: "" })).stdout.trim();
      if (indexed !== (await treeOf(job.previous)) && !(head === job.next && indexed === (await treeOf(job.next))))
        throw new Error("직접 스테이징한 변경사항이 있습니다.");
      if (
        (await store.git(["symbolic-ref", "HEAD"])).stdout.trim() !== "refs/heads/" + job.branch ||
        (head !== job.previous && head !== job.next)
      )
        throw new Error("적용 중 Git 브랜치가 변경되었습니다.");
      if (head !== job.next)
        await store.git(["update-ref", "refs/heads/" + job.branch, job.next, head ?? "0".repeat(job.next.length)]);
      await rename(lock, actual);
      locked = false;
      await rm(check, { force: true });
    } finally {
      if (locked) await rm(lock, { force: true });
    }
    await rm(this.journal, { force: true });
    await rm(nextIndex, { force: true });
    await store.git(["update-ref", "-d", "refs/dynote-sync/apply", job.next]);
  }

  async resume() {
    const job = await this.job();
    if (!job) return { changed: [] };
    const captured = new Set(job.captured);
    const folders = new Set();
    if (job.records.some(row => row.name.startsWith(syncPrefix) && row.name.endsWith(".blob"))) {
      for (const ref of [job.previous, job.next]) {
        const { groups } = await this.store.metadata(await this.store.tree(ref));
        for (const folder of textConflictFolders(groups)) folders.add(folder);
      }
    }
    let used = 0;
    if ((await this.head()) !== job.previous && (await this.head()) !== job.next)
      throw new Error("적용 중 브랜치가 변경되었습니다.");
    for (; job.offset < job.records.length; job.offset++) {
      const row = job.records[job.offset];
      if (used && used + row.size > this.limit) {
        await atomicJson(this.journal, job);
        return { waiting: true, changed: [] };
      }
      if (captured.has(row.name)) continue; // New input after a local checkpoint stays dirty.
      let temp, failure;
      try {
        const file = await target(this.store.root, row.name, true);
        let backup = path.join(this.dir, row.saved);
        const current = await readStable(file, this.format);
        if (await this.matchesBlob(row.name, current, row.after, folders)) {
          row.verified = current?.signature ?? null;
          continue;
        }
        const displaced = await lstat(backup).catch(missing);
        if (displaced && !row.name.startsWith(syncPrefix) && !(await stat(backup + ".source.json").catch(missing)))
          await atomicJson(backup + ".source.json", { name: row.name, parent: job.previous, oid: row.before });
        const interruptedMove = displaced && !current && row.restored !== row.saved;
        // A same-head repair records the exact checkout hash, which need not exist in Git.
        const repair = job.previous === job.next;
        const managedChange = () => Object.assign(new Error("수신 도중 동기화 관리 파일이 변경되었습니다. ‘" + row.name + "’을 확인해 주세요."),
          { syncReason: "managed-record", syncStage: "apply" });
        if (!(await this.matchesBlob(row.name, current, row.before, folders, repair)) && !interruptedMove) {
          if (row.name.startsWith(syncPrefix)) throw managedChange();
          // Reconcile this independent input against its actual parent on the next pass.
          return {
            diverged: { name: row.name, entry: current && (await this.store.storeBytes(current.bytes)), job },
            changed: [],
          };
        }
        if (row.after) {
          const bytes = await this.store.blob(row.after);
          temp = path.join(this.dir, randomUUID() + ".part");
          await writeFile(temp, bytes, { flag: "wx", mode: row.mode === "100755" ? 0o755 : 0o644, flush: true });
        }
        if (current) {
          if (displaced) {
            // A previous attempt restored the visible file. Keep both inodes available to their editors.
            row.saved = randomUUID();
            await atomicJson(this.journal, job);
            backup = path.join(this.dir, row.saved);
          }
          if (!row.name.startsWith(syncPrefix))
            await atomicJson(backup + ".source.json", { name: row.name, parent: job.previous, oid: current.oid });
          await rename(file, backup);
        }
        if (current || displaced) {
          const moved = await readStable(backup, this.format);
          if (!(await this.matchesBlob(row.name, moved, row.before, folders, repair))) {
            if (row.name.startsWith(syncPrefix)) throw managedChange();
            return {
              diverged: { name: row.name, entry: await this.store.storeBytes(moved.bytes), job },
              changed: [],
            };
          }
        }
        if (temp) await link(temp, file);
        const applied = await readStable(file, this.format);
        if (await this.matchesBlob(row.name, applied, row.after, folders)) row.verified = applied?.signature ?? null;
        used += row.size;
      } catch (error) {
        this.storageChecked = false;
        failure = storageError(error, "‘" + row.name + "’ 파일을 적용하지 못했습니다.");
        await this.restoreOriginal(job, row, failure);
        throw failure;
      } finally {
        if (temp) await rm(temp, { force: true }).catch(error => {
          if (!failure) throw storageError(error, "임시 수신 파일을 정리하지 못했습니다.");
        });
      }
    }
    // A completed chunk might have been edited while the application was stopped.
    for (const row of job.records) {
      if (captured.has(row.name)) continue;
      const file = await target(this.store.root, row.name);
      const info = await lstat(file, { bigint: true }).catch(missing);
      if (row.verified === (info ? signature(info) : null)) continue;
      const current = await readStable(file, this.format);
      if (!(await this.matchesBlob(row.name, current, row.after, folders))) {
        if (row.name.startsWith(syncPrefix)) throw new Error("수신 도중 공유 메타데이터가 변경되었습니다.");
        job.offset = job.records.indexOf(row);
        return {
          diverged: {
            name: row.name,
            entry: current && (await this.store.storeBytes(current.bytes)),
            job,
            parent: job.next,
          },
          changed: [],
        };
      }
    }
    await this.finishIndex(job);
    return {
      changed: job.records.map((r) => r.name).filter((name) => !name.startsWith(syncPrefix) && !captured.has(name)),
    };
  }
}
