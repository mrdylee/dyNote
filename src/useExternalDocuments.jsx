import { useEffect, useEffectEvent, useRef, useState } from "react";

export default function useExternalDocuments(api, invoke) {
  const [state, setState] = useState({ document: null, visible: false, opening: false, error: "" });
  const requests = useRef(0), pending = useRef(false);

  const close = () => {
    requests.current++;
    pending.current = false;
    setState(value => ({ ...value, visible: false, opening: false }));
  };
  const open = async (operation, dropped = false) => {
    const request = ++requests.current;
    pending.current = true;
    setState(value => ({ ...value, opening: true, ...(dropped ? { visible: true, document: null, error: "" } : {}) }));
    try {
      const document = await invoke(operation());
      if (request !== requests.current) return;
      setState(value => document ? { document, visible: true, opening: false, error: "" } : { ...value, opening: false });
    } catch (error) {
      if (request === requests.current) setState({ document: null, visible: true, opening: false, error: error.message });
    } finally {
      if (request === requests.current) pending.current = false;
    }
  };
  const choose = () => open(() => api.chooseExternalFile());
  const refresh = async () => {
    if (!state.visible || !state.document || pending.current) return;
    const request = ++requests.current;
    pending.current = true;
    setState(value => ({ ...value, opening: true, error: "" }));
    try {
      const document = await invoke(api.readExternalFile({ id: state.document.id, revision: state.document.revision }));
      if (request === requests.current) setState(value => ({ ...value, document: document ?? value.document, opening: false }));
    } catch (error) {
      if (request === requests.current) setState(value => ({ ...value, opening: false, error: error.message }));
    } finally {
      if (request === requests.current) pending.current = false;
    }
  };
  const openSource = async () => {
    const id = state.document?.id;
    if (!id) return;
    try { await invoke(api.openExternalFileSource({ id })); }
    catch (error) { setState(value => value.document?.id === id ? { ...value, error: error.message } : value); }
  };
  const onMenu = useEffectEvent(() => choose());
  const onFocus = useEffectEvent(() => refresh());
  const onDrop = useEffectEvent(event => {
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (!files.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (files.length !== 1) {
      requests.current++;
      pending.current = false;
      setState({ document: null, visible: true, opening: false, error: "파일은 한 번에 하나씩 놓아 주세요." });
      return;
    }
    void open(() => api.openDroppedFile(files[0]), true);
  });
  const onKey = useEffectEvent(event => {
    if (event.key !== "Escape" || !state.visible) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    close();
  });
  useEffect(() => {
    const offMenu = api?.onOpenFile?.(onMenu), offFocus = api?.onWindowFocus?.(onFocus);
    const dragover = event => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    };
    window.addEventListener("dragover", dragover, true);
    window.addEventListener("drop", onDrop, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      offMenu?.(); offFocus?.();
      window.removeEventListener("dragover", dragover, true);
      window.removeEventListener("drop", onDrop, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [api]);
  return { ...state, choose, refresh, openSource, close };
}
