import { useEffect, useEffectEvent, useRef, useState } from "react";

export default function useExternalDocuments(api, invoke, activeKey, activate, onError) {
  const [documents, setDocuments] = useState({});
  const [opening, setOpening] = useState(false);
  const openingRequests = useRef(new Set());
  const reads = useRef(new Map());
  const current = documents[activeKey];

  const open = async operation => {
    const closedDuringOpen = new Set();
    openingRequests.current.add(closedDuringOpen);
    setOpening(true);
    try {
      const document = await invoke(operation());
      if (document) {
        const key = "external:" + document.id;
        if (closedDuringOpen.has(key)) return;
        reads.current.delete(key);
        setDocuments(old => ({ ...old, [key]: { position: old[key]?.position ?? { current: {} }, editing: old[key]?.editing, document, error: "" } }));
        activate(key);
      }
    } catch (error) { onError(error.message); }
    finally {
      openingRequests.current.delete(closedDuringOpen);
      setOpening(openingRequests.current.size > 0);
    }
  };
  const choose = () => open(() => api.chooseExternalFile());
  const close = key => {
    const entry = documents[key];
    if (!entry) return;
    for (const request of openingRequests.current) request.add(key);
    reads.current.delete(key);
    setDocuments(old => {
      const next = { ...old };
      delete next[key];
      return next;
    });
    invoke(api.closeExternalFile({ id: entry.document.id })).catch(error => onError(error.message));
  };
  const refresh = async (background = false) => {
    if (!current || (background && reads.current.has(activeKey))) return;
    const request = Symbol();
    reads.current.set(activeKey, request);
    const { id, revision } = current.document;
    try {
      const document = await invoke(api.readExternalFile({ id, revision }));
      if (reads.current.get(activeKey) !== request) return;
      setDocuments(old => {
        const entry = old[activeKey];
        if (!entry || (!document && !entry.error)) return old;
        return { ...old, [activeKey]: { ...entry, document: document ?? entry.document, error: "" } };
      });
    } catch (error) {
      if (reads.current.get(activeKey) !== request) return;
      setDocuments(old => old[activeKey] && old[activeKey].error !== error.message
        ? { ...old, [activeKey]: { ...old[activeKey], error: error.message } } : old);
    } finally {
      if (reads.current.get(activeKey) === request) reads.current.delete(activeKey);
    }
  };
  const openSource = async () => {
    if (!current) return;
    try {
      await invoke(api.openExternalFileSource({ id: current.document.id }));
      setDocuments(old => old[activeKey] ? { ...old, [activeKey]: { ...old[activeKey], editing: true } } : old);
    } catch (error) { onError(error.message); }
  };
  const onRefresh = useEffectEvent(refresh);
  useEffect(() => {
    if (!activeKey) return;
    void onRefresh();
    const unsubscribe = api?.onWindowFocus?.(() => onRefresh());
    const timer = current?.editing ? setInterval(() => onRefresh(true), 1500) : null;
    return () => { unsubscribe?.(); clearInterval(timer); };
  }, [api, activeKey, current?.editing]);
  const onMenu = useEffectEvent(choose);
  const onDrop = useEffectEvent(event => {
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (!files.length || event.target.closest?.("[data-sidebar-copy]")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (files.length !== 1) { onError("파일은 한 번에 하나씩 놓아 주세요."); return; }
    void open(() => api.openDroppedFile(files[0]));
  });
  useEffect(() => {
    const offMenu = api?.onOpenFile?.(onMenu);
    const dragover = event => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    };
    window.addEventListener("dragover", dragover, true);
    window.addEventListener("drop", onDrop, true);
    return () => {
      offMenu?.();
      window.removeEventListener("dragover", dragover, true);
      window.removeEventListener("drop", onDrop, true);
    };
  }, [api]);
  return { documents, current, opening, choose, refresh: () => refresh(), openSource, close };
}
