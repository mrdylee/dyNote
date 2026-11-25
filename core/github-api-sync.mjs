import { readdir, lstat, readFile, rm, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { validPersonalFilePath } from "./vault.mjs";
import { completeArchive } from "./personal-sync.mjs";
import { atomicJson } from "./personal-sync-disk.mjs";
import { blobSha } from "./github-remote.mjs";

function checkNames(names) {
  const seen = new Map();
  for (const name of names) {
    const parts = name.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join("/");
      const key = prefix.normalize("NFC").toLowerCase();
      if (seen.has(key) && seen.get(key) !== prefix)
        throw new Error("표기만 다른 파일 경로를 확인해 주세요: " + name);
      seen.set(key, prefix);
    }
  }
}

export async function scanApiFiles(vault, cache) {
  const files = new Map();
  async function walk(relative) {
    const entries = await readdir(path.join(vault.root, relative), { withFileTypes: true });
    if (entries.some((entry) => [".git", ".gitignore"].includes(entry.name.toLowerCase())))
      throw new Error("GitHub API 동기화에는 .git 또는 .gitignore가 없는 일반 노트 폴더를 선택해 주세요.");
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const name = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error("링크가 포함된 노트 폴더를 확인해 주세요: " + name);
      if (entry.isDirectory()) {
        await walk(name);
        continue;
      }
      if (!validPersonalFilePath(name)) continue;
      if (!entry.isFile()) throw new Error("일반 파일만 동기화할 수 있습니다: " + name);
      const stat = await lstat(path.join(vault.root, name), { bigint: true });
      const stamp = [stat.dev, stat.ino, stat.size, stat.ctimeNs, stat.mtimeNs].join("/");
      let row = cache.get(name);
      if (row?.stamp !== stamp) {
        const current = (await vault.captureSelection([name])).files[0];
        if (!current) throw new Error("파일이 이동되었습니다. 다시 동기화해 주세요.");
        row = { stamp, sha: blobSha(current.bytes), size: current.bytes.length };
        cache.set(name, row);
      }
      files.set(name, row.sha);
    }
  }
  await walk("");
  for (const name of cache.keys()) if (!files.has(name)) cache.delete(name);
  return files;
}

function conflictName(name, sha, index) {
  const ext = path.posix.extname(name);
  return name.slice(0, -ext.length) + " (충돌 " + sha.slice(0, 10) + (index === 1 ? "" : "-" + index) + ")" + ext;
}

export async function preserveApiDraft(vault, name, content) {
  const sha = blobSha(Buffer.from(content));
  for (let i = 1; ; i++) {
    const copy = await vault.openOrCreate(conflictName(name, sha, i), content);
    if (copy.content === content) return { ...copy, path: name, preserved: true, conflictPath: copy.path };
  }
}

function plan(base, local, remote) {
  const desired = new Map(remote),
    copies = new Map(),
    conflicts = [];
  const names = new Set([...base.keys(), ...local.keys(), ...remote.keys()]);
  checkNames(names);
  for (const name of names) {
    const before = base.get(name),
      mine = local.get(name),
      theirs = remote.get(name);
    if (mine === before || mine === theirs) continue;
    if (theirs === before) {
      if (mine) desired.set(name, mine);
      else desired.delete(name);
      continue;
    }
    if (!mine) {
      conflicts.push(name + " · 삭제와 수정이 겹쳐 원격 수정본 유지");
      continue;
    }
    // Stable names let a retry recognize a copy published just before an interruption.
    let copy;
    for (let index = 1; ; index++) {
      copy = conflictName(name, mine, index);
      if (![base, local, remote, desired].some((files) => files.has(copy))) break;
      if (!base.has(copy) && remote.get(copy) === mine && (!local.has(copy) || local.get(copy) === mine)) break;
    }
    desired.set(copy, mine);
    copies.set(copy, name);
    conflicts.push(copy);
  }
  checkNames([...names, ...desired.keys()]);
  for (const name of desired.keys()) {
    const parts = name.split("/");
    for (let i = 1; i < parts.length; i++)
      if (desired.has(parts.slice(0, i).join("/"))) throw new Error("같은 경로에 파일과 폴더가 있습니다: " + name);
  }
  return { desired, copies, conflicts };
}

function changed(from, to) {
  return [...new Set([...from.keys(), ...to.keys()])].filter((name) => from.get(name) !== to.get(name));
}

export async function syncApiVault(vault, remote, previous, cache, onTransfer, connectionId) {
  const base = new Map(previous?.files || []);
  const baseHead = previous?.head ?? null;
  const target = { remote: remote.url, branch: remote.branch, connection: connectionId ?? null, baseHead };
  const receiptFile = remote.url && remote.branch && vault.recoveryRoot && path.join(vault.recoveryRoot, "github-api-receipt.json");
  let receipt;
  if (receiptFile) {
    try { receipt = JSON.parse(await readFile(receiptFile, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (!receipt || receipt.remote !== target.remote || receipt.branch !== target.branch || receipt.connection !== target.connection)
    receipt = null;
  if (receipt && !receipt.pending && previous && receipt.head === baseHead) {
    await rm(receiptFile);
    receipt = null;
  }
  if (receipt?.baseHead !== baseHead) receipt = null;
  const applied = new Map(receipt?.files);
  for (const [name, sha] of applied) {
    if (sha) base.set(name, sha);
    else base.delete(name);
  }
  const local = await scanApiFiles(vault, cache);
  const read = async (name, expected) => {
    const file = (await vault.captureSelection([name])).files[0];
    if (!file || blobSha(file.bytes) !== expected)
      throw new Error("전송 중 편집된 파일이 있습니다. 다시 동기화해 주세요.");
    if (!completeArchive(name, file.bytes)) throw new Error("파일 복사 완료 후 다시 동기화해 주세요: " + name);
    return file.bytes;
  };
  let uploaded = receipt?.uploaded ?? false, seedCommit = null;
  let anchor = receipt?.head ?? previous?.head;
  let pending = receipt?.pending;
  const writeReceipt = async (head, files, pendingCommit) => {
    if (!receiptFile) return;
    await mkdir(vault.recoveryRoot, { recursive: true, mode: 0o700 });
    const directory = await realpath(vault.recoveryRoot);
    if (directory === vault.root || directory.startsWith(vault.root + path.sep))
      throw new Error("동기화 복구 기록은 보관함 밖에 보관해야 합니다.");
    await atomicJson(receiptFile, { ...target, head, files: [...files], uploaded, pending: pendingCommit });
  };
  const remember = async (head, names, desired) => {
    const files = new Map(applied);
    for (const name of names) files.set(name, desired.get(name) ?? null);
    await writeReceipt(head, files);
    for (const name of names) applied.set(name, files.get(name));
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    let head = seedCommit ?? await remote.head();
    seedCommit = null;
    if (pending) {
      const confirmed = pending.seed ? await remote.findSeed(pending.seed, head) :
        (await remote.contains(pending.head, head) ? pending.head : null);
      if (confirmed) {
        for (const [name, sha] of pending.files) {
          applied.set(name, sha);
          if (sha) base.set(name, sha);
          else base.delete(name);
        }
        anchor = confirmed;
        uploaded = true;
      }
      await writeReceipt(anchor ?? null, applied);
      pending = null;
    }
    if (!receipt && previous && head === previous.head && !changed(base, local).length)
      return { state: previous, changed: [], conflicts: [], uploaded: false };
    const snapshot = await remote.snapshot(head, anchor);
    const { desired, copies, conflicts } = plan(base, local, snapshot.files);
    const outgoing = changed(snapshot.files, desired);
    const source = (name) => copies.get(name) ?? name;
    const incoming = changed(local, desired);
    if (outgoing.length || incoming.length) onTransfer();
    if (outgoing.length) {
      const updates = new Map(outgoing.map((name) => [name, desired.get(name) ?? null]));
      const publishedPaths = head ? outgoing : outgoing.slice(0, 1);
      // A generated conflict copy becomes part of this PC's baseline only once its bytes reach disk.
      const localUpdates = publishedPaths.filter(name => local.get(name) === desired.get(name));
      let proposed = false;
      try {
        const published = await remote.publish(head, snapshot, updates, (name, sha) => read(source(name), sha), async (candidate) => {
          proposed = true;
          // The ref may advance even when the connection drops before its response arrives.
          await writeReceipt(anchor ?? null, applied, { ...candidate, files: localUpdates.map(name => [name, desired.get(name) ?? null]) });
        });
        uploaded = true;
        await remember(published, localUpdates, desired);
        anchor = published;
        if (!head && outgoing.length > 1) {
          // The Contents API confirmed this commit even if the ref endpoint still reports an empty repo.
          seedCommit = published;
          continue;
        }
        head = published;
      } catch (error) {
        if (proposed && error.status >= 400 && error.status < 500) await writeReceipt(anchor ?? null, applied);
        if ([409, 422].includes(error.status) && (await remote.head()) !== head) continue;
        throw error;
      }
    }
    // Keep both preimages and downloaded bytes bounded even on the first import of a large vault.
    const sizes = new Map(snapshot.entries.map((row) => [row.path, row.size]));
    for (let start = 0; start < incoming.length;) {
      let end = start,
        bytes = 0;
      while (end < incoming.length && bytes < 64 * 1024 * 1024) {
        const name = incoming[end++];
        bytes +=
          (cache.get(name)?.size ?? 0) +
          (copies.has(name) ? cache.get(source(name)).size : (sizes.get(name) ?? 0));
      }
      const batch = incoming.slice(start, end);
      const before = await vault.captureSelection(batch);
      const actual = new Map(before.files.map((file) => [file.path, blobSha(file.bytes)]));
      const files = [];
      for (const name of batch) {
        if (actual.get(name) !== local.get(name))
          throw new Error("수신 중 편집된 파일이 있습니다. 다시 동기화해 주세요.");
        const sha = desired.get(name);
        if (sha) files.push({ path: name, bytes: await remote.download(sha) });
      }
      await vault.applySnapshot(files, before.revision, batch, {
        includeSnapshot: false,
        onApplied: () => remember(head, batch, desired),
      });
      start = end;
    }
    return { state: { head, files: [...desired] }, changed: incoming, conflicts, uploaded };
  }
  throw new Error("다른 PC에서 연속으로 저장 중입니다. 다시 동기화해 주세요.");
}
