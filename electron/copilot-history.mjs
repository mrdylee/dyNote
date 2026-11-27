import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { validNotePath } from "../core/vault.mjs";

const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const digest = data => createHash("sha256").update(JSON.stringify(data)).digest("hex");
function messages(turns) {
  return turns.flatMap(t => [
    { id: t.id + "-user", checkpoint: t.id, role: "user", content: t.prompt, imageName: t.imageName, mode: t.mode, complete: true },
    { id: t.id, role: "assistant", content: t.content || (t.status === "canceled" ? "중지된 응답" : "완료되지 않은 응답"), mode: t.mode, complete: t.status === "done" },
    ...(t.applied ? [{ id: t.id + "-applied", role: "assistant", mode: "agent", complete: true, content: t.applied }] : []),
  ]);
}

function restoration(chatId, turns, notes, drafts) {
  const paths = new Map();
  for (const turn of turns) for (const change of turn.changes) {
    const draft = drafts.find(d => d.path === change.path);
    const tracked = draft?.history?.some(ref => ref.chatId === chatId && ref.requestId === turn.id);
    // A crash can occur after saving the note and before acknowledging the write.
    const disk = notes.find(n => n.path === change.path)?.content ?? null;
    const beforeDisk = change.beforeDraft ? (change.beforeDraft.kind === "create" ? null : change.beforeDraft.original) : change.before;
    const saved = change.saved || (change.saving && disk !== beforeDisk);
    if (!saved && !tracked) continue;
    let row = paths.get(change.path);
    if (!row) {
      const prior = change.beforeDraft;
      row = { path: change.path, before: change.before, prior, diskBefore: prior ? (prior.kind === "create" ? null : prior.original) : change.before, conflict: false };
      paths.set(change.path, row);
    } else if (row.after !== change.before) row.conflict = true;
    row.after = change.after;
    if (saved) row.diskAfter = change.after;
  }
  return [...paths.values()].map(row => {
    const disk = notes.find(n => n.path === row.path)?.content ?? null;
    const draft = drafts.find(d => d.path === row.path);
    const current = draft?.content ?? disk;
    const diskTarget = row.diskAfter === undefined ? disk : row.diskBefore;
    const hasForeignDraft = draft && !draft.history?.some(ref => ref.chatId === chatId && turns.some(t => t.id === ref.requestId));
    const conflict = row.conflict || !!hasForeignDraft || !!draft?.userEdited ||
      (current !== row.after && current !== row.before) ||
      (disk !== (row.diskAfter ?? row.diskBefore) && disk !== row.diskBefore);
    return { ...row, current, disk, diskTarget, conflict };
  });
}

export class CopilotHistory {
  constructor(directory) { this.directory = directory; this.tail = Promise.resolve(); }
  run(vault, args) {
    const job = this.tail.then(() => this.execute(vault, args));
    this.tail = job.catch(() => {});
    return job;
  }
  async execute(vault, args) {
    const { action, chatId, requestId } = args;
    const directory = path.join(this.directory, vault.id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (action === "list") {
      const list = [];
      for (const name of await readdir(directory)) {
        if (!name.endsWith(".json") || !uuid.test(name.slice(0, -5))) continue;
        const chat = JSON.parse(await readFile(path.join(directory, name), "utf8"));
        if (chat.turns.length) list.push({ id: name.slice(0, -5), title: chat.turns[0].prompt.slice(0, 80), updated: chat.updated });
      }
      return list.sort((a, b) => b.updated - a.updated);
    }
    if (!uuid.test(chatId)) throw new Error("대화를 다시 선택해 주세요.");
    const file = path.join(directory, chatId + ".json");
    let chat;
    try { chat = JSON.parse(await readFile(file, "utf8")); }
    catch (error) { if (error.code !== "ENOENT" || action !== "begin") throw error; chat = { turns: [] }; }
    if (action === "open") return messages(chat.turns);
    if (!uuid.test(requestId)) throw new Error("요청을 다시 선택해 주세요.");
    const index = chat.turns.findIndex(t => t.id === requestId), turn = chat.turns[index];
    if (!turn && action !== "begin") throw new Error("복원 지점이 변경되었습니다. 대화를 다시 열어 주세요.");
    let result;
    if (action === "begin") {
      if (turn) throw new Error("이미 저장된 요청입니다.");
      chat.turns.push({ id: requestId, prompt: args.prompt, mode: args.mode, imageName: args.imageName, changes: [] });
      delete chat.rewinding;
    } else if (action === "finish") {
      turn.status = args.status; turn.content = args.content ?? "";
    } else if (action === "applied") {
      turn.applied = args.content;
    } else if (action === "change") {
      const c = args.change;
      if (!validNotePath(c?.path) || (c.before !== null && typeof c.before !== "string") || typeof c.after !== "string" || (c.beforeDraft && c.beforeDraft.path !== c.path)) throw new Error("복원할 노트를 확인해 주세요.");
      const prior = turn.changes.find(item => item.path === c.path);
      if (prior) prior.after = c.after;
      else turn.changes.push({ path: c.path, before: c.before, after: c.after, beforeDraft: c.beforeDraft });
    } else if (action === "keep" || action === "saving") {
      const change = turn.changes.find(c => c.path === args.path);
      if (!change) throw new Error("노트의 복원 기록을 확인해 주세요.");
      change.saving = action === "saving";
      if (action === "keep") change.saved = true;
    } else if (action === "preview" || action === "apply") {
      const snapshot = await vault.documentSnapshot();
      const rows = restoration(chatId, chat.turns.slice(index), snapshot.notes, args.drafts);
      const version = digest([chat.turns.slice(index).map(t => t.id), rows, args.drafts]);
      if (action === "preview") return { version, rows: rows.map(({ path, before, current, conflict, disk, diskTarget }) => ({ path, before, current, conflict, disk, diskTarget })) };
      if (args.version !== version) throw new Error("미리보기 이후 변경되었습니다. 복원 지점을 다시 열어 주세요.");
      const changes = [], replaceDrafts = [];
      for (const row of rows) {
        const choice = args.choices?.[row.path];
        if (row.conflict && !["keep", "restore"].includes(choice)) throw new Error("충돌한 노트의 복원 방법을 선택해 주세요.");
        if (choice === "keep") continue;
        if (row.disk !== row.diskTarget) changes.push({ path: row.path, content: row.diskTarget });
        if (row.prior || args.drafts.some(d => d.path === row.path)) replaceDrafts.push({ path: row.path, draft: row.prior ?? null });
      }
      const restoredPaths = new Set(replaceDrafts.map(item => item.path));
      const drafts = [...args.drafts.filter(d => !restoredPaths.has(d.path)), ...replaceDrafts.flatMap(item => item.draft ? [item.draft] : [])];
      // A kept user draft can outlive the turns removed from this conversation.
      const removedIds = new Set(chat.turns.slice(index).map(turn => turn.id));
      for (const draft of drafts) if (draft.history)
        draft.history = draft.history.filter(ref => ref.chatId !== chatId || !removedIds.has(ref.requestId));
      if (drafts.length > 5 || Buffer.byteLength(JSON.stringify(drafts)) > 2 * 1024 * 1024) throw new Error("복원할 초안이 보관 한도를 넘습니다.");
      const restored = changes.length ? (await vault.applyDocumentChanges(changes, snapshot.revision, { trashDeleted: true })).snapshot : null;
      result = { snapshot: restored, drafts };
      chat.rewinding = requestId;
    } else if (action === "rewind") {
      if (chat.rewinding !== requestId) throw new Error("복원 미리보기를 다시 확인해 주세요.");
      chat.turns.splice(index); delete chat.rewinding;
      result = messages(chat.turns);
    } else throw new Error("지원하지 않는 대화 작업입니다.");
    chat.updated = Date.now();
    const temp = file + "." + randomUUID();
    try { await writeFile(temp, JSON.stringify(chat), { mode: 0o600 }); await rename(temp, file); }
    finally { await rm(temp, { force: true }); }
    return result;
  }
}
