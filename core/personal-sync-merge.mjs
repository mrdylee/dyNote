import { posix } from "node:path";
import { assertSyncEntry, conflictFolder, syncPrefix } from "./personal-sync-store.mjs";
import { mergeCaptureBlocks, resolveText, textChoices } from "./personal-sync-text.mjs";
import { validPersonalFilePath } from "./vault.mjs";

function same(a, b) {
  return a?.oid === b?.oid && a?.mode === b?.mode;
}

export function checkTreeChanges(before, after) {
  const changed = new Set();
  const names = new Map();
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    const entry = after.get(name);
    if (!same(before.get(name), entry)) {
      assertSyncEntry(name, entry ?? before.get(name));
      changed.add(name);
    }
    if (!entry) continue;
    let prefix = "";
    for (const part of name.split("/")) {
      prefix = prefix ? prefix + "/" + part : part;
      const key = prefix.normalize("NFC").toLowerCase();
      if (names.has(key) && names.get(key) !== prefix)
        throw new Error("기기마다 다르게 표시되는 경로입니다: " + prefix);
      names.set(key, prefix);
    }
  }
  return changed;
}

export async function integrate(store, remote, local, device, config) {
  if (!remote || remote === local) return local;
  if (!local) return remote;
  const result = await store.git(["merge-base", "--all", remote, local], { allow: [0, 1] });
  const bases = result.stdout.trim().split("\n").filter(Boolean);
  if (bases.length !== 1) throw new Error("공통 기준을 확인할 수 없는 Git 이력입니다.");
  const base = bases[0];
  if (base === local) {
    const state = await store.metadata(await store.tree(local));
    if (![...state.groups.values()].some((group) => group.pending.length)) return remote;
    return integrate(store, local, remote, device, config);
  }
  const [ancestor, published, incoming] = await Promise.all([base, remote, local].map((ref) => store.tree(ref)));
  const incomingChanges = checkTreeChanges(ancestor, incoming);
  const { groups } = await store.metadata(published);
  const incomingState = await store.metadata(incoming);
  const updates = new Map();
  let mergedTree = local;
  const conflicts = new Set(),
    decisionSources = new Map();
  if (base !== remote) {
    const merge = await store.git(
      ["-c", "merge.renames=false", "merge-tree", "--write-tree", "--no-messages", "-z", remote, local],
      { allow: [0, 1] }
    );
    const [tree, ...records] = merge.stdout.split("\0");
    mergedTree = tree;
    for (const record of records) {
      if (!record) break;
      const split = record.indexOf("\t");
      if (split === -1) throw new Error("Git 병합 결과를 읽지 못했습니다.");
      conflicts.add(record.slice(split + 1));
    }
    if (merge.code && !conflicts.size) throw new Error("경로 충돌을 먼저 검토해 주세요.");
  }
  if (base !== remote) {
    for (const [name, group] of groups) {
      const left = group.choices.filter((c) => !ancestor.has(c.key));
      const right = (incomingState.groups.get(name)?.choices ?? []).filter((c) => !ancestor.has(c.key));
      const a = left.at(-1),
        b = right.at(-1);
      if (a && b && a.blob !== b.blob && a.basis.some((id) => b.basis.includes(id))) {
        conflicts.add(name);
        decisionSources.set(name, [a.key, b.key]);
      }
    }
  }
  const merged = await store.tree(mergedTree);
  for (const name of incomingChanges) {
    if (name.startsWith(syncPrefix)) continue;
    if (
      !/\.md$/i.test(name) &&
      !same(ancestor.get(name), published.get(name)) &&
      !same(incoming.get(name), published.get(name))
    )
      conflicts.add(name);
    if (
      /^(?:Copilot Note|AI Conversations)\/[a-f\d]{20}\/(?:[a-f\d]{20}|\d{4}-\d{2}-\d{2})\.md$/.test(name) &&
      !same(ancestor.get(name), published.get(name)) &&
      !same(incoming.get(name), published.get(name))
    )
      conflicts.add(name);
    const pending = groups.get(name)?.pending ?? [];
    const choices = incomingState.groups.get(name)?.choices ?? [];
    const explicit = choices.some(
      (choice) =>
        pending.length &&
        pending.every((id) => choice.basis.includes(id)) &&
        choice.blob === (incoming.get(name)?.oid ?? null)
    );
    if (pending.length && !explicit && !same(incoming.get(name), published.get(name))) conflicts.add(name);
  }
  for (const name of conflicts) {
    const before = published.get(name),
      after = incoming.get(name);
    if (name.startsWith(syncPrefix)) {
      // Device names are machine-local; de-registration from either side wins.
      if (!name.startsWith(syncPrefix + "devices/") || !before || !after)
        throw new Error("공유 버전 기록이 충돌했습니다.");
      const incomingDevice = JSON.parse((await store.blob(after.oid)).toString("utf8"));
      updates.set(name, incomingDevice.active ? before : after);
      continue;
    }
    assertSyncEntry(name, before);
    assertSyncEntry(name, after);
    if (/\.md$/i.test(name) && before && after && !groups.get(name)?.pending.length) {
      const decode = (bytes) => {
        try {
          return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        } catch {
          return null;
        }
      };
      const versions = await Promise.all(
        [ancestor.get(name), before, after].map(async (e) => (e ? decode(await store.blob(e.oid)) : ""))
      );
      if (versions.every((v) => v !== null) && versions.some((v) => v.includes("<!-- dynote:copilot "))) {
        const journal = mergeCaptureBlocks(...versions);
        if (journal !== null) {
          updates.set(name, await store.storeBytes(Buffer.from(journal)));
          continue;
        }
      }
    }
    const [left, right] = decisionSources.get(name) ?? [name, name];
    await store.preserve(updates, merged, remote, name, before, left);
    await store.preserve(updates, merged, local, name, after, right);
    updates.set(name, before ?? null);
  }
  if (base === remote && !updates.size) return local;
  const tree = await store.writeTree(mergedTree, updates);
  const final = await store.tree(tree);
  checkTreeChanges(published, final);
  await store.metadata(final);
  return store.commitTree(tree, [remote, local], "개인노트 변경 통합", device, config);
}

// A plain Git client can fast-forward an unresolved file without writing a version record.
export async function normalizePublished(store, head, device, config) {
  if (!head) return head;
  const files = await store.tree(head),
    state = await store.metadata(files),
    updates = new Map();
  for (const [name, group] of state.groups) {
    if (!group.pending.length) continue;
    const keys = group.pending.map((id) => conflictFolder(name) + id + ".json");
    const first = (
      await store.git(["log", "--first-parent", "--reverse", "--format=%H", head, "--", ...keys])
    ).stdout
      .trim()
      .split("\n")[0];
    if (!first || first === head) continue;
    const canonical = (await store.tree(first)).get(name);
    const log = (
      await store.git(["log", "--first-parent", "--format=%H", first + ".." + head, "--", name])
    ).stdout.trim();
    if (!log) continue;
    for (const ref of log.split("\n").reverse()) {
      const tree = await store.tree(ref),
        newValue = tree.get(name);
      if (same(newValue, canonical)) continue;
      const source = await store.attribution(ref, name);
      if (!group.versions.has(source.commit)) await store.preserve(updates, files, ref, name, newValue);
    }
    if (!same(files.get(name), canonical)) updates.set(name, canonical ?? null);
  }
  return updates.size
    ? store.commitTree(await store.writeTree(head, updates), [head], "외부 변경 버전 보존", device, config)
    : head;
}

export async function chooseVersion(store, head, path, basis, chosenCommit, device, config, options = {}) {
  const files = await store.tree(head);
  const group = (await store.metadata(files)).groups.get(path);
  if (
    !group?.pending.length ||
    !Array.isArray(basis) ||
    JSON.stringify(group.pending) !== JSON.stringify([...basis].sort())
  )
    throw new Error("새 버전이 도착했습니다. 현재 선택을 유지하고 목록을 다시 확인하세요.");
  const selected = group.versions.get(chosenCommit);
  if (!selected || !group.pending.includes(chosenCommit)) throw new Error("선택한 버전을 확인해 주세요.");
  let body = selected.blob ? files.get(conflictFolder(path) + selected.blob + ".blob") : null;
  const candidates = group.pending.map((id) => group.versions.get(id));
  const parts = await textChoices(store, path, candidates);
  if (parts) body = await store.storeBytes(Buffer.from(resolveText(parts, options.hunks, chosenCommit)));
  const updates = new Map([[path, body]]);
  if (options.copies) {
    const occupied = new Set([...files.keys()].map((s) => s.normalize("NFC").toLowerCase()));
    for (const version of candidates.filter((v) => v.blob && v.commit !== chosenCommit)) {
      const copy = options.copies[version.commit];
      if (
        !validPersonalFilePath(copy) ||
        copy.split("/").slice(0, -1).join("/") !== path.split("/").slice(0, -1).join("/") ||
        posix.extname(copy).toLowerCase() !== posix.extname(path).toLowerCase() ||
        occupied.has(copy.normalize("NFC").toLowerCase())
      )
        throw new Error("기존 파일과 겹치지 않는 사본 이름을 선택해 주세요.");
      occupied.add(copy.normalize("NFC").toLowerCase());
      updates.set(copy, files.get(conflictFolder(path) + version.blob + ".blob"));
    }
  }
  const [key, choice] = await store.choice(path, group.pending, body?.oid ?? null);
  updates.set(key, choice);
  const tree = await store.writeTree(head, updates);
  return store.commitTree(tree, [head], "파일 버전 선택 · " + path, device, config);
}
