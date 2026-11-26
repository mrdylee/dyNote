import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { validateGitConfig } from "./git-backup.mjs";
import { validPersonalFilePath } from "./vault.mjs";
import { localOnlyFiles as getLocalOnlyFiles } from "./git-file-status.mjs";
import { PersonalSyncStore, deviceRecord, devicePath, isSyncDocumentText, isSyncRecordText, textConflictFolders, syncPrefix, conflictFolder } from "./personal-sync-store.mjs";
import { checkTreeChanges, chooseVersion, integrate, normalizePublished } from "./personal-sync-merge.mjs";
import { textChoices } from "./personal-sync-text.mjs";
import { scanLinks, resolvePath, createLinkIndex } from "./links.mjs";
import { PersonalSyncDisk, atomicJson, readStable, windowsCheckoutBytes } from "./personal-sync-disk.mjs";

export const copyStabilityMs = 1500;

export async function installDevice(settingsDir) {
  await mkdir(settingsDir, { recursive: true });
  const file = path.join(settingsDir, "personal-sync-device");
  let id = await readFile(file, "utf8").catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (!id) {
    const temp = file + "." + randomUUID();
    try {
      await writeFile(temp, randomUUID(), { flag: "wx", mode: 0o600 });
      await link(temp, file).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
      id = await readFile(file, "utf8");
    } finally {
      await rm(temp, { force: true });
    }
  }
  return deviceRecord(id, "PC").id;
}

export function personalConfig(input) {
  const config = validateGitConfig(input);
  const name = deviceRecord("00000000-0000-0000-0000-000000000000", input.deviceName).name;
  return { ...config, mode: "personal-sync", push: true, deviceName: name };
}

export function completeArchive(name, bytes) {
  if (/\.pdf$/i.test(name)) return /%%EOF\s*$/.test(bytes.subarray(-1024).toString("latin1"));
  if (!/\.(zip|xlsx|pptx)$/i.test(name)) return true;
  const start = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= start; i--) {
    if (bytes.readUInt32LE(i) !== 0x06054b50 || i + 22 + bytes.readUInt16LE(i + 20) !== bytes.length) continue;
    const offset = bytes.readUInt32LE(i + 16),
      length = bytes.readUInt32LE(i + 12);
    return (
      offset + length === i && (length === 0 ? i === 0 : length >= 46 && bytes.readUInt32LE(offset) === 0x02014b50)
    );
  }
  return false;
}

const deviceDirectory = syncPrefix + "devices/";
const managedChange = (name, detail) => Object.assign(new Error("동기화 관리 파일 · " + detail + " · " + name), {
  syncReason: "managed-record",
});
const historyError = message => Object.assign(new Error(message), { syncReason: "history" });

function verifyDeviceFormatting(name, stored, bytes) {
  const invalid = () => managedChange(name, "기기 기록의 UTF-8 JSON 형식과 필드를 확인해 주세요");
  let original, current, text;
  try {
    const saved = JSON.parse(stored);
    original = deviceRecord(saved.id, saved.name, saved.active);
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    current = JSON.parse(text);
  } catch {
    throw invalid();
  }
  if (name !== devicePath(original.id) || !stored.equals(Buffer.from(JSON.stringify(original) + "\n")) ||
      !current || typeof current !== "object" || Array.isArray(current) ||
      Object.keys(current).some(key => !Object.hasOwn(original, key))) throw invalid();
  const changed = Object.keys(original).filter(key => current[key] !== original[key]);
  if (changed.length) throw managedChange(name, "변경된 기기 필드를 확인해 주세요 (" + changed.join(", ") + ")");
  // Remove only JSON whitespace outside strings. Duplicate keys cannot round-trip through JSON.parse.
  const compact = text.replace(/"(?:[^"\\]|\\.)*"|[ \t\r\n]+/g, token => token.startsWith('"') ? token : "");
  if (compact !== JSON.stringify(current)) throw invalid();
}

export class PersonalSync {
  constructor(vault, run, deviceId, { now = Date.now, batchLimit } = {}) {
    this.store = new PersonalSyncStore(vault.root, run);
    this.deviceId = deviceId;
    this.vault = vault;
    this.now = now;
    this.limit = batchLimit;
    this.observed = new Map();
    this.confirmed = new Map();
    this.waiting = new Map();
    this.firstDirty = null;
    this.changed = [];
  }
  async init() {
    if (!(await this.store.repository())) throw new Error("개인 노트 Git 저장소를 먼저 연결해 주세요.");
    const directory = path.join(this.store.root, ".git", "dynote-personal");
    await mkdir(directory, { mode: 0o700 }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
    if (!(await lstat(directory)).isDirectory()) throw new Error("로컬 동기화 관리 경로를 확인해 주세요.");
    if (!this.disk) {
      const format = (await this.store.git(["rev-parse", "--show-object-format"])).stdout.trim();
      this.disk = new PersonalSyncDisk(this.store, format, this.limit);
    }
    await this.disk.checkStorage();
  }
  async dirty(head, checkoutRepairs) {
    const list = (await this.store.git(["ls-files", "-m", "-d", "-o", "--exclude-standard", "-z"])).stdout;
    const paths = new Set(list.split("\0").filter(Boolean));
    const checkAll = [...paths].some(name => name.startsWith(syncPrefix) || validPersonalFilePath(name));
    const files = await this.store.tree(head, checkAll ? undefined : deviceDirectory);
    // A checkout with core.filemode=false or clean filters can hide a changed device record from Git.
    for (const name of files.keys()) if (name.startsWith(deviceDirectory)) paths.add(name);
    const folders = [...paths].some(name => name.startsWith(syncPrefix) && name.endsWith(".blob"))
      ? textConflictFolders((await this.store.metadata(files)).groups) : new Set();
    const changes = [];
    for (const name of paths) {
      const managed = name.startsWith(syncPrefix), entry = files.get(name);
      if (entry && name.startsWith(deviceDirectory)) {
        const current = await this.disk.read(name).catch(error => {
          throw Object.assign(error, { syncReason: "managed-record" });
        });
        if (!current) throw managedChange(name, "삭제된 기기 기록을 확인해 주세요");
        if (entry.mode !== "100644" || entry.type !== "blob" || (process.platform !== "win32" && (current.mode & 0o111)))
          throw managedChange(name, "기기 기록의 파일 종류와 실행 권한을 확인해 주세요");
        if (current.oid === entry.oid) continue;
        if (current.bytes.length > 65536) throw managedChange(name, "기기 기록의 크기 한도는 64 KiB입니다");
        const stored = await this.store.blob(entry.oid);
        verifyDeviceFormatting(name, stored, current.bytes);
        // A plain CRLF checkout is already accepted by the receive job, including on restart.
        if (!windowsCheckoutBytes(stored)?.equals(current.bytes))
          checkoutRepairs.push({ name, before: current.oid, after: entry.oid, mode: entry.mode, size: entry.size, saved: randomUUID() });
        continue;
      }
      if (entry && (validPersonalFilePath(name) || isSyncRecordText(name, folders))) {
        const current = await this.disk.read(name).catch(error => {
          if (managed) throw error;
          return null; // Let capture report pending reads of ordinary documents.
        });
        if (await this.disk.matchesBlob(name, current, entry.oid, folders)) {
          if (!managed) continue;
          const diff = await this.store.git(
            ["diff", "--quiet", "--no-ext-diff", "--no-textconv", "--ignore-cr-at-eol", head, "--", name],
            { allow: [0, 1] }
          );
          if (!diff.code) continue; // A mode or type change still needs attention.
        }
        if (!managed && !isSyncDocumentText(name) && current && current.bytes.length > entry.size &&
            !current.bytes.includes(0) && current.bytes.includes("\r\n") &&
            windowsCheckoutBytes(await this.store.blob(entry.oid))?.equals(current.bytes)) {
          // Restore Git-converted attachment bytes through the same recoverable apply job as a download.
          checkoutRepairs.push({ name, before: current.oid, after: entry.oid, mode: entry.mode, size: entry.size, saved: randomUUID() });
          continue;
        }
      }
      if (managed) throw managedChange(name, "외부 변경을 확인해 주세요");
      changes.push(name);
    }
    return changes;
  }
  async previewZip() {
    const result = await this.store.git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
    return [
      ...new Set(result.stdout.split("\0").filter((name) => validPersonalFilePath(name) && /\.zip$/i.test(name))),
    ].sort();
  }
  async confirm(name, expected) {
    const file = await this.disk.read(name);
    if (!file || file.oid !== expected) throw new Error("파일이 다시 변경되었습니다. 현재 버전을 확인해 주세요.");
    this.confirmed.set(name, file.oid);
  }
  copyReady(name, current) {
    if (!current || !/\.(xlsx|pptx|pdf|zip)$/i.test(name) || this.confirmed.get(name) === current.oid) return true;
    const previous = this.observed.get(name);
    if (previous?.sig !== current.signature) this.observed.set(name, { sig: current.signature, at: this.now() });
    if (this.now() - this.observed.get(name).at >= copyStabilityMs && completeArchive(name, current.bytes)) return true;
    this.waiting.set(name, { name, oid: current.oid, message: "복사 완료 대기" });
    return false;
  }
  async capture(head, device, config, dirty, register) {
    const files = await this.store.tree(head),
      updates = new Map(),
      captured = [];
    const registry = (await this.store.metadata(files)).devices.find((entry) => entry.id === device.id);
    if (registry && !registry.active && !register)
      throw new Error("이 기기의 등록이 해제되었습니다. 설정에서 다시 연결해 주세요.");
    if (register || !registry) {
      const entry = await this.store.storeRecord(device);
      if (files.get(devicePath(device.id))?.oid !== entry.oid) updates.set(devicePath(device.id), entry);
    }
    let size = 0;
    this.waiting.clear();
    for (const name of dirty) {
      if (name.startsWith(syncPrefix) || (!validPersonalFilePath(name) && files.has(name)))
        throw new Error("Git에서 직접 변경한 관리 대상 밖 파일을 확인해 주세요: " + name);
      if (!validPersonalFilePath(name)) continue;
      let current;
      try {
        current = await this.disk.read(name);
      } catch (error) {
        this.waiting.set(name, { name, message: error.message });
        continue;
      }
      if ((current?.oid ?? null) === (files.get(name)?.oid ?? null)) continue;
      if (!this.copyReady(name, current)) continue;
      if (current && size + current.bytes.length > this.disk.limit && captured.length) {
        this.waiting.set(name, { name, message: "다음 묶음 대기" });
        continue;
      }
      size += current?.bytes.length ?? 0;
      const entry = current ? await this.store.storeBytes(current.bytes) : null;
      if (entry && files.get(name)) entry.mode = files.get(name).mode;
      updates.set(name, entry);
      captured.push(name);
    }
    if (this.waiting.size) {
      const targets = [...new Set([...dirty, ...files.keys()])]
        .filter(validPersonalFilePath)
        .map((path) => ({ path }));
      const index = createLinkIndex(targets);
      for (const [name, entry] of updates) {
        if (!entry || !/\.md$/i.test(name)) continue;
        const source = (await this.store.blob(entry.oid)).toString("utf8");
        const waiting = scanLinks(source).some((link) =>
          this.waiting.has(resolvePath(link.target, name, targets, { kind: link.kind, index }).path)
        );
        if (waiting) {
          updates.delete(name);
          captured.splice(captured.indexOf(name), 1);
          this.waiting.set(name, { name, message: "연결된 첨부 파일 대기" });
        }
      }
    }
    if (!updates.size) return head;
    const tree = await this.store.writeTree(head, updates);
    const next = await this.store.commitTree(
      tree,
      head ? [head] : [],
      "개인노트 저장 · " + device.name,
      device,
      config
    );
    await this.disk.begin(config.branch, head, next, captured);
    return next;
  }
  async rememberInput(parent, name, entry, device, config) {
    const tree = await this.store.writeTree(parent, new Map([[name, entry]]));
    const commit = await this.store.commitTree(
      tree,
      parent ? [parent] : [],
      "동기화 중 로컬 편집 보존",
      device,
      config
    );
    await this.store.git(["update-ref", "refs/dynote-sync/inputs/" + commit, commit]);
    return commit;
  }
  async resume(device, config) {
    while (true) {
      const job = await this.disk.job();
      if (job && job.branch !== config.branch) throw new Error("진행 중인 적용 작업의 브랜치가 다릅니다.");
      const result = this.vault.applySyncChanges
        ? await this.vault.applySyncChanges(() => this.disk.resume())
        : await this.disk.resume();
      if (!result.diverged) {
        this.changed.push(...result.changed);
        return !result.waiting;
      }
      const { job: work, name, entry } = result.diverged;
      const row = work.records[work.offset];
      if (!row.before && entry && !result.diverged.parent &&
          !(await this.store.git(["--no-literal-pathspecs", "check-ignore", "--quiet", "--no-index", "--", name], { allow: [0, 1] })).code)
        throw Object.assign(new Error("Git 제외 규칙이 적용된 로컬 파일과 수신 파일의 경로가 겹칩니다. 로컬 파일을 보관함 밖으로 옮긴 뒤 다시 동기화해 주세요 · " + name),
          { syncStage: "apply", syncReason: "ignored-collision" });
      const current = await this.disk.read(name);
      if (current && current.oid === entry?.oid && !this.copyReady(name, current)) return false;
      const parent = result.diverged.parent ?? work.previous;
      if (!parent)
        throw new Error("가져오는 동안 로컬 파일이 생겼습니다. 파일을 보존한 뒤 빈 폴더로 다시 연결해 주세요.");
      await this.rememberInput(parent, name, entry, device, config);
      row.before = (await this.disk.read(name))?.oid ?? null;
      if (row.before && row.before !== entry?.oid) continue;
      row.saved = randomUUID();
      await atomicJson(this.disk.journal, work);
    }
  }
  async saveDraft(name, content, expectedRevision, config) {
    if (
      !/\.md$/i.test(name) ||
      !validPersonalFilePath(name) ||
      typeof content !== "string" ||
      Buffer.byteLength(content) > 25 * 1024 * 1024
    )
      return null;
    const inputs = (
      await this.store.git(["for-each-ref", "--format=%(objectname)", "refs/dynote-sync/inputs/"])
    ).stdout
      .trim()
      .split("\n")
      .filter(Boolean);
    const refs = [
      ...inputs,
      ...(await this.store.git(["log", "--full-history", "--format=%H", "HEAD", "--", name])).stdout
        .trim()
        .split("\n")
        .filter(Boolean),
    ];
    for (const ref of refs) {
      const file = (await this.store.tree(ref)).get(name);
      if (!file || file.type !== "blob" || file.size > 25 * 1024 * 1024) continue;
      const bytes = await this.store.blob(file.oid);
      if (createHash("sha256").update(bytes).digest("hex") !== expectedRevision) {
        const checkout = windowsCheckoutBytes(bytes);
        if (!checkout || createHash("sha256").update(checkout).digest("hex") !== expectedRevision) continue;
      }
      const entry = await this.store.storeBytes(Buffer.from(content));
      await this.rememberInput(ref, name, entry, deviceRecord(this.deviceId, config.deviceName), config);
      return { path: name, content, revision: createHash("sha256").update(content).digest("hex"), preserved: true };
    }
    return null;
  }
  async externalWrites(device, config) {
    this.recoveryBytes = 0;
    for (const file of await readdir(this.disk.dir).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return [];
    })) {
      if (!/^[a-f\d-]{36}\.source\.json$/.test(file)) continue;
      const marker = path.join(this.disk.dir, file),
        source = JSON.parse(await readFile(marker, "utf8"));
      const backup = marker.slice(0, -12);
      const info = await lstat(backup, { bigint: true }).catch((error) => {
        if (error.code !== "ENOENT") throw error;
        return null;
      });
      if (!info) {
        await rm(marker, { force: true });
        continue;
      }
      this.recoveryBytes += Number(info.size);
      const stamp = [info.size, info.ctimeNs, info.mtimeNs].join(":");
      if (source.stamp === stamp) continue;
      const current = await readStable(backup, this.disk.format);
      // Older markers recorded the LF commit as their initial baseline for a displaced CRLF note.
      const oldCheckout = !source.stamp && current.oid !== source.oid && isSyncDocumentText(source.name) &&
        (await this.store.tree(source.parent)).get(source.name)?.oid === source.oid &&
        await this.disk.matchesBlob(source.name, current, source.oid);
      if (current.oid !== source.oid && !oldCheckout)
        await this.rememberInput(
          source.parent,
          source.name,
          await this.store.storeBytes(current.bytes),
          device,
          config
        );
      await atomicJson(marker, { ...source, stamp, oid: current.oid });
    }
  }
  async validateRange(previous, head) {
    if (!head || previous === head) return;
    const refs = (
      await this.store.git(["rev-list", "--reverse", "--parents", head, ...(previous ? ["^" + previous] : [])])
    ).stdout
      .trim()
      .split("\n")
      .filter(Boolean);
    for (const row of refs) {
      const [ref, parent] = row.split(" ");
      const before = await this.store.tree(parent),
        after = await this.store.tree(ref);
      const changes = checkTreeChanges(before, after);
      const { groups } = await this.store.metadata(after);
      for (const name of changes) {
        if (!name.startsWith(syncPrefix + "conflicts/")) continue;
        if (before.has(name)) throw new Error("기존 버전 기록이 삭제되거나 변경되었습니다.");
        if (!name.endsWith(".json") || name.endsWith(".choice.json")) continue;
        const record = JSON.parse((await this.store.blob(after.get(name).oid)).toString("utf8"));
        if (
          !groups.get(record.path)?.versions.has(record.commit) ||
          name !== conflictFolder(record.path) + record.commit + ".json" ||
          (await this.store.git(["merge-base", "--is-ancestor", record.commit, ref], { allow: [0, 1] })).code
        )
          throw new Error("버전 기록이 브랜치의 원본을 가리키지 않습니다.");
        const original = (await this.store.tree(record.commit)).get(record.path);
        if ((original?.oid ?? null) !== record.blob)
          throw Object.assign(new Error("버전 기록과 원본 파일의 내용이 다릅니다."), {invalidMerge:ref, invalidRecord:name});
      }
    }
  }
  async rebuildUnpublishedDecision(error, head, device, config) {
    if (!head || error.invalidMerge !== head) return null;
    const [subject, parents] = (await this.store.git(["show", "-s", "--format=%s%n%P", head])).stdout.trim().split("\n");
    const refs = parents?.split(" ") ?? [];
    if (subject !== "개인노트 변경 통합" || refs.length !== 2) return null;
    const rebuilt = await integrate(this.store, refs[0], refs[1], device, config);
    const [before, after] = await Promise.all([head, rebuilt].map(ref => this.store.tree(ref)));
    const changes = checkTreeChanges(before, after);
    if (!changes.has(error.invalidRecord)) return null;
    for (const name of changes) {
      // Only replace the rejected version record or add missing candidates. Preserve all visible files.
      if (!name.startsWith(syncPrefix + "conflicts/") || !after.has(name) || (before.has(name) && name !== error.invalidRecord))
        return null;
    }
    await this.validateRange(refs[0], rebuilt);
    await this.store.git(["update-ref", "refs/dynote-sync/recovery/" + head, head]);
    return rebuilt;
  }
  async sync(input, { force = true, register = false, onStage = () => {}, querySignal } = {}) {
    const config = personalConfig(input),
      device = deviceRecord(this.deviceId, config.deviceName);
    const times = {};
    const stage = (name, done = false) => {
      let time;
      if (done && (name === "remote-query" || name === "push")) {
        time = new Date(this.now()).toISOString();
        times[name === "push" ? "lastSuccess" : "lastRemoteCheck"] = time;
      }
      onStage(name, done, time);
    };
    const queryRemote = async () => {
      const signal = querySignal;
      if (signal?.aborted) return;
      stage("remote-query");
      const interrupted = Promise.withResolvers();
      signal?.addEventListener("abort", interrupted.resolve, {once:true});
      try {
        const result = this.store.remoteHead(config, signal);
        const remote = signal ? await Promise.race([result, interrupted.promise]) : await result;
        if (!signal?.aborted) {
          stage("remote-query", true);
          return remote;
        }
      } catch (error) {
        if (!signal?.aborted) throw error;
      } finally {
        signal?.removeEventListener("abort", interrupted.resolve);
      }
    };
    const applyJob = async () => {
      if (!(await this.disk.job())) return true;
      stage("apply");
      const done = await this.resume(device, config);
      if (done) stage("apply", true);
      return done;
    };
    stage("local-save");
    await this.init();
    const status = async (waiting = false) => {
      const files = await this.store.tree(await this.disk.head()),
        { devices, groups } = await this.store.metadata(files);
      const conflicts = [...groups]
        .filter(([, g]) => g.pending.length)
        .map(([name, g]) => ({ name, count: g.pending.length }));
      const localOnlyFiles = await getLocalOnlyFiles(args => this.store.git(args), validPersonalFilePath);
      const pending = waiting || this.firstDirty !== null || this.waiting.size > 0;
      const summary = waiting
        ? "다음 묶음 동기화 대기"
        : this.waiting.size ? "파일 " + this.waiting.size + "개 전송 대기"
        : this.firstDirty !== null ? "기기에 저장됨"
        : conflicts.length ? "버전 확인 " + conflicts.length + "개" : "";
      const local = localOnlyFiles.length ? "이 PC에만 있는 항목 " + localOnlyFiles.length + "개" : "";
      return {
        phase: pending ? "pending" : local ? "local-only" : "synced",
        message: [summary, local].filter(Boolean).join(" · ") || "동기화됨",
        conflicts,
        devices: devices.filter((d) => d.active),
        deviceId: device.id,
        pendingFiles: [...this.waiting.values()],
        localOnlyFiles,
        changed: this.changed.splice(0),
        recoveryBytes: this.recoveryBytes ?? 0,
        ...times,
      };
    };
    if (!(await applyJob())) return status(true);
    stage("local-save");
    await this.store.assertReady(config);
    await this.externalWrites(device, config);
    let head = await this.disk.head();
    const remoteKey = createHash("sha256")
      .update(config.remote + "\0" + config.branch)
      .digest("hex");
    const ref = "refs/dynote-sync/remotes/" + remoteKey;
    let seen = await this.disk.head(ref);
    const scan = async () => {
      const repairs = [], changes = await this.dirty(head, repairs);
      if (repairs.length) {
        stage("apply");
        await this.disk.startJob(config.branch, head, head, repairs);
        if (!(await applyJob())) return null;
      }
      return changes;
    };
    const dirty = await scan();
    if (!dirty) return status(true);
    if (this.waiting.size) {
      const modified = new Set(dirty);
      for (const name of this.waiting.keys()) if (!modified.has(name)) this.waiting.delete(name);
    }
    if (dirty.some(validPersonalFilePath)) this.firstDirty ??= this.now();
    else this.firstDirty = null;
    const checkpoint = async (registerNow = false, changes) => {
      changes ??= await scan();
      if (!changes) return false;
      stage("local-save");
      const captured = await this.capture(head, device, config, changes, registerNow);
      const done = await applyJob();
      if (done && captured !== head) stage("local-save", true);
      head = await this.disk.head();
      this.firstDirty = this.waiting.size ? this.firstDirty : null;
      return done;
    };
    // On an established connection an outage still leaves a local Git checkpoint.
    if ((head || !register) && (force || (this.firstDirty !== null && this.now() - this.firstDirty >= 300000)))
      if (!(await checkpoint(register, dirty))) return status(true);
    let unacknowledgedHead = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      let remote = await queryRemote();
      if (querySignal?.aborted) return status(true);
      if (seen && !remote) throw historyError("원격 브랜치가 삭제되었습니다. 로컬 기록을 보존했습니다.");
      if (remote) {
        if (remote !== seen) {
          stage("fetch");
          await this.store.git([
            "fetch",
            "--no-tags",
            "--no-recurse-submodules",
            "--",
            config.remote,
            "refs/heads/" + config.branch,
          ]);
          remote = await this.disk.head("FETCH_HEAD");
          stage("fetch", true);
        }
        if (seen && (await this.store.git(["merge-base", "--is-ancestor", seen, remote], { allow: [0, 1] })).code)
          throw historyError("원격 Git 이력이 재작성되었습니다. 로컬 기록을 보존했습니다.");
        if (!seen && head && (await this.store.git(["merge-base", head, remote], { allow: [0, 1] })).code)
          throw historyError("공통 Git 이력이 없는 저장소입니다.");
        if (unacknowledgedHead) {
          if (!(await this.store.git(["merge-base", "--is-ancestor", unacknowledgedHead, remote], { allow: [0, 1] })).code)
            stage("push", true);
          unacknowledgedHead = null;
        }
        await this.validateRange(
          seen ?? (head && (await this.store.git(["merge-base", head, remote])).stdout.trim()),
          remote
        );
        const registration = (await this.store.metadata(await this.store.tree(remote))).devices.find(
          (d) => d.id === device.id
        );
        if (registration && !registration.active && !register)
          throw new Error("이 기기의 등록이 해제되었습니다. 다시 연결해 주세요.");
        await this.store.git(["update-ref", ref, remote]);
        seen = remote;
      }
      if (remote && !head && (await this.dirty(head, [])).some(validPersonalFilePath))
        throw historyError("로컬 노트와 원격 저장소에 공통 Git 이력이 없습니다. 기존 Git 저장소에서 가져오기로 빈 폴더를 선택해 주세요.");
      if (remote !== head && head && this.firstDirty !== null && !(await checkpoint())) return status(true);
      stage("apply");
      const normalized = await normalizePublished(this.store, remote, device, config);
      let merged = await integrate(this.store, normalized, head, device, config);
      const inputs = (
        await this.store.git(["for-each-ref", "--format=%(objectname)", "refs/dynote-sync/inputs/"])
      ).stdout
        .trim()
        .split("\n")
        .filter(Boolean);
      for (const saved of inputs) merged = await integrate(this.store, merged, saved, device, config);
      // Validate new records before adopting the merge on disk or moving the local branch.
      try {
        await this.validateRange(remote, merged);
      } catch (error) {
        const rebuilt = await this.rebuildUnpublishedDecision(error, head, device, config);
        if (!rebuilt || attempt === 3) throw error;
        await this.disk.begin(config.branch, head, rebuilt);
        if (!(await applyJob())) return status(true);
        head = rebuilt;
        continue;
      }
      if (merged !== head) {
        await this.disk.begin(config.branch, head, merged);
        if (!(await applyJob())) return status(true);
        head = merged;
      }
      for (const saved of inputs)
        await this.store.git(["update-ref", "-d", "refs/dynote-sync/inputs/" + saved, saved]);
      if (register || !head || !(await this.store.tree(head)).has(devicePath(device.id))) {
        if (!(await checkpoint(true))) return status(true);
        register = false;
      }
      if (!head || remote === head) return status();
      stage("push");
      if (remote && (await this.store.git(["merge-base", "--is-ancestor", remote, head], { allow: [0, 1] })).code)
        throw historyError("원격 이력 보호를 위해 업로드를 중지했습니다.");
      await this.validateRange(merged, head);
      const dst = "refs/heads/" + config.branch;
      try {
        const result = await this.store.git([
          "push",
          "--porcelain",
          "--no-verify",
          "--recurse-submodules=no",
          "--force-with-lease=" + dst + ":" + (remote || ""),
          "--",
          config.remote,
          head + ":" + dst,
        ]);
        if (!/^=\t/m.test(result.stdout)) stage("push", true);
      } catch (error) {
        error.syncStage ??= "push";
        if (["push-denied", "branch-policy", "authentication", "ownership", "storage-full", "git-missing"].includes(error.syncReason))
          throw error;
        const latest = await queryRemote().catch(() => { throw error; });
        if (querySignal?.aborted) return status(true);
        if (latest === head) {
          if (error.syncReason !== "non-fast-forward") stage("push", true);
        }
        else {
          if (latest === remote || attempt === 3) throw error;
          if (error.syncReason !== "non-fast-forward") unacknowledgedHead = head;
          await new Promise((resolve) => setTimeout(resolve, 30 + Math.random() * 150));
          continue;
        }
      }
      await this.store.git(["update-ref", ref, head]);
      return status();
    }
  }
  async versions(name, skip = 0) {
    if (!validPersonalFilePath(name) || !Number.isSafeInteger(skip) || skip < 0)
      throw new Error("잘못된 파일 경로입니다.");
    const head = await this.disk.head();
    const [files, records] = await Promise.all([
      this.store.tree(head, name), this.store.tree(head, conflictFolder(name)),
    ]);
    const group = (await this.store.metadata(records)).groups.get(name);
    const basis = group?.pending ?? [];
    return {
      basis,
      current: files.get(name)?.oid ?? null,
      versions: basis
        .map((id) => group.versions.get(id))
        .sort((a, b) => a.time.localeCompare(b.time) || a.commit.localeCompare(b.commit))
        .slice(skip, skip + 50),
    };
  }
  async checkpointFile(config, name, description) {
    await this.init();
    await this.store.assertReady(config);
    if (await this.disk.job()) throw new Error("수신 중인 파일 적용이 끝난 뒤 복원해 주세요.");
    const device = deviceRecord(this.deviceId, config.deviceName),
      head = await this.disk.head(),
      files = await this.store.tree(head);
    const current = await this.disk.read(name);
    if ((current?.oid ?? null) === (files.get(name)?.oid ?? null)) return;
    const entry = current && (await this.store.storeBytes(current.bytes));
    const tree = await this.store.writeTree(head, new Map([[name, entry]]));
    const commit = await this.store.commitTree(tree, [head], description + " · " + name, device, config);
    await this.disk.begin(config.branch, head, commit, [name]);
    await this.resume(device, config);
  }
  async blockedSessions({ includeDeleted = true } = {}) {
    const head = await this.disk?.head();
    if (!head) return new Set();
    const files = await this.store.tree(head),
      states = await this.store.metadata(files);
    const blocked = new Set([...states.groups].filter(([, g]) => g.pending.length).map(([name]) => name));
    if (!includeDeleted) return blocked;
    const log = await this.store.git([
      "log",
      "--full-history",
      "-m",
      "--diff-filter=D",
      "--format=",
      "--name-only",
      "-z",
      head,
      "--",
      "Copilot Note",
      "AI Conversations",
    ]);
    for (const name of log.stdout.split("\0")) if (name && !files.has(name)) blocked.add(name);
    return blocked;
  }
  async comparison(name) {
    const files = await this.store.tree(await this.disk.head(), conflictFolder(name)),
      group = (await this.store.metadata(files)).groups.get(name);
    const basis = group?.pending ?? [];
    const parts = group ? await textChoices(this.store, name, basis.map(id => group.versions.get(id))) : null;
    return { basis, parts };
  }
  async removeDevice(config, id, onStage) {
    if (id === this.deviceId) throw new Error("현재 기기에서는 동기화를 끈 뒤 다른 기기에서 등록을 해제하세요.");
    const state = await this.sync(config, { onStage }),
      head = await this.disk.head(),
      files = await this.store.tree(head);
    const other = (await this.store.metadata(files)).devices.find((d) => d.id === id && d.active);
    if (!other || (await this.disk.job())) throw new Error("기기 목록을 다시 확인해 주세요.");
    const record = await this.store.storeRecord(deviceRecord(id, other.name, false));
    const tree = await this.store.writeTree(head, new Map([[devicePath(id), record]]));
    const commit = await this.store.commitTree(
      tree,
      [head],
      "기기 등록 해제 · " + other.name,
      deviceRecord(this.deviceId, config.deviceName),
      config
    );
    await this.disk.begin(config.branch, head, commit);
    this.changed.push(...state.changed);
    return this.sync(config, { onStage });
  }
  async preview(name, id) {
    const files = await this.store.tree(await this.disk.head());
    const version = (await this.store.metadata(files)).groups.get(name)?.versions.get(id);
    if (!version) throw new Error("검토할 버전이 없습니다.");
    return version.blob ? await this.store.blob(version.blob) : null;
  }
  async resolve(config, name, basis, id, options) {
    const device = deviceRecord(this.deviceId, config.deviceName);
    if (!validPersonalFilePath(name)) throw new Error("잘못된 파일 경로입니다.");
    if (await this.disk.job()) throw new Error("파일 수신이 완료되면 다시 적용해 주세요.");
    await this.store.assertReady(config);
    const head = await this.disk.head(), repairs = [];
    if ((await this.dirty(head, repairs)).includes(name) || repairs.some(row => row.name === name))
      throw new Error("이 파일에 새 편집이 있습니다. 지금 동기화한 뒤 버전을 다시 확인해 주세요.");
    for (const copy of Object.values(options?.copies ?? {}))
      if (await this.disk.read(copy)) throw new Error("이미 사용 중인 사본 경로입니다: " + copy);
    const next = await chooseVersion(this.store, head, name, basis, id, device, config, options);
    await this.disk.begin(config.branch, head, next);
    if (!(await this.resume(device, config))) throw new Error("파일 적용 중입니다. 동기화가 끝난 뒤 확인해 주세요.");
    return this.changed.splice(0);
  }
}
