import { useEffect, useRef, useState } from "react";
import { previewEdit } from "./copilotEdits.mjs";
const invoke = async (promise) => { const result = await promise; if (!result.ok) throw new Error(result.error); return result.value; };
const empty = [];
const storageKey = id => `dynote.copilot.drafts.${id}`;

// Pending content lives outside its vault, so Git only sees accepted notes.
export default function useCopilotEdits({ api, vaults, onSaved, onOpen, onError }) {
  const [drafts, setDrafts] = useState({});
  const [running, setRunning] = useState([]), [working, setWorking] = useState(null);
  const entries = useRef(new Map()), jobs = useRef(new Map()), resolving = useRef(null);
  const serial = useRef(new Map()), latest = useRef(null);
  latest.current = { vaults, onSaved, onOpen, onError };
  const readDrafts = id => entries.current.get(id) ?? empty;
  const persist = id => {
    const json = JSON.stringify(readDrafts(id));
    if (new TextEncoder().encode(json).length > 2 * 1024 * 1024) throw new Error("Copilot 복구 초안이 2 MiB를 넘었습니다. 유지하거나 복구본을 저장해 주세요.");
    localStorage.setItem(storageKey(id), json);
  };
  const update = (id, next) => {
    entries.current.set(id, next);
    setDrafts(old => ({ ...old, [id]: next }));
    persist(id);
  };
  const ids = Object.values(vaults).map(vault => vault.id).filter(Boolean).sort().join(",");
  useEffect(() => {
    for (const id of ids.split(",").filter(Boolean)) {
      if (entries.current.has(id)) continue;
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey(id)) || "[]");
        if (!Array.isArray(saved) || saved.length > 5 || saved.some(d => !d || typeof d.path !== "string" || typeof d.content !== "string" || typeof d.original !== "string" || typeof d.aiContent !== "string")) {
          throw new Error("Copilot 복구 초안을 읽지 못했습니다.");
        }
        entries.current.set(id, saved);
        setDrafts(old => ({ ...old, [id]: saved }));
      } catch (error) { latest.current.onError(error.message); }
    }
  }, [ids]);
  const stop = id => {
    for (const [vaultId, job] of jobs.current) {
      if (id && id !== vaultId) continue;
      job.stopped = true;
      job.cancel().catch(() => {});
    }
  };
  const begin = (id, requestId, cancel = () => api.copilotCancel({ requestId })) => {
    if (jobs.current.has(id) || resolving.current?.vaultId === id) throw new Error("이 보관함의 AI 변경 작업이 끝난 뒤 다시 요청해 주세요.");
    if (!entries.current.has(id)) throw new Error("AI 복구 초안을 확인해 주세요.");
    const notes = new Map([...latest.current.vaults[id].notes, ...readDrafts(id)].map(note => [note.path, note]));
    jobs.current.set(id, { id: requestId, stopped: false, notes, conflicts: new Set(), cancel });
    setRunning([...jobs.current.keys()]);
  };
  const stage = (id, proposal, requestId) => {
    const operation = (serial.current.get(id) ?? Promise.resolve()).then(async () => {
      const active = jobs.current.get(id);
      if (!active || active.id !== requestId || active.stopped || active.conflicts.has(proposal.path)) return;
      const snapshot = await invoke(api.snapshot({ vaultId: id }));
      if (active.stopped || active !== jobs.current.get(id) || snapshot.id !== id || !latest.current.vaults[id]) return;
      const source = latest.current.vaults[id].notes.find(n => n.path === proposal.path);
      const disk = snapshot.notes.find(n => n.path === proposal.path);
      const previous = readDrafts(id).find(d => d.path === proposal.path);
      if (!previous && readDrafts(id).length >= 5) {
        active.conflicts.add(proposal.path);
        latest.current.onError("미확정 문서가 5개입니다. 기존 변경을 먼저 검토해 주세요.");
        return;
      }
      try {
        const draft = previewEdit(proposal, source, disk?.revision ?? null, requestId, previous, active.notes.get(proposal.path));
        update(id, [...readDrafts(id).filter(d => d.path !== draft.path), draft]);
        if (!previous) latest.current.onOpen(id, draft.path);
      } catch (error) {
        active.conflicts.add(proposal.path);
        if (previous) update(id, readDrafts(id).map(d => d.path === proposal.path ? { ...d, conflict: error.message } : d));
        else {
          const original = proposal.target?.original ?? "";
          const revision = source?.revision ?? null;
          const draft = previewEdit(proposal, proposal.kind === "create" ? null : { path: proposal.path, content: original, revision }, proposal.kind === "create" ? null : revision, requestId);
          update(id, [...readDrafts(id), { ...draft, content: source?.content ?? draft.content, userEdited: !!source, conflict: error.message }]);
          latest.current.onOpen(id, draft.path);
        }
        latest.current.onError(error.message);
      }
    }).catch(error => { if (jobs.current.get(id)?.id === requestId) stop(id); latest.current.onError(error.message); });
    serial.current.set(id, operation);
    return operation;
  };
  const finish = async (id, requestId) => {
    await serial.current.get(id);
    if (jobs.current.get(id)?.id === requestId) {
      jobs.current.delete(id);
      serial.current.delete(id);
      setRunning([...jobs.current.keys()]);
    }
  };
  const edit = (id, path, content) => {
    if (!readDrafts(id).some(d => d.path === path)) return false;
    const job = jobs.current.get(id);
    const active = job && !job.stopped;
    if (active) job.conflicts.add(path);
    try { update(id, readDrafts(id).map(d => d.path === path ? { ...d, content, userEdited: true,
      ...(active ? { conflict: "요청 후 직접 편집하여 이 문서의 AI 추가 반영을 멈췄습니다." } : {}) } : d)); }
    catch (error) { latest.current.onError(error.message); }
    return true;
  };
  const revise = (id, path, content) => {
    if (!readDrafts(id).some(d => d.path === path)) return false;
    if (jobs.current.has(id) || resolving.current?.vaultId === id)
      throw new Error("이 보관함의 AI 변경 작업이 끝난 뒤 수정안을 적용해 주세요.");
    update(id, readDrafts(id).map(d => d.path === path ? { ...d, content, aiContent: content } : d));
    return true;
  };
  const resolve = (id, path, action) => {
    if (jobs.current.has(id) || resolving.current) return;
    const draft = readDrafts(id).find(d => d.path === path);
    if (!draft) return;
    setWorking(id);
    const operation = (async () => {
      try {
        const scope = { vaultId: id };
        if (action === "undo") {
          if (draft.userEdited) throw new Error("직접 편집한 내용이 있어 자동 되돌리기를 할 수 없습니다. 유지하거나 복구본을 저장해 주세요.");
          const snapshot = await invoke(api.snapshot(scope));
          latest.current.onSaved(id, snapshot.notes.filter(n => n.path === path), path);
        } else if (action === "recover") {
          const content = `# Copilot 복구 · ${draft.path}\n\n## 현재 초안\n\n${draft.content}\n\n## AI 초안\n\n${draft.aiContent}\n\n## 원본\n\n${draft.original}`;
          const saved = await invoke(api.createNote({ ...scope, path: `Copilot 복구 ${Date.now()}-${crypto.randomUUID().slice(0, 6)}.md`, content }));
          const snapshot = await invoke(api.snapshot(scope));
          latest.current.onSaved(id, snapshot.notes.filter(n => n.path === path || n.path === saved.path), path);
          latest.current.onOpen(id, saved.path);
        } else {
          const args = { ...scope, path, content: draft.content, revision: draft.revision };
          const saved = await invoke(draft.kind === "create" ? api.createNote(args) : api.saveNote(args));
          latest.current.onSaved(id, [saved]);
        }
        update(id, readDrafts(id).filter(d => d.path !== path));
      } catch (error) {
        try { update(id, readDrafts(id).map(d => d.path === path ? { ...d, conflict: error.message } : d)); } catch { /* Keep the in-memory draft until recovery succeeds. */ }
        latest.current.onError(error.message);
      } finally { resolving.current = null; setWorking(null); }
    })();
    resolving.current = { vaultId: id, operation };
    return operation;
  };
  const blocked = id => id ? jobs.current.has(id) || readDrafts(id).length > 0
    : !!jobs.current.size || !!resolving.current || Object.values(latest.current.vaults).some(vault => readDrafts(vault.id).length > 0);
  return {
    drafts, blocked,
    forVault: id => ({
      drafts: drafts[id] ?? empty, running: running.includes(id), working: !!id && working === id,
      ready: Object.hasOwn(drafts, id), blocked: () => blocked(id),
      begin: (requestId, cancel) => begin(id, requestId, cancel),
      stage: (proposal, requestId) => stage(id, proposal, requestId), finish: requestId => finish(id, requestId),
      edit: (path, content) => edit(id, path, content), revise: (path, content) => revise(id, path, content),
      stop: () => stop(id), resolve: (path, action) => resolve(id, path, action),
    }),
    close: async () => {
      stop();
      await Promise.all(serial.current.values());
      await resolving.current?.operation;
      for (const id of entries.current.keys()) persist(id);
    },
  };
}
