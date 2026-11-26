import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  ArrowLeft, ChevronRight, Clipboard, Code, Copy, FolderOpen, List, Pilcrow,
  Redo2, RefreshCw, Scissors, Sparkles, SquareDashed, Type, Undo2,
} from "lucide-react";

const icons = { "editor-undo": Undo2, "editor-redo": Redo2, cut: Scissors, copy: Copy,
  paste: Clipboard, selectAll: SquareDashed, "format-bullet-list": List, "format-paragraph": Pilcrow,
  "ai-suggestion": Sparkles, "font-settings": Type, "sync-vault": RefreshCw, "reveal-file": FolderOpen };
const shortcuts = { "editor-undo": "Ctrl+Z", "editor-redo": "Ctrl+Y", cut: "Ctrl+X", copy: "Ctrl+C",
  paste: "Ctrl+V", selectAll: "Ctrl+A" };

export function positionMenu(menu, x, y) {
  menu.style.left = Math.max(4, Math.min(x, window.innerWidth - menu.offsetWidth - 4)) + "px";
  menu.style.top = Math.max(4, Math.min(y, window.innerHeight - menu.offsetHeight - 4)) + "px";
}

export default function WindowsEditorMenu() {
  const [request, setRequest] = useState(null);
  const [submenu, setSubmenu] = useState(null);
  const panel = useRef(null);
  const pending = useRef(null);
  function close(choice, restore) {
    const current = pending.current;
    if (!current) return;
    pending.current = null;
    flushSync(() => { setRequest(null); setSubmenu(null); });
    if (restore && current.origin.isConnected) current.origin.focus({ preventScroll: true });
    current.resolve(current.origin.isConnected ? choice : null);
  }
  useEffect(() => {
    window.dynoteShowEditorMenu = (items, point) => new Promise(resolve => {
      close(null, false);
      const target = point ? document.elementFromPoint(point.x, point.y) : document.activeElement;
      const origin = target?.closest(".code-editor .cm-content");
      if (!origin) { resolve(null); return; }
      const selection = window.getSelection();
      const rect = !point && selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : origin.getBoundingClientRect();
      const next = { items, origin, resolve, point: point ?? { x: rect.left, y: rect.bottom } };
      pending.current = next;
      setRequest(next);
    });
    return () => { delete window.dynoteShowEditorMenu; pending.current?.resolve(null); };
  }, []);
  useLayoutEffect(() => {
    if (!request) return;
    const menu = panel.current;
    positionMenu(menu, request.point.x, request.point.y);
    menu.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [request, submenu]);
  useEffect(() => {
    if (!request) return;
    const outside = event => { if (!panel.current?.contains(event.target)) close(null, false); };
    const dismiss = () => close(null, false);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside, true);
    window.addEventListener("blur", dismiss);
    window.addEventListener("resize", dismiss);
    document.addEventListener("scroll", outside, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside, true);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("resize", dismiss);
      document.removeEventListener("scroll", outside, true);
    };
  }, [request]);
  if (!request) return null;
  const back = () => {
    flushSync(() => setSubmenu(null));
    panel.current?.querySelector('[aria-haspopup="menu"]')?.focus();
  };
  function keyDown(event) {
    const buttons = [...panel.current.querySelectorAll("button:not(:disabled)")];
    const index = buttons.indexOf(event.target);
    switch (event.key) {
      case "ArrowDown": buttons[(index + 1) % buttons.length].focus(); break;
      case "ArrowUp": buttons[(index - 1 + buttons.length) % buttons.length].focus(); break;
      case "Home": buttons[0].focus(); break;
      case "End": buttons.at(-1).focus(); break;
      case "ArrowRight": if (event.target.hasAttribute("aria-haspopup")) event.target.click(); break;
      case "ArrowLeft": if (submenu) back(); break;
      case "Escape": if (submenu) back(); else close(null, true); break;
      case "Tab": close(null, true); break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
  }
  return <div ref={panel} className="file-tree-menu windows-editor-menu" role="menu"
    aria-label={submenu?.label ?? "본문 편집"} onContextMenu={event => event.preventDefault()} onKeyDown={keyDown}>
    {submenu && <button role="menuitem" onClick={back}><ArrowLeft />{submenu.label}</button>}
    {(submenu?.submenu ?? request.items).map((item, index) => {
      if (item.type === "separator") return <hr key={index} />;
      const id = item.id ?? item.role;
      const Icon = icons[id] ?? (item.submenu ? Type : Code);
      return <button key={id ?? item.label} role="menuitem" tabIndex={-1} disabled={item.enabled === false}
        aria-haspopup={item.submenu ? "menu" : undefined} onClick={() => item.submenu ? setSubmenu(item) : close(id, true)}>
        <Icon aria-hidden="true" />{item.label}
        {item.submenu ? <ChevronRight className="menu-chevron" /> : shortcuts[id] && <kbd aria-hidden="true">{shortcuts[id]}</kbd>}
      </button>;
    })}
  </div>;
}
