import { useEffect, useRef, useState } from "react";
import { previewEdit } from "./copilotEdits.mjs";
const invoke = async (promise) => { const result = await promise; if (!result.ok) throw new Error(result.error); return result.value; };

// Pending content lives outside the vault, so Git only sees accepted notes.
export default function useCopilotEdits({ api, vaultId, notes, onSaved, onOpen, onError }) {
  const [drafts, setDrafts] = useState([]), [running, setRunning] = useState(false), [working, setWorking] = useState(false), [ready, setReady] = useState(null);
  const entries = useRef([]), job = useRef(null), resolving = useRef(false), serial = useRef(Promise.resolve()), key = useRef(null), latest = useRef(null);
  latest.current = { vaultId, notes, onSaved, onOpen, onError };
  const persist = () => {
    if (!key.current) return;
    const json = JSON.stringify(entries.current);
    if (new TextEncoder().encode(json).length > 2 * 1024 * 1024) throw new Error("Copilot 복구 초안이 2 MiB를 넘었습니다. 유지하거나 복구본을 저장해 주세요.");
    localStorage.setItem(key.current, json);
  };
  const update = (next) => { entries.current = next; setDrafts(next); persist(); };
  useEffect(() => {
    key.current = vaultId ? `dynote.copilot.drafts.${vaultId}` : null;
    job.current = null; setRunning(false);
    try {
      const saved = key.current ? JSON.parse(localStorage.getItem(key.current) || "[]") : [];
      if (!Array.isArray(saved) || saved.length > 5 || saved.some((d) => !d || typeof d.path !== "string" || typeof d.content !== "string" || typeof d.original !== "string" || typeof d.aiContent !== "string")) throw new Error("Copilot 복구 초안을 읽지 못했습니다.");
      entries.current = saved; setDrafts(saved); setReady(vaultId);
    } catch (error) { setReady(null); latest.current.onError(error.message); }
  }, [vaultId]);
  const stop = () => {
    if (!job.current) return;
    job.current.stopped = true;
    api.copilotCancel({ requestId: job.current.id }).catch(() => {});
  };
  const begin = (requestId) => {
    if (entries.current.length || job.current || ready !== vaultId) throw new Error("진행 중인 Copilot 변경을 먼저 유지하거나 되돌려 주세요.");
    job.current = { id: requestId, vaultId, stopped: false }; setRunning(true);
  };
  const stage = (proposal, requestId) => {
    serial.current = serial.current.then(async () => {
      const active = job.current;
      if (!active || active.id !== requestId || active.stopped || active.vaultId !== latest.current.vaultId) return;
      const snapshot = await invoke(api.snapshot());
      if (active.stopped || active !== job.current || snapshot.id !== active.vaultId) return;
      const source = latest.current.notes.find((n) => n.path === proposal.path);
      const disk = snapshot.notes.find((n) => n.path === proposal.path);
      const previous = entries.current.find((d) => d.path === proposal.path);
      try {
        const draft = previewEdit(proposal, source, disk?.revision ?? null, requestId, previous);
        update([...entries.current.filter((d) => d.path !== draft.path), draft]);
        if (!previous) latest.current.onOpen(draft.path);
      } catch (error) {
        stop();
        if (previous) update(entries.current.map((d) => d.path === proposal.path ? { ...d, conflict: error.message } : d));
        else {
          // Preserve both the user's current buffer and the incoming draft on a first-batch conflict.
          const original = proposal.target?.original ?? "";
          const revision = source?.revision ?? null;
          const draft = previewEdit(proposal, proposal.kind === "create" ? null : { path: proposal.path, content: original, revision }, proposal.kind === "create" ? null : revision, requestId);
          update([...entries.current, { ...draft, content: source?.content ?? draft.content, userEdited: !!source, conflict: error.message }]);
          latest.current.onOpen(draft.path);
        }
        latest.current.onError(error.message);
      }
    }).catch((error) => { stop(); latest.current.onError(error.message); });
    return serial.current;
  };
  const finish = async (requestId) => {
    await serial.current;
    if (job.current?.id === requestId) { job.current = null; setRunning(false); }
  };
  const edit = (path, content) => {
    const draft = entries.current.find((d) => d.path === path);
    if (!draft) return false;
    stop();
    try { update(entries.current.map((d) => d.path === path ? { ...d, content, userEdited: true } : d)); }
    catch (error) { latest.current.onError(error.message); }
    return true;
  };
  const resolve = async (path, action) => {
    if (job.current || resolving.current) return;
    const draft = entries.current.find((d) => d.path === path);
    if (!draft) return;
    resolving.current = true; setWorking(true);
    try {
      if (action === "undo") {
        if (draft.userEdited) throw new Error("직접 편집한 내용이 있어 자동 되돌리기를 할 수 없습니다. 유지하거나 복구본을 저장해 주세요.");
        const snapshot = await invoke(api.snapshot());
        latest.current.onSaved(snapshot.notes.filter((n) => n.path === path), path);
      } else if (action === "recover") {
        const content = `# Copilot 복구 · ${draft.path}\n\n## 현재 초안\n\n${draft.content}\n\n## AI 초안\n\n${draft.aiContent}\n\n## 원본\n\n${draft.original}`;
        const saved = await invoke(api.createNote({ vaultId, path: `Copilot 복구 ${Date.now()}-${crypto.randomUUID().slice(0, 6)}.md`, content }));
        const snapshot = await invoke(api.snapshot());
        latest.current.onSaved(snapshot.notes.filter((n) => n.path === path || n.path === saved.path), path); latest.current.onOpen(saved.path);
      } else {
        const args = { vaultId, path, content: draft.content, revision: draft.revision };
        const saved = await invoke(draft.kind === "create" ? api.createNote(args) : api.saveNote(args));
        latest.current.onSaved([saved]);
      }
      update(entries.current.filter((d) => d.path !== path));
    } catch (error) {
      try { update(entries.current.map((d) => d.path === path ? { ...d, conflict: error.message } : d)); } catch { /* Keep the in-memory draft until recovery succeeds. */ }
      latest.current.onError(error.message);
    } finally { resolving.current = false; setWorking(false); }
  };
  return { drafts, running, working, ready: ready === vaultId, begin, stage, finish, edit, resolve, stop, persist,
    blocked: () => !!job.current || entries.current.length > 0,
    close: async () => { stop(); await serial.current; persist(); },
  };
}
