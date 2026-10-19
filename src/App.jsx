import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import {
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  FileText,
  Files,
  Folder,
  FolderOpen,
  Hash,
  Link2,
  List,
  LoaderCircle,
  Network,
  PanelRight,
  PencilLine,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  SplitSquareHorizontal,
  X,
} from "lucide-react";
import {
  buildKnowledge,
  renderMarkdown,
  resolveLink,
  searchNotes,
  parseMetadata,
  updateMetadata,
  toggleTask,
  attachmentUrl,
} from "../core/knowledge.mjs";
import { SaveQueue } from "./saveQueue.mjs";
import Editor from "./Editor.jsx";
import Graph from "./Graph.jsx";
import PdfViewer from "./PdfViewer.jsx";
import DiagramPreview from "./DiagramPreview.jsx";
import CanvasEditor from "./CanvasEditor.jsx";
import BasesView from "./BasesView.jsx";
import { documentKind } from "../core/documents.mjs";
import { version } from "../package.json";
import "katex/dist/katex.min.css";

const api = window.notes;
const invoke = async (result) => {
  const response = await result;
  if (!response.ok) throw new Error(response.error);
  return response.value;
};
const shortcut = navigator.platform.includes("Mac") ? "⌘" : "Ctrl";

function IconButton({ label, children, onClick, active = false, ...props }) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  );
}

function FileTree({ notes, active, onOpen }) {
  const [closed, setClosed] = useState(new Set());
  const tree = Object.create(null);
  for (const note of notes) {
    let cursor = tree;
    const parts = note.path.split("/");
    for (const part of parts.slice(0, -1))
      cursor = (cursor[part] ??= { children: Object.create(null) }).children;
    cursor[parts.at(-1)] = { note };
  }
  const render = (level, prefix = "", depth = 0) =>
    Object.entries(level)
      .sort(
        ([a, av], [b, bv]) =>
          Number(!!bv.children) - Number(!!av.children) ||
          a.localeCompare(b, "ko"),
      )
      .map(([name, item]) => {
        const path = prefix + name;
        if (item.note)
          return (
            <button
              key={path}
              className={`file-row ${active === path ? "selected" : ""}`}
              style={{ paddingLeft: 17 + depth * 16 }}
              onClick={() => onOpen(path)}
              title={path}
            >
              <FileText size={14} />
              <span>{name.replace(/\.md$/i, "")}</span>
              {active === path && <span className="active-file-dot" />}
            </button>
          );
        const expanded = !closed.has(path);
        return (
          <div key={path}>
            <button
              className="folder-row"
              style={{ paddingLeft: 12 + depth * 16 }}
              onClick={() =>
                setClosed((old) => {
                  const next = new Set(old);
                  if (expanded) next.add(path);
                  else next.delete(path);
                  return next;
                })
              }
              aria-expanded={expanded}
            >
              {expanded ? (
                <ChevronDown size={13} />
              ) : (
                <ChevronRight size={13} />
              )}
              <Folder size={14} />
              <span>{name}</span>
            </button>
            {expanded && render(item.children, path + "/", depth + 1)}
          </div>
        );
      });
  return <div className="file-tree">{render(tree)}</div>;
}

function Modal({ title, children, onClose, wide = false }) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <IconButton label="닫기" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        {children}
      </section>
    </div>
  );
}

export default function App() {
  const [vault, setVault] = useState(null);
  const [raw, setRaw] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [active, setActive] = useState(null);
  const [tabs, setTabs] = useState([]);
  const [section, setSection] = useState("files");
  const [mode, setMode] = useState("read");
  const [query, setQuery] = useState("");
  const [right, setRight] = useState(true);
  const [status, setStatus] = useState("saved");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null);
  const [newName, setNewName] = useState("");
  const [switchQuery, setSwitchQuery] = useState("");
  const [attachment, setAttachment] = useState(null);
  const [fileTarget, setFileTarget] = useState(null);
  const [propertiesDraft, setPropertiesDraft] = useState("");
  const [lastTrash, setLastTrash] = useState(null);
  const revisions = useRef(new Map());
  const queue = useRef(null);
  const timer = useRef(null);
  const preview = useRef(null);
  const model = useMemo(() => buildKnowledge(raw), [raw]);
  const note = model.notes.find((n) => n.path === active);
  const structured = documents.find((d) => d.path === active);
  const results = useMemo(
    () => searchNotes(model.notes, query),
    [model, query],
  );
  const switchResults = useMemo(
    () => searchNotes(model.notes, switchQuery).slice(0, 9),
    [model, switchQuery],
  );
  const html = useMemo(
    () =>
      note
        ? DOMPurify.sanitize(
            renderMarkdown(note.content, model.notes, note.path, {
              vaultId: vault.id,
              attachments: vault.attachments ?? [],
            }),
            {
              FORBID_TAGS: ["iframe", "style", "form", "svg", "math"],
              ADD_ATTR: [
                "data-note",
                "data-external",
                "data-anchor",
                "data-attachment",
                "data-task-line",
                "data-embed",
              ],
              ADD_URI_SAFE_ATTR: ["src"],
            },
          )
        : "",
    [note, model, vault],
  );

  const install = useCallback((snapshot) => {
    clearTimeout(timer.current);
    setVault(snapshot);
    setRaw(snapshot.notes);
    setDocuments(snapshot.documents ?? []);
    revisions.current = new Map(
      [...snapshot.notes, ...(snapshot.documents ?? [])].map((n) => [n.path, n.revision]),
    );
    setAttachment(null);
    const initial =
      snapshot.notes.find((n) => n.path === "시작하기.md")?.path ??
      snapshot.notes[0]?.path ??
      snapshot.documents?.[0]?.path ??
      null;
    setActive(initial);
    setTabs(initial ? [initial] : []);
    setError(snapshot.warnings.join(" · "));
    setStatus("saved");
    queue.current = new SaveQueue(
      (path, content, revision) =>
        invoke((documentKind(path) ? api.saveDocument : api.saveNote)({ vaultId: snapshot.id, path, content, revision })),
      (saved) => {
        revisions.current.set(saved.path, saved.revision);
        setRaw((current) =>
          current.map((n) =>
            n.path === saved.path ? { ...n, revision: saved.revision, metadata: saved.metadata } : n,
          ),
        );
        setDocuments((current) => current.map((d) => d.path === saved.path ? { ...d, revision: saved.revision } : d));
      },
    );
  }, []);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (!queue.current?.dirty) return;
    setStatus("saving");
    try {
      await queue.current.flush();
      setStatus("saved");
      setError("");
    } catch (err) {
      setStatus("error");
      setError(err.message);
      throw err;
    }
  }, []);

  useEffect(() => {
    if (!api) {
      setError(
        "데스크톱 앱에서 열어 주세요. 먼저 빌드한 뒤 앱을 실행할 수 있습니다.",
      );
      return;
    }
    invoke(api.snapshot())
      .then(install)
      .catch((err) => setError(err.message));
    return api.onBeforeClose(async () => {
      try {
        await flush();
        api.confirmClose();
      } catch {
        /* The draft stays in the open window. */
      }
    });
  }, [install, flush]);

  const openNote = useCallback((path) => {
    setActive(path);
    setAttachment(null);
    setTabs((old) => (old.includes(path) ? old : [...old, path]));
    setSection((old) => (old === "graph" ? "files" : old));
    setModal(null);
  }, []);

  const change = (content) => {
    if (!note || content === note.content) return;
    changeFile(note.path, content);
  };
  const changeFile = (path, content) => {
    const source = [...raw, ...documents].find((n) => n.path === path);
    if (!source || source.content === content || busy) return;
    queue.current.set({ path, content, revision: revisions.current.get(path) ?? source.revision });
    const update = (old) => old.map((n) => n.path === path ? { ...n, content } : n);
    if (documentKind(path)) setDocuments(update); else setRaw(update);
    setStatus("dirty");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush().catch(() => {}), 700);
  };

  const pickFolder = async () => {
    setBusy(true);
    try {
      await flush();
      const snapshot = await invoke(api.pickVault());
      if (snapshot) install(snapshot);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const createNote = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const path = /\.(md|canvas|base)$/i.test(newName.trim())
        ? newName.trim()
        : newName.trim() + ".md";
      const created = await invoke((documentKind(path) ? api.createDocument : api.createNote)({ vaultId: vault.id, path }));
      revisions.current.set(created.path, created.revision);
      if (documentKind(path)) setDocuments((old) => [...old, created]);
      else setRaw((old) => [...old, created]);
      openNote(created.path);
      setMode("edit");
      setNewName("");
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const reload = async () => {
    try {
      install(await invoke(api.snapshot()));
      setModal(null);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    const handler = (event) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        ["p", "k", "s", "n"].includes(event.key.toLowerCase())
      ) {
        event.preventDefault();
        const key = event.key.toLowerCase();
        if (key === "s") flush().catch(() => {});
        else if (key === "n") {
          setNewName("");
          setModal("new");
        } else {
          setSwitchQuery("");
          setModal("switch");
        }
      }
      if (event.key === "Escape") setModal(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [flush]);

  const importFiles = async (files) => {
    try {
      const imported = [];
      for (const file of files) {
        if (file.size > 25 * 1024 * 1024)
          throw new Error("첨부파일은 25MB 이하여야 합니다.");
        imported.push(
          await invoke(
            api.importAttachment({
              vaultId: vault.id,
              name: file.name,
              bytes: new Uint8Array(await file.arrayBuffer()),
            }),
          ),
        );
      }
      setVault((old) => ({
        ...old,
        attachments: [...(old.attachments ?? []), ...imported],
      }));
      return imported;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };
  const chooseAttachments = async () => {
    setBusy(true);
    try {
      const imported = await invoke(
        api.chooseAttachments({ vaultId: vault.id }),
      );
      setVault((old) => ({
        ...old,
        attachments: [...(old.attachments ?? []), ...imported],
      }));
      if (note && imported.length) {
        change(
          note.content +
            "\n" +
            imported
              .map((a) => `${/\.pdf$/i.test(a.path) ? "" : "!"}[[${a.path}]]`)
              .join("\n") +
            "\n",
        );
        setMode("split");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const openAttachment = async (path) => {
    try {
      const data = await invoke(
        api.readAttachment({ vaultId: vault.id, path }),
      );
      setAttachment(data);
      setSection("files");
    } catch (err) {
      setError(err.message);
    }
  };
  const openFile = (path) => {
    if ([...raw, ...documents].some((n) => n.path === path)) openNote(path);
    else if ((vault.attachments ?? []).some((n) => n.path === path)) openAttachment(path);
    else setError(`파일을 찾을 수 없습니다: ${path}`);
  };
  const openExternal = (url) => invoke(api.openExternal(url)).catch((err) => setError(err.message));
  const prepareFile = async (path, action) => {
    try {
      let revision = revisions.current.get(path);
      if (!/\.(md|canvas|base)$/i.test(path))
        revision = (
          await invoke(api.readAttachment({ vaultId: vault.id, path }))
        ).revision;
      setError("");
      setFileTarget({ path, revision });
      setNewName(path);
      setModal(action);
    } catch (err) {
      setError(err.message);
    }
  };
  const alterFile = async (event) => {
    event?.preventDefault();
    setBusy(true);
    try {
      await flush();
      const revision =
        revisions.current.get(fileTarget.path) ?? fileTarget.revision;
      if (modal === "move") {
        const snapshot = await invoke(
          api.moveFile({
            vaultId: vault.id,
            from: fileTarget.path,
            to: newName.trim(),
            revision,
          }),
        );
        install(snapshot);
        if (/\.(md|canvas|base)$/i.test(newName.trim())) openNote(newName.trim());
        else await openAttachment(newName.trim());
      } else {
        const item = await invoke(
          api.trashFile({ vaultId: vault.id, path: fileTarget.path, revision }),
        );
        setLastTrash({ ...item, vaultId: vault.id });
        install(await invoke(api.snapshot()));
      }
      setModal(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const restoreLast = async () => {
    setBusy(true);
    try {
      await flush();
      const snapshot = await invoke(
        api.restoreTrash({ vaultId: lastTrash.vaultId, id: lastTrash.id }),
      );
      install(snapshot);
      if (/\.(md|canvas|base)$/i.test(lastTrash.path)) openNote(lastTrash.path);
      else await openAttachment(lastTrash.path);
      setLastTrash(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const followLink = (event) => {
    const checkbox = event.target.closest("input[data-task-line]");
    if (checkbox) {
      event.preventDefault();
      if (!checkbox.disabled)
        try {
          change(
            toggleTask(
              note.content,
              Number(checkbox.dataset.taskLine),
              checkbox.checked,
            ),
          );
        } catch (err) {
          setError(err.message);
        }
      return;
    }
    const anchor = event.target.closest("a");
    if (!anchor) return;
    event.preventDefault();
    if (anchor.dataset.attachment) {
      openAttachment(anchor.dataset.attachment);
      return;
    }
    if (anchor.dataset.anchor) {
      preview.current?.querySelectorAll("[id]").forEach((n) => {
        if (n.id === anchor.dataset.anchor)
          n.scrollIntoView({ behavior: "smooth" });
      });
      return;
    }
    const target = anchor.dataset.note;
    if (target !== undefined) {
      const resolved = resolveLink(target, active, [...model.notes, ...documents]);
      if (resolved.status === "resolved") {
        if (resolved.path !== active) openNote(resolved.path);
        const heading = target.split("#")[1];
        if (heading)
          setTimeout(() => {
            const headingNode = [
              ...(preview.current?.querySelectorAll("h1,h2,h3,h4,h5,h6") ?? []),
            ].find((h) => h.textContent === decodeURIComponent(heading));
            headingNode?.scrollIntoView({ behavior: "smooth" });
          }, 50);
      } else if (resolved.status === "ambiguous")
        setError(
          "같은 이름의 문서가 여러 개 있습니다. 링크에 폴더 경로를 적어 주세요.",
        );
      else {
        setNewName(target.split(/[\#^]/)[0]);
        setModal("new");
      }
    } else
      invoke(api.openExternal(anchor.href)).catch((err) =>
        setError(err.message),
      );
  };

  if (!vault)
    return (
      <div className="loading-screen">
        <div className="brand-mark">
          <BookOpen size={25} />
        </div>
        <h1>Dynote</h1>
        <p>{error || "생각을 연결할 준비를 하고 있어요…"}</p>
      </div>
    );
  const incoming = model.backlinks[active] ?? [];
  const outgoing = model.edges
    .filter((e) => e.source === active)
    .map((e) => model.notes.find((n) => n.path === e.target))
    .filter(Boolean);
  return (
    <div className="app-shell">
      <header className="titlebar">
        <span>Dynote</span>
        <div>
          <span className="local-dot" />내 기기에 저장되는 지식 공간
        </div>
        <button
          onClick={() => {
            setSwitchQuery("");
            setModal("switch");
          }}
        >
          <Search size={13} />
          <span>문서로 이동</span>
          <kbd>{shortcut} K</kbd>
        </button>
      </header>
      <div className="app-body">
        <nav className="activity-rail" aria-label="주 메뉴">
          <button
            className="brand-mark"
            title="시작 문서"
            aria-label="시작 문서"
            onClick={() => {
              if (raw[0])
                openNote(
                  raw.find((n) => n.path === "시작하기.md")?.path ??
                    raw[0].path,
                );
            }}
          >
            <BookOpen size={22} />
          </button>
          <div className="rail-nav">
            <IconButton
              label="파일 목록"
              active={section === "files"}
              onClick={() => setSection("files")}
            >
              <Files size={20} />
            </IconButton>
            <IconButton
              label="전체 검색"
              active={section === "search"}
              onClick={() => setSection("search")}
            >
              <Search size={20} />
            </IconButton>
            <IconButton
              label="그래프 보기"
              active={section === "graph"}
              onClick={() => setSection("graph")}
            >
              <Network size={20} />
            </IconButton>
          </div>
          <div className="rail-bottom">
            <IconButton
              label="저장과 복구 안내"
              onClick={() => setModal("about")}
            >
              <ShieldCheck size={20} />
            </IconButton>
            <span className="avatar">DN</span>
          </div>
        </nav>
        <aside className="navigator">
          <div className="vault-switch">
            <div className="vault-icon">
              <FolderOpen size={18} />
            </div>
            <div>
              <strong>{vault.name}</strong>
              <span>로컬 보관함</span>
            </div>
            <IconButton
              label="다른 폴더 열기"
              onClick={pickFolder}
              disabled={busy}
            >
              <ChevronDown size={16} />
            </IconButton>
          </div>
          <button
            className="search-shortcut"
            onClick={() => {
              setSection("search");
              setTimeout(
                () => document.getElementById("vault-search")?.focus(),
                0,
              );
            }}
          >
            <Search size={15} />
            <span>모든 문서 검색</span>
            <kbd>{shortcut} K</kbd>
          </button>
          <div className="nav-section-title">
            <span>{section === "search" ? "검색 결과" : "내 문서"}</span>
            <div>
              <IconButton
                label="문서 새로고침"
                onClick={() =>
                  queue.current?.dirty ? setModal("reload") : reload()
                }
                disabled={busy}
              >
                <FolderOpen size={14} />
              </IconButton>
              <IconButton
                label="새 문서"
                onClick={() => {
                  setNewName("");
                  setModal("new");
                }}
                disabled={busy}
              >
                <Plus size={16} />
              </IconButton>
            </div>
          </div>
          {section === "search" ? (
            <div className="search-panel">
              <input
                id="vault-search"
                autoFocus
                aria-label="전체 문서 검색"
                placeholder='단어, "구문", tag:bms, path:노트/ -제외'
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className="result-count">{results.length}개의 문서</span>
              {results.map((n) => (
                <button
                  className={`search-result ${n.path === active ? "selected" : ""}`}
                  key={n.path}
                  onClick={() => openNote(n.path)}
                >
                  <strong>
                    <FileText size={14} />
                    {n.title}
                  </strong>
                  <span>{n.snippet || n.path}</span>
                </button>
              ))}
              {!results.length && (
                <p className="muted empty-small">일치하는 문서가 없습니다.</p>
              )}
            </div>
          ) : (
            <FileTree notes={[...model.notes, ...documents]} active={active} onOpen={openNote} />
          )}
          <div className="structured-create-actions">
            <button disabled={busy} onClick={() => { setNewName("새 Canvas.canvas"); setModal("new"); }}>+ Canvas</button>
            <button disabled={busy} onClick={() => { setNewName("새 Bases.base"); setModal("new"); }}>+ Bases</button>
          </div>
          <div className="attachments-list">
            <div className="nav-section-title">
              <span>첨부파일</span>
              <button disabled={busy} onClick={chooseAttachments}>
                추가
              </button>
            </div>
            {(vault.attachments ?? []).map((file) => (
              <div className="attachment-row" key={file.path}>
                <button
                  title={file.path}
                  onClick={() => openAttachment(file.path)}
                >
                  {file.path.split("/").at(-1)}
                </button>
                <button
                  aria-label={`${file.path} 이동`}
                  disabled={busy}
                  onClick={() => prepareFile(file.path, "move")}
                >
                  이동
                </button>
                <button
                  aria-label={`${file.path} 삭제`}
                  disabled={busy}
                  onClick={() => prepareFile(file.path, "trash")}
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
          <button
            className="new-note-button"
            onClick={() => {
              setNewName("");
              setModal("new");
            }}
            disabled={busy}
          >
            <Plus size={16} />새 문서 만들기<span>{shortcut} N</span>
          </button>
          <div className="vault-footer">
            <ShieldCheck size={14} />
            <span>내 파일은 내 기기에</span>
            <span className="count">{raw.length}</span>
          </div>
        </aside>
        <main className="workspace">
          <div className="tabbar">
            <div className="tabs">
              {tabs.map((path) => (
                <div
                  className={`tab ${path === active && section !== "graph" ? "active" : ""}`}
                  key={path}
                >
                  <button className="tab-label" onClick={() => openNote(path)}>
                    <FileText size={13} />
                    <span>{path.split("/").at(-1).replace(/\.md$/i, "")}</span>
                  </button>
                  <button
                    className="tab-close"
                    aria-label={`${path} 탭 닫기`}
                    onClick={() => {
                      const next = tabs.filter((p) => p !== path);
                      setTabs(next);
                      if (active === path) setActive(next.at(-1) ?? null);
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              {section === "graph" && (
                <div className="tab active">
                  <Network size={14} />
                  문서 그래프
                </div>
              )}
            </div>
            <IconButton
              label="새 문서"
              onClick={() => {
                setNewName("");
                setModal("new");
              }}
            >
              <Plus size={16} />
            </IconButton>
          </div>
          <div className="document-toolbar">
            <div className="breadcrumbs">
              <Folder size={13} />
              <span>{vault.name}</span>
              <ChevronRight size={12} />
              <span>
                {section === "graph"
                  ? "문서 그래프"
                  : (active?.replace(/\.md$/i, "") ?? "문서 선택")}
              </span>
            </div>
            <div className="toolbar-actions">
              {section !== "graph" && (note || structured) && (
                <>
                  <button
                    className="text-action"
                    disabled={busy || !note}
                    onClick={chooseAttachments}
                  >
                    첨부
                  </button>
                  <button
                    className="text-action"
                    disabled={busy}
                    onClick={() =>
                      prepareFile(attachment?.path ?? structured?.path ?? note.path, "move")
                    }
                  >
                    이름·이동
                  </button>
                  <button
                    className="text-action"
                    disabled={busy}
                    onClick={() =>
                      prepareFile(attachment?.path ?? structured?.path ?? note.path, "trash")
                    }
                  >
                    휴지통
                  </button>
                  <button
                    className="text-action"
                    disabled={busy || !note}
                    onClick={() => {
                      setPropertiesDraft(parseMetadata(note.content).yaml);
                      setModal("properties");
                    }}
                  >
                    속성
                  </button>
                </>
              )}
              {section !== "graph" && !structured && (
                <div className="view-segments">
                  <IconButton
                    label="읽기 보기"
                    active={mode === "read"}
                    onClick={() => setMode("read")}
                  >
                    <BookOpen size={15} />
                  </IconButton>
                  <IconButton
                    label="편집 보기"
                    active={mode === "edit"}
                    onClick={() => setMode("edit")}
                  >
                    <PencilLine size={15} />
                  </IconButton>
                  <IconButton
                    label="분할 보기"
                    active={mode === "split"}
                    onClick={() => setMode("split")}
                  >
                    <SplitSquareHorizontal size={15} />
                  </IconButton>
                </div>
              )}
              <IconButton
                label="문서 정보 패널"
                active={right}
                onClick={() => setRight(!right)}
              >
                <PanelRight size={16} />
              </IconButton>
            </div>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              {status === "error" && (
                <button onClick={() => flush().catch(() => {})}>
                  저장 재시도
                </button>
              )}
              <button aria-label="알림 닫기" onClick={() => setError("")}>
                <X size={15} />
              </button>
            </div>
          )}
          <div className="document-area">
            {section === "graph" ? (
              <Graph
                notes={model.notes}
                edges={model.edges}
                active={active}
                onOpen={openNote}
              />
            ) : structured && !attachment ? (
              structured.kind === "canvas" ? <CanvasEditor key={`${vault.id}:${structured.path}`} document={structured}
                files={[...model.notes, ...documents, ...(vault.attachments ?? [])]} attachments={vault.attachments ?? []} vaultId={vault.id}
                onChange={(content) => changeFile(structured.path, content)} onOpen={openFile} onExternal={openExternal} onError={setError} readOnly={busy} />
                : <BasesView key={`${vault.id}:${structured.path}`} document={structured} notes={model.notes}
                  onChange={(content) => changeFile(structured.path, content)} onNoteChange={changeFile} onOpen={openFile} onError={setError} readOnly={busy} />
            ) : attachment ? (
              <div className="attachment-view">
                <div className="attachment-heading">
                  <strong>{attachment.path}</strong>
                  <button onClick={() => setAttachment(null)}>
                    문서로 돌아가기
                  </button>
                </div>
                {attachment.mime === "application/pdf" ? (
                  <PdfViewer key={attachment.path} bytes={attachment.bytes} />
                ) : (
                  <img
                    alt={attachment.path}
                    src={attachmentUrl(
                      attachment.path,
                      "",
                      vault.attachments ?? [],
                      vault.id,
                    )}
                  />
                )}
              </div>
            ) : note ? (
              <div className={`document-content ${mode}`}>
                <div className="document-topline">
                  <span className="document-icon">
                    <FileText size={23} strokeWidth={1.5} />
                  </span>
                  <span className="eyebrow">
                    {note.path.includes("/")
                      ? note.path.slice(0, note.path.lastIndexOf("/"))
                      : "MY KNOWLEDGE SPACE"}
                  </span>
                  <span className="document-local">
                    <span className="local-dot" />
                    로컬 문서
                  </span>
                </div>
                <div className="editor-preview">
                  {mode !== "read" && (
                    <Editor
                      key={note.path}
                      note={note}
                      notes={model.notes}
                      onChange={change}
                      onImportFiles={importFiles}
                      readOnly={busy}
                    />
                  )}
                  {mode !== "edit" && (
                    <DiagramPreview
                      previewRef={preview}
                      onClick={followLink}
                      html={html}
                    />
                  )}
                </div>
                {mode === "read" && (
                  <div className="document-bottom">
                    <Sparkles size={14} />
                    <span>작은 기록이 모여 더 큰 생각이 됩니다.</span>
                    <button onClick={() => setMode("edit")}>
                      <PencilLine size={13} />이 문서 편집
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="empty-workspace">
                <BookOpen size={40} />
                <h2>다음 생각을 기록해 보세요</h2>
                <p>왼쪽에서 문서를 열거나 새 문서를 만드세요.</p>
                <button
                  className="primary-button"
                  onClick={() => {
                    setNewName("");
                    setModal("new");
                  }}
                >
                  새 문서 만들기
                </button>
              </div>
            )}
          </div>
          <footer className="statusbar">
            <div
              className={`save-status ${status}`}
              onClick={() => flush().catch(() => {})}
            >
              {status === "saving" ? (
                <LoaderCircle size={13} className="spin" />
              ) : status === "saved" ? (
                <CheckCheck size={13} />
              ) : (
                <span className="status-dot" />
              )}
              <span>
                {status === "saved"
                  ? "모든 변경사항 저장됨"
                  : status === "saving"
                    ? "저장 중…"
                    : status === "error"
                      ? "초안 보관 중 · 저장 확인 필요"
                      : "변경사항 저장 대기 중"}
              </span>
            </div>
            <div>
              <span>{(note?.content.length ?? structured?.content.length ?? 0).toLocaleString()}자</span>
              <span>{structured?.kind ?? "Markdown"}</span>
              <span>UTF-8</span>
            </div>
          </footer>
        </main>
        {right && (
          <aside className="context-panel">
            <div className="context-tabs">
              <span className="selected">
                <List size={14} />
                문서 정보
              </span>
              <Link2 size={15} />
            </div>
            {note && (
              <section className="context-section">
                <div className="section-label">
                  <h3>속성</h3>
                  <button
                    onClick={() => {
                      setPropertiesDraft(parseMetadata(note.content).yaml);
                      setModal("properties");
                    }}
                  >
                    편집
                  </button>
                </div>
                {note.error && <p role="alert">{note.error}</p>}
                <dl className="property-list">
                  {Object.entries(note.properties ?? {}).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>
                        {typeof value === "object"
                          ? JSON.stringify(value)
                          : String(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
            <section className="context-section">
              <div className="section-label">
                <List size={14} />
                <h3>이 문서의 개요</h3>
              </div>
              <div className="outline">
                {note?.headings.map((h, i) => (
                  <button
                    key={i}
                    style={{ paddingLeft: 12 + Math.max(0, h.level - 1) * 12 }}
                    onClick={() => {
                      if (mode === "edit") setMode("read");
                      setTimeout(
                        () =>
                          [
                            ...(preview.current?.querySelectorAll(
                              "h1,h2,h3,h4,h5,h6",
                            ) ?? []),
                          ]
                            .find((node) => node.textContent === h.text)
                            ?.scrollIntoView({ behavior: "smooth" }),
                        30,
                      );
                    }}
                  >
                    {h.text}
                  </button>
                ))}
                {!note?.headings.length && (
                  <p className="muted">아직 제목이 없습니다.</p>
                )}
              </div>
            </section>
            <section className="context-section">
              <div className="section-label">
                <Link2 size={14} />
                <h3>이 문서를 가리키는 링크</h3>
                <span className="badge">{incoming.length}</span>
              </div>
              <p className="section-description">다른 문서에서 이어진 생각</p>
              {incoming.map((n) => (
                <button
                  className="related-note"
                  key={n.path}
                  onClick={() => openNote(n.path)}
                >
                  <FileText size={14} />
                  <div>
                    <strong>{n.title}</strong>
                    <span>
                      {n.path.split("/").slice(0, -1).join("/") || "내 문서"}
                    </span>
                  </div>
                  <ChevronRight size={13} />
                </button>
              ))}
              {!incoming.length && (
                <p className="muted empty-small">
                  아직 연결된 문서가 없습니다.
                </p>
              )}
            </section>
            <section className="context-section">
              <div className="section-label">
                <Network size={14} />
                <h3>연결된 문서</h3>
                <span className="badge">{outgoing.length}</span>
              </div>
              {outgoing.map((n) => (
                <button
                  className="outgoing-link"
                  key={n.path}
                  onClick={() => openNote(n.path)}
                >
                  <FileText size={13} />
                  {n.title}
                </button>
              ))}
            </section>
            {!!note && (
              <section className="context-section">
                <div className="section-label">
                  <h3>링크 없는 언급</h3>
                </div>
                {model.notes
                  .filter(
                    (n) =>
                      n.path !== active &&
                      !incoming.some((i) => i.path === n.path) &&
                      [note.title, ...note.aliases].some(
                        (name) => name.length > 1 && n.body.includes(name),
                      ),
                  )
                  .slice(0, 20)
                  .map((n) => (
                    <button
                      className="related-note"
                      key={n.path}
                      onClick={() => openNote(n.path)}
                    >
                      {n.title}
                    </button>
                  ))}
              </section>
            )}
            {!!note?.tags.length && (
              <section className="context-section">
                <div className="section-label">
                  <Hash size={14} />
                  <h3>태그</h3>
                </div>
                <div className="tags">
                  {note.tags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => {
                        setQuery("#" + tag);
                        setSection("search");
                      }}
                    >
                      #{tag}
                    </button>
                  ))}
                </div>
              </section>
            )}
            <div className="connection-card">
              <span className="connection-card-icon">
                <Network size={21} />
              </span>
              <strong>기록을 넘어, 연결로</strong>
              <p>
                문서들이 만드는 생각의 지도를
                <br />
                한눈에 살펴보세요.
              </p>
              <button onClick={() => setSection("graph")}>
                그래프 열기
                <ChevronRight size={14} />
              </button>
            </div>
          </aside>
        )}
      </div>
      {lastTrash && (
        <div className="undo-toast">
          휴지통으로 이동했습니다.{" "}
          <button
            disabled={busy || lastTrash.vaultId !== vault.id}
            onClick={restoreLast}
          >
            되돌리기
          </button>
          <button
            aria-label="휴지통 알림 닫기"
            onClick={() => setLastTrash(null)}
          >
            ×
          </button>
        </div>
      )}
      {(modal === "move" || modal === "trash") && (
        <Modal
          title={modal === "move" ? "파일 이름 변경·이동" : "휴지통으로 이동"}
          onClose={() => !busy && setModal(null)}
        >
          <form onSubmit={alterFile}>
            <p>{fileTarget?.path}</p>
            {error && (
              <p role="alert" className="error-banner">
                {error}
              </p>
            )}
            {modal === "move" ? (
              <>
                <label htmlFor="file-destination">보관함 안의 새 경로</label>
                <input
                  id="file-destination"
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <p className="muted">
                  확장자를 유지하세요. 연결 문서의 링크도 함께 갱신합니다.
                </p>
              </>
            ) : (
              <p>복구 가능한 사본을 보관합니다. 연결 문서의 링크는 남습니다.</p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => setModal(null)}
                disabled={busy}
              >
                취소
              </button>
              <button
                className="primary-button"
                disabled={busy || !newName.trim()}
              >
                {modal === "move" ? "이동·링크 갱신" : "휴지통으로 이동"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "properties" && (
        <Modal title="문서 속성" wide onClose={() => setModal(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                change(updateMetadata(note.content, propertiesDraft));
                setModal(null);
              } catch (err) {
                setError(err.message);
              }
            }}
          >
            {error && (
              <p role="alert" className="error-banner">
                {error}
              </p>
            )}
            <p className="muted">
              YAML 형식으로 tags, aliases, status, 날짜 등 문서 속성을
              편집합니다.
            </p>
            <textarea
              className="properties-editor"
              aria-label="YAML 속성"
              value={propertiesDraft}
              onChange={(e) => setPropertiesDraft(e.target.value)}
              placeholder={"tags: [시험]\naliases: [별칭]\nstatus: draft"}
            />
            <div className="modal-actions">
              <button className="primary-button">속성 적용</button>
            </div>
          </form>
        </Modal>
      )}
      {busy && (
        <div className="busy-indicator">
          <LoaderCircle size={15} className="spin" />
          처리 중…
        </div>
      )}
      {modal === "new" && (
        <Modal title="새로운 생각 기록하기" onClose={() => setModal(null)}>
          <form onSubmit={createNote}>
            <label htmlFor="new-note-name">문서 이름</label>
            <input
              id="new-note-name"
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="예: 오늘의 아이디어"
            />
            <p className="muted">
              폴더/문서 이름으로 입력하면 폴더도 함께 만듭니다. .canvas 또는 .base 확장자로 해당 문서를 만들 수 있습니다.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setModal(null)}
              >
                취소
              </button>
              <button
                className="primary-button"
                disabled={!newName.trim() || busy}
              >
                <Plus size={15} />
                문서 만들기
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "switch" && (
        <Modal title="문서로 이동" wide onClose={() => setModal(null)}>
          <div className="switch-input">
            <Search size={19} />
            <input
              autoFocus
              aria-label="빠른 문서 검색"
              value={switchQuery}
              onChange={(e) => setSwitchQuery(e.target.value)}
              placeholder="이름이나 내용으로 찾아보세요…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && switchResults[0])
                  openNote(switchResults[0].path);
              }}
            />
            <kbd>ESC</kbd>
          </div>
          <div className="switch-results">
            {switchResults.map((n) => (
              <button key={n.path} onClick={() => openNote(n.path)}>
                <FileText size={17} />
                <span>
                  <strong>{n.title}</strong>
                  <small>{n.path}</small>
                </span>
                {n.path === active && <Check size={15} />}
              </button>
            ))}
            {!switchResults.length && (
              <p className="empty-small muted">검색 결과가 없습니다.</p>
            )}
          </div>
          <div className="switch-footer">
            Enter로 첫 문서 열기<span>내 보관함 안에서만 검색합니다</span>
          </div>
        </Modal>
      )}
      {modal === "about" && (
        <Modal title="내 기록을 안전하게" onClose={() => setModal(null)}>
          <div className="about-icon">
            <ShieldCheck size={31} />
          </div>
          <p>
            문서는 내 기기의 일반 Markdown 파일로 저장됩니다. 변경 전 내용은
            별도의 복구 폴더에 남습니다.
          </p>
          <p>
            로컬 이미지·PDF를 지원합니다. 외부 이미지와 플러그인은 실행하지
            않습니다. 노트는 별도 Git 저장소로 관리하고, Git에서 가져온 뒤 문서
            새로고침을 사용하세요.
          </p>
          <button
            className="secondary-button"
            onClick={() =>
              invoke(api.showRecovery()).catch((err) => setError(err.message))
            }
          >
            <FolderOpen size={15} />
            복구 사본 폴더 열기
          </button>
          <div className="about-footer">
            Dynote {version} · 독립적으로 제작한 노트 앱
          </div>
        </Modal>
      )}
      {modal === "reload" && (
        <Modal title="디스크에서 다시 읽기" onClose={() => setModal(null)}>
          <p>
            저장하지 못한 초안이 있습니다. 필요한 내용을 먼저 복사해 주세요.
            다시 읽으면 현재 초안을 디스크의 내용으로 바꿉니다.
          </p>
          <div className="modal-actions">
            <button className="secondary-button" onClick={() => setModal(null)}>
              초안 유지
            </button>
            <button className="primary-button" onClick={reload}>
              디스크 내용으로 다시 읽기
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
