import { useCallback, useMemo, useRef, useState } from "react";
import { spaceLabel } from "../core/document-workspace.mjs";
import { documentKind } from "../core/documents.mjs";
import { SaveQueue } from "./saveQueue.mjs";

export default function useVaultDocuments(api, invoke) {
  const [vaults, setVaults] = useState({});
  const current = useRef({});
  const revisions = useRef(new Map());
  const revisionMap = useCallback(id => {
    if (!revisions.current.has(id)) revisions.current.set(id, new Map());
    return revisions.current.get(id);
  }, []);
  const update = useCallback((id, transform) => {
    const old = current.current[id];
    const next = transform(old);
    if (next === old) return;
    current.current = { ...current.current, [id]: next };
    setVaults(current.current);
  }, []);
  const remove = useCallback(id => {
    const next = { ...current.current };
    delete next[id];
    revisions.current.delete(id);
    current.current = next;
    setVaults(next);
  }, []);
  const queue = useMemo(() => {
    const byVault = new Map();
    return {
      get dirty() { return [...byVault.values()].some(queue => queue.dirty); },
      get(id, path) { return byVault.get(id)?.get(path); },
      set(id, draft) {
        if (!byVault.has(id)) byVault.set(id, new SaveQueue((path, content, revision) => {
          const save = documentKind(path) ? api.saveDocument : api.saveNote;
          return invoke(save({ vaultId: id, path, content, revision }));
        }, saved => {
          revisionMap(id).set(saved.path, saved.revision);
          const files = documentKind(saved.path) ? "documents" : "notes";
          update(id, vault => vault && ({ ...vault, [files]: vault[files].map(file => (
            file.path === saved.path ? { ...file, revision: saved.revision, metadata: saved.metadata } : file
          )) }));
        }));
        byVault.get(id).set(draft);
      },
      async flush() {
        const pending = [...byVault].filter(([, queue]) => queue.dirty);
        const results = await Promise.allSettled(pending.map(([, queue]) => queue.flush()));
        const errors = results.flatMap((result, index) => {
          if (result.status === "fulfilled") return [];
          const scope = current.current[pending[index][0]];
          return [scope ? `${spaceLabel(scope)} · ${result.reason.message}` : result.reason.message];
        });
        if (errors.length) throw new Error(errors.join(" · "));
      },
    };
  }, [api, invoke, revisionMap, update]);
  const install = useCallback(snapshot => {
    const id = snapshot.id;
    const map = revisionMap(id);
    const installFiles = files => files.map(file => {
      const draft = queue.get(id, file.path);
      if (draft) return { ...file, content: draft.content, revision: draft.revision };
      map.set(file.path, file.revision);
      return file;
    });
    update(id, old => ({ ...old, ...snapshot, notes: installFiles(snapshot.notes), documents: installFiles(snapshot.documents ?? []) }));
  }, [queue, revisionMap, update]);
  return { vaults, current, revisionMap, update, remove, queue, install };
}
