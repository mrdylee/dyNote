import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Box,
  Bookmark,
  CalendarDays,
  History,
  Terminal,
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
  MessageCircle,
  Network,
  PanelRight,
  PencilLine,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  SplitSquareHorizontal,
  X,
} from "lucide-react";
import {
  buildKnowledge,
  resolveLink,
  searchNotes,
  parseMetadata,
  updateMetadata,
  toggleTask,
  attachmentUrl,
} from "../core/knowledge.mjs";
import useVaultDocuments from "./useVaultDocuments.jsx";
import DocumentWorkspace from "./DocumentWorkspace.jsx";
import useDocumentWorkspace from "./useDocumentWorkspace.jsx";
import JournalFeed from "./JournalFeed.jsx";
import CopilotJournalEntries,{CopilotJournalToolbar} from "./CopilotJournalEntries.jsx";
import CopilotJournalSettings from "./CopilotJournalSettings.jsx";
import ClassificationReview from "./ClassificationReview.jsx";
import { classificationSuggestions } from "../core/journal-sections.mjs";
import { DOCUMENT_DRAG, documentKey, documentRef, spaceLabel } from "../core/document-workspace.mjs";
import { FILE_TREE_DRAG, protectedTreeFolders, canTrashFolder } from "../core/file-tree.mjs";
import { journalPreferences as defaultJournalPreferences } from "../core/journal-start.mjs";
import Graph from "./Graph.jsx";
import PdfViewer from "./PdfViewer.jsx";
import CanvasEditor from "./CanvasEditor.jsx";
import BasesView from "./BasesView.jsx";
import { documentKind } from "../core/documents.mjs";
import { version } from "../package.json";
import { STICKY_SHORTCUT } from "../core/sticky-layout.mjs";
import PanelResize from "./PanelResize.jsx";
import { normalizePanelWidths, fitPanelWidths } from "../core/panel-widths.mjs";
import FontSettings from "./FontSettings.jsx";
import GitSettings from "./GitSettings.jsx";
import VaultSettings from "./VaultSettings.jsx";
import GitHistory from "./GitHistory.jsx";
import GitWorkspace from "./GitWorkspace.jsx";
import UpdateSettings from "./UpdateSettings.jsx";
import CopilotPanel from "./CopilotPanel.jsx";
import useAiSession from "./useAiSession.jsx";
import useCopilotEdits from "./useCopilotEdits.jsx";
import { overlayNotes } from "./copilotEdits.mjs";
import { applyProposal } from "../core/copilot.mjs";
import { isolateHistory } from "@codemirror/commands";
import { normalizeFonts, fontVariables } from "../core/font-preferences.mjs";
import "katex/dist/katex.min.css";
import JournalPanel from "./JournalPanel.jsx";
import NavigationPanel from "./NavigationPanel.jsx";
import PluginSettings from "./PluginSettings.jsx";
import { normalizeNavigation, navigationAction, reconcileNavigation } from "../core/navigation.mjs";
import { periods, periodicNote, periodicContent, periodicEntries, adjacentEntry, renderTemplate, localDate } from "../core/periodic-notes.mjs";
import { timestampInsertion, rateJournal, onThisDay, wordStatistics } from "../core/journal-details.mjs";
import { runOutlineCommand } from "./editorCommands.mjs";
import { diagramInsertion } from "../core/diagram-tools.mjs";
import MermaidTools from "./MermaidTools.jsx";
import MindmapEditor from "./MindmapEditor.jsx";
import AudioRecorder from "./AudioRecorder.jsx";
import AudioViewer from "./AudioViewer.jsx";
import ComposerDialog from "./ComposerDialog.jsx";
import NoteHover from "./NoteHover.jsx";
import { convertMindmap } from "../core/mindmap.mjs";
import { pdfBacklinks } from "../core/pdf-links.mjs";
import Planner from "./Planner.jsx";
import { BOARD_PATH } from "../core/planner.mjs";
import EssViewer from "./EssViewer.jsx";
import { noteEssLinks, setEssLink, validEssTarget } from "../core/ess-links.mjs";

const api = window.notes && Object.fromEntries(Object.entries(window.notes).map(([name, method]) => [
  name, (input, ...rest) => method(input?.vaultId ? { ...input, workspace: true } : input, ...rest),
]));
const emptyFiles = [];
const emptyNavigation = normalizeNavigation(null);
const emptyModel = buildKnowledge(emptyFiles);
const checkingGit = { phase: "off", message: "Git 설정 확인 중…", enabled: false, config: null };
const invoke = async (result) => {
  const response = await result;
  if (!response.ok) throw new Error(response.error);
  return response.value;
};
const isMac = navigator.platform.includes("Mac");
const shortcut = isMac ? "⌘" : "Ctrl";
const stored = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const persist = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Remain usable during this session. */ } };

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

function FileTree({ notes, folders, active, reveal, onOpen, onContext, onDragDocument, onDragEnd, onCopyPointer, dropProps, disabled }) {
  const [closed, setClosed] = useState(new Set());
  useEffect(() => {
    if (!reveal?.folder) return;
    setClosed(old => {
      if (!old.has(reveal.folder)) return old;
      const next = new Set(old);
      next.delete(reveal.folder);
      return next;
    });
  }, [reveal]);
  const tree = Object.create(null);
  const children = parts => {
    let cursor = tree;
    for (const part of parts)
      cursor = (cursor[part] ??= { children: Object.create(null) }).children;
    return cursor;
  };
  for (const folder of folders) children(folder.split("/"));
  for (const note of notes) {
    const parts = note.path.split("/");
    children(parts.slice(0, -1))[parts.at(-1)] = { note };
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
              onClick={event => { if (!isMac || !event.ctrlKey) onOpen(path); }}
              onContextMenu={event => { event.preventDefault(); onContext(event, {path, folder:false}); }}
              onPointerDown={event => onCopyPointer(event, path)}
              title={path}
              disabled={disabled}
              draggable={!disabled}
              onDragStart={event => onDragDocument(event, path)}
              onDragEnd={onDragEnd}
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
              title={path}
              {...dropProps(path)}
              onContextMenu={event => { event.preventDefault(); onContext(event, {path, folder:true}); }}
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

function Modal({ title, children, onClose, wide = false, className = "" }) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={`modal ${wide ? "wide" : ""} ${className}`}
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
  const aiSession = useAiSession(api);
  const [fonts, setFonts] = useState(() => {
    try { return normalizeFonts(JSON.parse(localStorage.getItem("dynote.fonts"))); } catch { return normalizeFonts(null); }
  });
  useEffect(() => {
    for (const [key, value] of Object.entries(fontVariables(fonts))) document.documentElement.style.setProperty(key, value);
    try { localStorage.setItem("dynote.fonts", JSON.stringify(fonts)); } catch { /* Preferences still apply for this session. */ }
  }, [fonts]);
  const { vaults, current: vaultsRef, revisionMap, update: updateVault, remove: removeVault, queue, install: installVault } = useVaultDocuments(api, invoke);
  const [selectedVaultId, setSelectedVaultId] = useState(null);
  const selectedVault = useRef(null);
  const workspace = useDocumentWorkspace();
  const [section, setSection] = useState("files");
  const [journalScopeId, setJournalScopeId] = useState(null);
  const [spaces, setSpaces] = useState({ entries: [] });
  const personalSpace = spaces.entries.find(entry => entry.purpose === "personal");
  const together = !!personalSpace && spaces.entries.some(entry => entry.purpose === "team");
  const registryReady = !!spaces.current && vaults[selectedVaultId]?.root === spaces.current;
  const dailyRoot = registryReady ? together ? personalSpace.root : spaces.current : null;
  const dailyVaultId = dailyRoot && Object.values(vaults).find(scope => scope.root === dailyRoot)?.id;
  const showCalendar = section === "journal" && (!together || journalScopeId !== null);
  const { vaultId: focusedVaultId, path: focusedPath } = documentRef(workspace.active, selectedVaultId);
  const [openedAttachment, setAttachment] = useState(null);
  const attachment = vaults[openedAttachment?.vaultId] ? openedAttachment : null;
  const attachmentRequest = useRef(0);
  const journalScope = section === "journal" ? vaults[journalScopeId ?? dailyVaultId] : null;
  const vault = journalScope ?? vaults[attachment?.vaultId ?? focusedVaultId] ?? vaults[selectedVaultId];
  const active = vault?.id === focusedVaultId ? focusedPath : null;
  const currentVault = useRef(null);
  currentVault.current = vault?.id;
  const { mode, setMode } = workspace;
  const [spaceFilter, setSpaceFilter] = useState("all");
  const [spaceWarnings, setSpaceWarnings] = useState([]);
  const spaceLoad = useRef(0);
  const space = vault?.root ? vault : null;
  const raw = vault?.notes ?? emptyFiles;
  const documents = vault?.documents ?? emptyFiles;
  const setVault = transform => updateVault(vault.id, old => old && transform(old));
  const setRaw = transform => updateVault(vault.id, old => old && ({ ...old, notes: transform(old.notes) }));
  const setDocuments = transform => updateVault(vault.id, old => old && ({ ...old, documents: transform(old.documents) }));
  const revisions = { current: revisionMap(vault?.id) };
  const [updateState,setUpdateState]=useState(null);
  const [dismissedUpdate,setDismissedUpdate]=useState(null);
  useEffect(()=>{
    if(!api?.updateState)return;
    let mounted=true;
    const update=value=>{if(mounted)setUpdateState(value);};
    const unsubscribe=api.onUpdateStatus(update);
    invoke(api.updateState()).then(async value=>{
      update(value);
      const beta=stored("dynote.updates.beta",null),ignored=stored("dynote.updates.ignored",null);
      if(beta!==null||ignored!==null){
        const migrated=await invoke(api.updateSettings({includePrerelease:beta===null?value.preferences.includePrerelease:beta===true,ignored:[...new Set([...value.preferences.ignored,...(Array.isArray(ignored)?ignored:[])])]}));
        update(migrated);
        try{localStorage.removeItem("dynote.updates.beta");localStorage.removeItem("dynote.updates.ignored");}catch{}
      }
    }).catch(()=>{});
    return()=>{mounted=false;unsubscribe();};
  },[]);
  const [startup, setStartup] = useState(() => stored("dynote.startup", "journal"));
  const [tabs, setTabs] = useState([]);
  const [today, setToday] = useState(localDate);
  const [checkedJournal, setCheckedJournal] = useState(null);
  const completedJournal = useRef(null);
  const dailyKey = dailyVaultId && documentKey(dailyVaultId, today);
  const [essOpened, setEssOpened] = useState(false);
  const [essTarget, setEssTarget] = useState(null);
  const [editorJump, updateEditorJump] = useState(null);
  const setEditorJump = (jump, id = vault?.id) => updateEditorJump(jump && { ...jump, vaultId: id });
  const [query, setQuery] = useState("");
  const [right, setRight] = useState(true);
  const [panelWidths, setPanelWidths] = useState(() => normalizePanelWidths(stored("dynote.panelWidths", null)));
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  useEffect(() => { persist("dynote.panelWidths", panelWidths); }, [panelWidths]);
  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const rightVisible = right && section !== "ess";
  const panelLayout = fitPanelWidths(panelWidths, viewportWidth, rightVisible);
  const panelBudget = Math.max(1000, viewportWidth) - 64 - 360 - (rightVisible ? 10 : 5);
  const resizePanel = side => width => setPanelWidths(old => normalizePanelWidths({ ...old, [side]: width }));
  const [rightTab, setRightTab] = useState("copilot");
  const [editorSelection, setEditorSelection] = useState(null);
  const editorView = useRef(null);
  const [status, setStatus] = useState("saved");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const audioActive = useRef(false);
  const [audioNotice, setAudioNotice] = useState("");
  const [webUrl, setWebUrl] = useState("");
  const [compositionRecovery, setCompositionRecovery] = useState(null);
  const [hover, setHover] = useState(null);
  const hoverTimer = useRef(null), hoverClose = useRef(null), hoverAnchor = useRef(null);
  const [modal, setModal] = useState(null);
  useEffect(() => {
    clearTimeout(hoverTimer.current); clearTimeout(hoverClose.current); hoverAnchor.current = null; setHover(null);
    return () => { clearTimeout(hoverTimer.current); clearTimeout(hoverClose.current); };
  }, [active, vault?.id, modal]);
  const [settingsTab, setSettingsTab] = useState("vault");
  const [gitSettingsId, setGitSettingsId] = useState(null);
  const gitVault = vaults[gitSettingsId] ?? vault;
  useEffect(() => { if (modal !== "settings") setGitSettingsId(null); }, [modal]);
  const [selectedPluginData, setPluginData] = useState({ entries: [] });
  const pluginData = vault?.id === selectedVaultId ? selectedPluginData : { entries: [] };
  useEffect(() => {
    setPluginData({ entries: [] });
    if (!selectedVaultId || !api?.plugins) return;
    let mounted = true;
    const update = value => { if (mounted && value.vaultId === selectedVault.current) setPluginData(value); };
    const unsubscribe = api.onPluginStatus(update);
    invoke(api.plugins({ vaultId: selectedVaultId })).then(update).catch(error => { if (mounted) setPluginData({ entries: [], error: error.message }); });
    return () => { mounted = false; unsubscribe(); };
  }, [selectedVaultId]);
  useEffect(() => api?.onOpenSettings(tab => { if (audioActive.current) setAudioNotice("녹음을 저장하거나 취소한 뒤 이동해 주세요."); else if (!busy) { if (tab === "fonts") setSettingsTab("fonts"); setModal("settings"); } }), [busy]);
  const [newName, setNewName] = useState("");
  const [switchQuery, setSwitchQuery] = useState("");
  const [commandQuery, setCommandQuery] = useState("");
  const [commandIndex, setCommandIndex] = useState(0);
  const [editorCommand, updateEditorCommand] = useState(null);
  const setEditorCommand = command => updateEditorCommand(command && { ...command, vaultId: vault?.id });
  const [historyDate, setHistoryDate] = useState(localDate);
  useEffect(() => {
    if (!editorCommand) return;
    if (editorCommand.path !== active || editorCommand.vaultId !== vault?.id) { updateEditorCommand(null); return; }
    const view = editorView.current;
    if (!view) return;
    if (editorCommand.type === "focus-end") {
      if (busy || view.state.readOnly) return;
      view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true });
      view.focus();
    } else if (editorCommand.type === "timestamp" && !view.state.readOnly) {
      const cursor = editorCommand.atEnd ? view.state.doc.length : view.state.selection.main.head;
      const date = periodicEntries([{ path: active }], "daily", { ...journalPreferences.daily, locale: journalPreferences.locale })[0]?.date;
      const edit = timestampInsertion(view.state.doc.toString(), cursor, date, new Date(editorCommand.now), journalPreferences);
      view.dispatch({ changes: { from: cursor, insert: edit.insert }, selection: { anchor: edit.anchor }, annotations: isolateHistory.of("full"), scrollIntoView: true });
      view.focus();
    } else if (editorCommand.type !== "timestamp") runOutlineCommand(view, editorCommand.action);
    updateEditorCommand(null);
  }, [editorCommand, mode, active, busy, vault?.id]);
  const navigation = vault?.navigation ?? emptyNavigation;
  const journalPreferences = vault?.journalPreferences ?? {};
  const [captureStates, setCaptureStates] = useState({});
  const [automaticCaptureId, setAutomaticCaptureId] = useState(null);
  const captureLocked = !!vault?.id && automaticCaptureId === vault.id;
  const captureState = captureStates[vault?.id] ?? null;
  const captureContext=useRef(null),captureWorking=useRef(false);
  const [fileTarget, setFileTarget] = useState(null);
  const treeDrag = useRef(null);
  const macCopyDrag = useRef(null);
  const [treeDrop, setTreeDrop] = useState(null);
  const [treeReveal, setTreeReveal] = useState(null);
  const [crossCopy, setCrossCopy] = useState(null);
  const [classificationHelpDismissed, setClassificationHelpDismissed] = useState(false);
  const classificationHelpRef = useRef(null);
  useEffect(() => {
    const dismiss = event => {
      if (event.key === 'Escape' && classificationHelpRef.current?.matches(':not(.help-dismissed):is(:hover, :focus-within)')) {
        event.preventDefault(); event.stopPropagation(); setClassificationHelpDismissed(true);
      }
    };
    document.addEventListener('keydown', dismiss);
    return () => document.removeEventListener('keydown', dismiss);
  }, []);
  const [treeMenu, setTreeMenu] = useState(null);
  const treeMenuRef = useRef(null);
  useEffect(() => {
    if (!treeMenu) return;
    treeMenuRef.current?.querySelector('button')?.focus();
    const outside = event => { if (!treeMenuRef.current?.contains(event.target)) setTreeMenu(null); };
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); setTreeMenu(null); treeMenu.origin?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [treeMenu]);
  const [propertiesDraft, setPropertiesDraft] = useState("");
  const [lastTrash, setLastTrash] = useState(null);
  const [gitStates, setGitStates] = useState({});
  const gitStatus = gitStates[vault?.id] ?? checkingGit;
  const gitSettingsStatus = gitStates[gitVault?.id] ?? checkingGit;
  const acceptGitStatus = useCallback(value => {
    if (value?.vaultId) setGitStates(old => ({ ...old, [value.vaultId]: value }));
  }, []);
  useEffect(() => api?.onGitStatus(acceptGitStatus), [acceptGitStatus]);
  useEffect(() => {
    if (!vault?.id) return;
    const id = vault.id;
    let mounted = true;
    invoke(api.gitStatus({ vaultId: id })).then(value => {
      if (mounted) acceptGitStatus(value);
    }).catch(error => {
      if (mounted) acceptGitStatus({ vaultId: id, phase: "error", message: error.message, enabled: false, config: null });
    });
    return () => { mounted = false; };
  }, [vault?.id, acceptGitStatus]);
  const timer = useRef(null);
  const preview = useRef(null);
  const editState = useCopilotEdits({ api, vaults, onError: setError,
    onOpen: (id, path) => {
      const key = documentKey(id, path);
      if (currentVault.current === id) {
        openNote(path, id);
        workspace.dispatch({ type: "mode", path: key, mode: "edit" });
      } else setTabs(old => old.includes(key) ? old : [...old, key]);
    },
    onSaved: (id, saved, removedPath) => {
      for (const item of saved) revisionMap(id).set(item.path, item.revision);
      updateVault(id, old => old && ({ ...old, notes: [...old.notes.filter(n => n.path !== removedPath && !saved.some(item => item.path === n.path)), ...saved] }));
    },
  });
  const edits = editState.forVault(vault?.id);
  const editsRef = useRef(editState); editsRef.current = editState;
  const knowledge = useRef(new Map());
  const models = useMemo(() => new Map(Object.values(vaults).map(scope => {
    const drafts = editState.drafts[scope.id] ?? emptyFiles;
    const cached = knowledge.current.get(scope.id);
    const model = cached?.notes === scope.notes && cached.drafts === drafts ? cached.model
      : buildKnowledge(overlayNotes(scope.notes, drafts));
    knowledge.current.set(scope.id, { notes: scope.notes, drafts, model });
    return [scope.id, model];
  })), [vaults, editState.drafts]);
  const model = models.get(vault?.id) ?? emptyModel;
  const pendingEdit = edits.drafts.find(draft => draft.path === active);
  const chatPaths = useRef(new Map());
  const note = section === "journal" || attachment ? null : model.notes.find(n => n.path === active);
  if (note) chatPaths.current.set(vault.id, note.path);
  const attachmentBacklinks = useMemo(() => attachment?.mime === "application/pdf" ? pdfBacklinks(model.notes, attachment.path, vault?.attachments ?? []) : [], [model, attachment?.path, attachment?.mime, vault?.attachments]);
  const structured = section === "journal" || attachment ? null : documents.find(d => d.path === active);
  const journalPaths = useMemo(() => new Map(Object.values(vaults).map(scope => [
    scope.id, new Set(periodicEntries(models.get(scope.id).notes, "daily", { ...scope.journalPreferences?.daily, locale: scope.journalPreferences?.locale }).map(n => n.path)),
  ])), [models, vaults]);
  const journalNote = note && journalPaths.get(vault.id)?.has(note.path);
  const classification = useMemo(()=>journalNote && status === "saved" ? classificationSuggestions(note,model.notes) : [],[journalNote,note,model.notes,status]);
  const statistics = useMemo(() => wordStatistics(note?.content ?? ""), [note?.content]);
  const filter = spaceFilter === "personal" || vaults[spaceFilter] ? spaceFilter : "all";
  const connectedSpaces = Object.values(vaults).filter(scope => scope.id).sort((a, b) =>
    Number(b.purpose === "personal") - Number(a.purpose === "personal") || a.name.localeCompare(b.name, "ko"));
  const captureVault = vault?.purpose === "personal" ? vault :
    connectedSpaces.find(scope => scope.id === selectedVaultId && scope.purpose === "personal") ??
    connectedSpaces.find(scope => scope.purpose === "personal");
  const captureVaultId = captureVault?.id;
  const captureTargetState = captureStates[captureVaultId] ?? null;
  const visibleSpaces = connectedSpaces.filter(scope => together
    ? (filter === "all" || scope.id === filter || (filter === "personal" && scope.purpose === "personal"))
    : scope.id === vault?.id);
  const searchAcross = query => searchNotes(visibleSpaces.flatMap(scope => models.get(scope.id).notes.map(note => ({
    ...note, vaultId: scope.id, key: documentKey(scope.id, note.path), scopeLabel: spaceLabel(scope),
  }))), query);
  const results = section === "search" ? searchAcross(query) : emptyFiles;
  const switchResults = modal === "switch" ? searchAcross(switchQuery).slice(0, 9) : emptyFiles;

  const reconcileScope = useCallback((id, paths) => {
    const keys = paths.map(path => documentKey(id, path));
    const available = new Set(keys);
    workspace.dispatch({ type: "reconcile-vault", vaultId: id, paths: keys });
    setTabs(old => old.filter(key => documentRef(key).vaultId !== id || available.has(key)));
  }, [workspace.dispatch]);
  const acceptSnapshot = useCallback((snapshot, metadata = {}) => {
    const paths = [...snapshot.notes, ...(snapshot.documents ?? [])].map(n => n.path);
    const navigation = reconcileNavigation(stored(`dynote.navigation.${snapshot.id}`, null), paths);
    persist(`dynote.navigation.${snapshot.id}`, navigation);
    installVault({
      ...snapshot, ...metadata, navigation,
      journalPreferences: defaultJournalPreferences(stored(`dynote.journal.${snapshot.id}`, null), snapshot.notes),
    });
    reconcileScope(snapshot.id, paths);
    return navigation;
  }, [installVault, reconcileScope]);
  const install = useCallback((snapshot, select = false) => {
    const changedVault = select && selectedVault.current !== snapshot.id;
    const navigation = acceptSnapshot(snapshot);
    if (!snapshot.id) { setSettingsTab("vault"); setModal("settings"); }
    if (select) {
      selectedVault.current = snapshot.id;
      setSelectedVaultId(snapshot.id);
    }
    if (changedVault) {
      setEssOpened(false);
      setEssTarget(null);
      setJournalScopeId(null);
      const startPath = navigation.recent[0] ?? snapshot.notes.find(n => n.path === "시작하기.md")?.path
        ?? snapshot.notes[0]?.path ?? snapshot.documents?.[0]?.path ?? null;
      const key = documentKey(snapshot.id, startPath);
      workspace.dispatch({ type: "reset", path: key });
      setTabs(key ? [key] : []);
      setSection(stored("dynote.startup", "journal") === "journal" ? "journal" : "files");
    }
    if (select || currentVault.current === snapshot.id) {
      setEditorSelection(null);
      attachmentRequest.current++;
      setAttachment(null);
      setError(snapshot.warnings.join(" · "));
    }
    if (!queue.dirty) setStatus("saved");
  }, [acceptSnapshot, queue, workspace.dispatch]);
  const loadSpaces = useCallback(async ({ refresh = false } = {}) => {
    const selectedId = selectedVault.current;
    const load = ++spaceLoad.current;
    const data = await invoke(api.vaults());
    if (selectedId !== selectedVault.current || load !== spaceLoad.current) return data;
    const primary = data.entries.find(entry => entry.root === data.current);
    if (primary) updateVault(selectedId, old => old && ({ ...old, root: primary.root, purpose: primary.purpose }));
    setSpaces(data);
    const entries = await invoke(api.workspaceSnapshots());
    if (selectedId !== selectedVault.current || load !== spaceLoad.current) return data;
    const roots = new Set(entries.map(entry => entry.root));
    for (const scope of Object.values(vaultsRef.current)) {
      if (scope.id === selectedId || roots.has(scope.root)) continue;
      reconcileScope(scope.id, []);
      removeVault(scope.id);
      setAttachment(old => old?.vaultId === scope.id ? null : old);
    }
    for (const { root, purpose, snapshot } of entries) {
      if (!snapshot) continue;
      if (!refresh && vaultsRef.current[snapshot.id]) updateVault(snapshot.id, old => ({ ...old, root, purpose }));
      else acceptSnapshot(snapshot, { root, purpose });
    }
    setSpaceWarnings(entries.filter(entry => entry.error).map(entry => `${spaceLabel(entry)} · ${entry.error}`));
    return data;
  }, [acceptSnapshot, reconcileScope, removeVault, updateVault, vaultsRef]);
  useEffect(() => {
    if (api?.vaults && selectedVaultId) loadSpaces().catch(error => setError(error.message));
  }, [selectedVaultId, loadSpaces]);

  useEffect(() => {
    let current = true, checking = false;
    const check = async () => {
      const date = localDate();
      setToday(date);
      const key = documentKey(dailyVaultId, date);
      if (!key || busy || automaticCaptureId === dailyVaultId || checking || completedJournal.current === key) return;
      checking = true;
      try {
        const scope = vaultsRef.current[dailyVaultId];
        const preferences = scope.journalPreferences;
        const target = periodicNote("daily", date, { ...preferences.daily, locale: preferences.locale });
        if (!scope.notes.some(note => note.path === target.path)) {
          const content = periodicContent(target, preferences, scope.notes);
          // Keep the draft editor read-only until this file has a revision.
          setCheckedJournal(null);
          const saved = await invoke(api.openOrCreateNote({ vaultId: dailyVaultId, path: target.path, content }));
          updateVault(dailyVaultId, old => {
            if (!old || old.notes.some(note => note.path === saved.path)) return old;
            revisionMap(dailyVaultId).set(saved.path, saved.revision);
            return { ...old, notes: [...old.notes, saved] };
          });
        }
        if (current) completedJournal.current = key;
      } catch (error) {
        if (current) setError(`오늘의 저널 · ${error.message}`);
      } finally {
        checking = false;
        if (current) setCheckedJournal(key);
      }
    };
    check();
    const timer = setInterval(check, 30000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      current = false;
      clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [dailyVaultId, busy, automaticCaptureId, vaultsRef, revisionMap, updateVault]);

  const flush = useCallback(async (allowDrafts = false) => {
    if (!allowDrafts && editsRef.current.blocked()) throw new Error("Copilot 변경을 먼저 유지하거나 되돌려 주세요.");
    clearTimeout(timer.current);
    if (!queue.dirty) return;
    setStatus("saving");
    try {
      await queue.flush();
      setStatus(queue.dirty ? "dirty" : "saved");
      setError("");
    } catch (err) {
      setStatus("error");
      setError(err.message);
      throw err;
    }
  }, [queue]);

  useEffect(() => {
    if (!api) {
      setError(
        "데스크톱 앱에서 열어 주세요. 먼저 빌드한 뒤 앱을 실행할 수 있습니다.",
      );
      return;
    }
    invoke(api.snapshot())
      .then(snapshot => install(snapshot, true))
      .catch((err) => setError(err.message));
    return api.onBeforeClose(async ({ id, mode }) => {
      try {
        if (audioActive.current) {
          setAudioNotice("녹음을 저장하거나 취소한 뒤 닫아 주세요.");
          api.confirmClose(id, false);
          return;
        }
        if (mode === "quit") await editsRef.current.close();
        await flush(true);
        api.confirmClose(id, true);
      } catch {
        api.confirmClose(id, false);
      }
    });
  }, [install, flush]);

  captureContext.current = { busy, modal, states: captureStates };
  const updateCaptureState = useCallback((id, transform) => {
    setCaptureStates(old => ({ ...old, [id]: transform(old[id]) }));
  }, []);
  const captureAction = useCallback(async (action, manual, args, id) => {
    const context = captureContext.current;
    const scope = vaultsRef.current[id];
    const state = context.states[id];
    if (!scope?.id || captureWorking.current || context.busy) return;
    const automatic = action === "sync" && !manual;
    if (automatic && (context.modal || scope.purpose !== "personal" || !state?.enabled || !state.personal || queue.dirtyIn(id) || editsRef.current.blocked(id))) return;
    captureWorking.current = true;
    if (automatic) setAutomaticCaptureId(id);
    else setBusy(true);
    try {
      if (!automatic) await flush();
      const request = { vaultId: id, ...args };
      const dailyOptions = { ...scope.journalPreferences.daily, locale: scope.journalPreferences.locale };
      const result = await invoke(action === "trash" ? api.trashCapture(request) : action === "restore"
        ? api.restoreCapture(request) : api.syncCapture({ ...request, dailyOptions, manual }));
      if (!vaultsRef.current[id]) return;
      updateCaptureState(id, () => result.status);
      if (result.snapshot) acceptSnapshot(result.snapshot);
    } catch (error) {
      updateCaptureState(id, old => ({ ...old, error: error.message }));
      if (manual) throw error;
    } finally {
      captureWorking.current = false;
      if (automatic) setAutomaticCaptureId(null);
      else setBusy(false);
    }
  }, [flush, acceptSnapshot, queue, updateCaptureState, vaultsRef]);
  const captureIds = Object.values(vaults).filter(scope => scope.id).map(scope => `${scope.id}:${scope.purpose ?? ""}`).sort().join(",");
  useEffect(() => {
    if (!api?.captureStatus || !captureIds) return;
    let alive = true;
    const ids = captureIds.split(",").map(key => key.split(":")[0]);
    for (const id of ids) invoke(api.captureStatus({ vaultId: id })).then(state => {
      if (alive) updateCaptureState(id, () => state);
    }).catch(error => {
      if (alive) updateCaptureState(id, () => ({ enabled: false, projects: [], records: [], error: error.message }));
    });
    let next = 0;
    const timer = setInterval(() => {
      const enabled = ids.filter(id => {
        const state = captureContext.current.states[id];
        return state?.personal && state.enabled;
      });
      if (enabled.length) captureAction("sync", false, {}, enabled[next++ % enabled.length]);
    }, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [captureIds, captureAction, updateCaptureState]);
  const captureSettings = () => { setSettingsTab("capture"); setModal("settings"); };
  const importCapture = async () => {
    if (!captureTargetState?.personal || !captureTargetState.projects.some(project => project.selected)) { captureSettings(); return; }
    await captureAction("sync", true, {}, captureVaultId);
  };
  const captureControls = { state: captureState, onImport: () => importCapture().catch(error => setError(error.message)), onSettings: captureSettings,
    onRestore: () => captureAction("restore", true, { trashId: captureState.trashId }, vault.id).catch(error => setError(error.message)),
    onTrash: (id, sessionId) => captureAction("trash", true, { id, sessionId }, vault.id).catch(error => setError(error.message)) };

  const updateNavigation = useCallback((action, id) => {
    const scope = vaultsRef.current[id];
    if (!scope) return;
    const navigation = navigationAction(scope.navigation, action);
    updateVault(id, old => ({ ...old, navigation }));
    persist(`dynote.navigation.${id}`, navigation);
  }, [updateVault, vaultsRef]);
  const openNote = useCallback((path, id = vault?.id) => {
    const key = documentKey(id, path);
    if (!key || !vaultsRef.current[id]) return;
    updateNavigation({ type: "visit", path }, id);
    workspace.setActive(key);
    updateEditorJump(null);
    attachmentRequest.current++;
    setAttachment(null);
    setTabs(old => old.includes(key) ? old : [...old, key]);
    setSection(old => (["graph", "planner", "ess", "journal"].includes(old) ? "files" : old));
    setModal(null);
  }, [vault?.id, vaultsRef, updateNavigation, workspace.setActive]);
  const openWorkspaceKey = key => {
    const target = documentRef(key, vault?.id);
    openNote(target.path, target.vaultId);
  };
  const addPane = (key, side = "right", anchor = workspace.active) => {
    const anchorScope = documentRef(anchor, vault?.id).vaultId;
    const target = documentRef(key, anchorScope);
    const scopedKey = documentKey(target.vaultId, target.path);
    if (busy || !models.get(target.vaultId)?.notes.some(note => note.path === target.path)) return;
    if (workspace.paths.length >= 3 && !workspace.paths.includes(scopedKey)) { setError("최대 3개 문서까지 비교할 수 있습니다."); return; }
    workspace.dispatch({ type: "add", path: scopedKey, side, anchor });
    updateNavigation({ type: "visit", path: target.path }, target.vaultId);
    setTabs(old => old.includes(scopedKey) ? old : [...old, scopedKey]);
    setEditorJump(null);
    attachmentRequest.current++;
    setSection("files"); setAttachment(null);
  };

  const openEss = (target) => {
    if (validEssTarget(target)) setEssTarget(target);
    setEssOpened(true); setSection("ess"); setModal(null);
  };
  const linkEssNote = async (path, target, linked, expectedRevision) => {
    const vaultId=vault.id;
    setBusy(true);
    try {
      await flush();
      if(currentVault.current!==vaultId)throw new Error("보관함이 변경되었습니다.");
      if(revisions.current.get(path)!==expectedRevision)throw new Error("문서가 변경되었습니다. 다시 연결해 주세요.");
      const current=raw.find(n=>n.path===path);
      if(!current)throw new Error("연결할 문서를 찾을 수 없습니다.");
      const content=setEssLink(current.content,target,linked);
      const saved=await invoke(api.saveNote({vaultId,path,content,revision:expectedRevision}));
      if(currentVault.current!==vaultId)return;
      revisions.current.set(path,saved.revision);
      setRaw(old=>old.map(n=>n.path===path?{...saved,content}:n));
    } finally {setBusy(false);}
  };

  useEffect(() => {
    if (!api?.onPluginOpen) return;
    return api.onPluginOpen(async value => {
      const id = value.vaultId;
      if (id !== selectedVault.current) return;
      try {
        await flush();
        if (value.created) {
          const snapshot = await invoke(api.snapshot({ vaultId: id }));
          if (id !== selectedVault.current) return;
          const created = snapshot.notes.find(note => note.path === value.path);
          if (created) {
            revisionMap(id).set(created.path, created.revision);
            updateVault(id, old => old && ({ ...old, notes: [...old.notes.filter(note => note.path !== created.path), created] }));
          }
        }
        if (id === selectedVault.current) openNote(value.path, id);
      } catch (error) { setError(error.message); }
    });
  }, [flush, openNote, revisionMap, updateVault]);
  useEffect(() => api?.onStickySaved(({ vaultId, note }) => {
    if (queue.get(vaultId, note.path)) return;
    updateVault(vaultId, old => {
      if (!old) return old;
      revisionMap(vaultId).set(note.path, note.revision);
      return { ...old, notes: [...old.notes.filter(item => item.path !== note.path), note] };
    });
  }), [queue, revisionMap, updateVault]);
  const hasOriginalPlugins = pluginData.entries.some(entry => entry.phase === "loaded");
  useEffect(() => {
    if (!api?.pluginContext || !vault?.id || !hasOriginalPlugins) return;
    invoke(api.pluginContext({ vaultId: vault.id, notes: raw.map(note => ({ ...note, cache: { frontmatter: parseMetadata(note.content).properties } })), active, dailyOptions: journalPreferences.daily || {} })).catch(error => setError(error.message));
  }, [vault?.id, raw, active, journalPreferences, hasOriginalPlugins]);

  const updateJournalPreferences = (value, vaultId = vault.id) => {
    updateVault(vaultId, old => ({ ...old, journalPreferences: value }));
    persist(`dynote.journal.${vaultId}`, value);
  };
  const createPeriodic = async (target) => {
    const vaultId = vault.id;
    setBusy(true);
    try {
      await flush();
      const content = periodicContent(target, journalPreferences, model.notes);
      const created = await invoke(api.openOrCreateNote({ vaultId, path: target.path, content }));
      if (currentVault.current !== vaultId) return;
      revisions.current.set(created.path, created.revision);
      setRaw(old => [...old.filter(n => n.path !== created.path), created]);
      openNote(created.path); setError("");
      setEditorCommand({ path: created.path, type: "focus-end" });
    } catch (err) { if (currentVault.current === vaultId) setError(err.message); }
    finally { setBusy(false); }
  };

  const change = (content) => {
    if (!note || content === note.content) return;
    changeFile(note.path, content);
  };
  const changeFile = (path, content, id = vault?.id, allowCreate = false) => {
    if (editState.forVault(id).edit(path, content)) return;
    const scope = vaultsRef.current[id];
    const field = documentKind(path) ? "documents" : "notes";
    const source = scope?.[field].find(file => file.path === path);
    if (!scope || (!source && !allowCreate) || source?.content === content || busy || automaticCaptureId === id) return;
    const revision = !source || source.revision === null ? null : revisionMap(id).get(path) ?? source.revision;
    queue.set(id, { path, content, revision });
    updateVault(id, old => ({ ...old, [field]: source
      ? old[field].map(file => file.path === path ? { ...file, content } : file)
      : [...old[field], { path, content, revision }] }));
    if (allowCreate && scope.navigation.recent[0] !== path) updateNavigation({ type: "visit", path }, id);
    setStatus("dirty");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(true).catch(() => {}), 700);
  };

  const createNote = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const path = /\.(md|canvas|base)$/i.test(newName.trim())
        ? newName.trim()
        : newName.trim() + ".md";
      const content = modal === "newMap" ? "---\nmindmap-plugin: basic\n---\n# 새 마인드맵\n\n## 생각\n" : undefined;
      const created = await invoke((documentKind(path) ? api.createDocument : api.createNote)({ vaultId: vault.id, path, content }));
      revisions.current.set(created.path, created.revision);
      if (documentKind(path)) setDocuments((old) => [...old, created]);
      else setRaw((old) => [...old, created]);
      openNote(created.path);
      setMode(modal === "newMap" ? "mindmap" : documentKind(path) ? "edit" : "live");
      setNewName("");
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const reload = async () => {
    setBusy(true);
    try {
      if (edits.blocked()) throw new Error("Copilot 변경을 먼저 유지하거나 되돌려 주세요.");
      await flush();
      if (together && vault.purpose) await loadSpaces({ refresh: true });
      else install(await invoke(api.snapshot({ vaultId: vault.id })));
      setModal(null);
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  useEffect(() => {
    const handler = (event) => {
      if (busy) return;
      if (audioActive.current && (event.key === "Escape" || ((event.metaKey || event.ctrlKey) && ["p", "k", "s", "n"].includes(event.key.toLowerCase())))) {
        event.preventDefault(); setAudioNotice("녹음을 저장하거나 취소한 뒤 이동해 주세요."); return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        ["p", "k", "s", "n"].includes(event.key.toLowerCase())
      ) {
        event.preventDefault();
        const key = event.key.toLowerCase();
        if (key === "s") flush(true).catch(() => {});
        else if (key === "n") {
          setNewName("");
          setModal("new");
        } else if (key === "p") {
          setCommandQuery(""); setCommandIndex(0); setModal("commands");
        } else {
          setSwitchQuery("");
          setModal("switch");
        }
      }
      if (event.key === "Escape") {
        if (macCopyDrag.current) {
          macCopyDrag.current = null;
          setTreeDrop(null);
        }
        setModal(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [flush, busy]);

  const importFiles = async (files, id = vault.id) => {
    try {
      const imported = [];
      for (const file of files) {
        if (file.size > 25 * 1024 * 1024)
          throw new Error("첨부파일은 25MB 이하여야 합니다.");
        imported.push(
          await invoke(
            api.importAttachment({
              vaultId: id,
              name: file.name,
              bytes: new Uint8Array(await file.arrayBuffer()),
            }),
          ),
        );
      }
      updateVault(id, old => old && ({ ...old, attachments: [...(old.attachments ?? []), ...imported] }));
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
  const openAttachment = async (path, fragment = "", vaultId = vault.id) => {
    const request = ++attachmentRequest.current;
    try {
      const data = await invoke(api.readAttachment({ vaultId, path }));
      if (request !== attachmentRequest.current || !vaultsRef.current[vaultId]) return;
      setAttachment({ ...data, fragment, vaultId });
      setSection("files");
    } catch (err) {
      if (request === attachmentRequest.current) setError(err.message);
    }
  };
  const openFile = (path, vaultId = vault.id) => {
    const scope = vaultsRef.current[vaultId];
    if (scope && [...models.get(vaultId).notes, ...scope.documents].some(n => n.path === path)) openNote(path, vaultId);
    else if (scope?.attachments.some(file => file.path === path)) openAttachment(path, "", vaultId);
    else setError(`파일을 찾을 수 없습니다: ${path}`);
  };
  const openExternal = (url) => invoke(api.openExternal(url)).catch((err) => setError(err.message));
  const moveWorkspaceFile = async (vaultId, from, to, revision) => {
    const snapshot = await invoke(api.moveFile({ vaultId, from, to, revision }));
    const oldKey = documentKey(vaultId, from), newKey = documentKey(vaultId, to);
    workspace.dispatch({ type: "rename", path: oldKey, to: newKey });
    setTabs(old => [...new Set(old.map(key => key === oldKey ? newKey : key))]);
    updateNavigation({ type: "rename", from, to }, vaultId);
    acceptSnapshot(snapshot);
    const preferences = vaultsRef.current[vaultId].journalPreferences;
    const templatePeriods = Object.keys(periods).filter(period => preferences[period]?.template === from);
    if (templatePeriods.length) {
      const next = { ...preferences };
      for (const period of templatePeriods) next[period] = { ...preferences[period], template: to };
      updateJournalPreferences(next, vaultId);
    }
    setError(snapshot.warnings.join(" · "));
  };
  const transferTreeFile = async ({ source, vaultId, folder, operation, confirmedRevision }) => {
    if (busy || !vaultsRef.current[source.vaultId] || !vaultsRef.current[vaultId]) return;
    setBusy(true);
    try {
      await flush();
      const revision = confirmedRevision ?? revisionMap(source.vaultId).get(source.path);
      if (!revision) throw new Error("원본 문서를 새로고침해 주세요.");
      if (source.vaultId !== vaultId && !confirmedRevision) {
        setCrossCopy({ source, vaultId, folder, operation, confirmedRevision: revision });
        setModal("tree-copy");
        return;
      }
      const name = source.path.split("/").at(-1);
      if (operation === "move") {
        await moveWorkspaceFile(vaultId, source.path, folder ? folder + "/" + name : name, revision);
      } else {
        const saved = await invoke(api.copyFile({ vaultId, sourceVaultId: source.vaultId, from: source.path, folder, revision }));
        const field = saved.kind ? "documents" : "notes";
        revisionMap(vaultId).set(saved.path, saved.revision);
        updateVault(vaultId, old => old && ({ ...old, [field]: [...old[field].filter(file => file.path !== saved.path), saved] }));
        setError("");
      }
      setTreeReveal({ vaultId, folder });
      if (confirmedRevision) setModal(null);
    } catch (error) {
      if (confirmedRevision) setModal(null);
      setError(error.message);
    } finally { setBusy(false); }
  };
  const startTreeDrag = (event, vaultId, path) => {
    if (macCopyDrag.current) { event.preventDefault(); return; }
    treeDrag.current = { vaultId, path };
    const key = documentKey(vaultId, path);
    event.dataTransfer.setData(FILE_TREE_DRAG, key);
    if (/\.md$/i.test(path)) event.dataTransfer.setData(DOCUMENT_DRAG, key);
    event.dataTransfer.effectAllowed = "copyMove";
  };
  const endTreeDrag = () => { treeDrag.current = null; setTreeDrop(null); };
  const highlightTreeDrop = (vaultId, folder, operation) => {
    setTreeDrop(old => !operation ? null
      : old?.vaultId === vaultId && old.folder === folder && old.operation === operation ? old : { vaultId, folder, operation });
  };
  const treeDropProps = (vaultId, folder) => {
    const current = treeDrop?.vaultId === vaultId && treeDrop.folder === folder ? treeDrop : null;
    const operationAt = (event, source) => {
      if (busy || !source || !event.dataTransfer.types.includes(FILE_TREE_DRAG)) return null;
      if (event.ctrlKey || source.vaultId !== vaultId) return "copy";
      return source.path.split("/").slice(0, -1).join("/") === folder ? null : "move";
    };
    return {
      "data-tree-drop-vault": vaultId,
      "data-tree-drop-folder": folder,
      "data-drop-label": current ? current.operation === "copy" ? "복사" : "이동" : undefined,
      onDragOver: event => {
        if (!event.dataTransfer.types.includes(FILE_TREE_DRAG)) return;
        event.preventDefault();
        const operation = operationAt(event, treeDrag.current);
        event.dataTransfer.dropEffect = operation ?? "none";
        highlightTreeDrop(vaultId, folder, operation);
      },
      onDragLeave: event => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setTreeDrop(old => old?.vaultId === vaultId && old.folder === folder ? null : old);
      },
      onDrop: event => {
        if (!event.dataTransfer.types.includes(FILE_TREE_DRAG)) return;
        event.preventDefault();
        const source = treeDrag.current, operation = operationAt(event, source);
        endTreeDrag();
        if (!operation || event.dataTransfer.getData(FILE_TREE_DRAG) !== documentKey(source.vaultId, source.path)) return;
        void transferTreeFile({ source, vaultId, folder, operation });
      },
    };
  };
  const showTreeMenu = (origin, x, y, target, vaultId) => {
    const scope = vaultsRef.current[vaultId];
    if (!scope || busy || editState.forVault(vaultId).blocked() || (target.folder && !canTrashFolder(target.path, protectedTreeFolders(scope.journalPreferences)))) {
      setTreeMenu(null);
      return;
    }
    const rect = origin.getBoundingClientRect();
    setTreeMenu({
      ...target, vaultId, origin,
      x: Math.max(4, Math.min(x || rect.left + 20, window.innerWidth - 194)),
      y: Math.max(4, Math.min(y || rect.bottom, window.innerHeight - 48)),
    });
  };
  const startMacCopy = (event, vaultId, path) => {
    if (!isMac || busy || !event.ctrlKey || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    macCopyDrag.current = {
      source: { vaultId, path }, origin: event.currentTarget, pointerId: event.pointerId,
      x: event.clientX, y: event.clientY, dragging: false,
    };
  };
  const macCopyTarget = (event) => {
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-tree-drop-vault]");
    return target && { vaultId: target.dataset.treeDropVault, folder: target.dataset.treeDropFolder };
  };
  const moveMacCopy = (event) => {
    const drag = macCopyDrag.current;
    if (drag?.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= 5) drag.dragging = true;
    if (!drag.dragging) return;
    const target = macCopyTarget(event);
    highlightTreeDrop(target?.vaultId, target?.folder, target && !busy ? "copy" : null);
  };
  const finishMacCopy = (event) => {
    const drag = macCopyDrag.current;
    if (drag?.pointerId !== event.pointerId) return;
    macCopyDrag.current = null;
    setTreeDrop(null);
    if (event.type !== "pointerup") return;
    if (!drag.dragging) {
      showTreeMenu(drag.origin, event.clientX, event.clientY, { path: drag.source.path, folder: false }, drag.source.vaultId);
      return;
    }
    const target = macCopyTarget(event);
    if (target) void transferTreeFile({ ...target, source: drag.source, operation: "copy" });
  };
  const prepareFile = async (path, action, folder = false, vaultId = vault.id) => {
    try {
      let revision = revisionMap(vaultId).get(path);
      if (!folder && !/\.(md|canvas|base)$/i.test(path))
        revision = (
          await invoke(api.readAttachment({ vaultId, path }))
        ).revision;
      setError("");
      setFileTarget({ path, revision, folder, vaultId });
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
      const vaultId = fileTarget.vaultId;
      const revision = revisionMap(vaultId).get(fileTarget.path) ?? fileTarget.revision;
      const preferences = vaultsRef.current[vaultId]?.journalPreferences;
      if (modal === "move") {
        await moveWorkspaceFile(vaultId, fileTarget.path, newName.trim(), revision);
        if (/\.(md|canvas|base)$/i.test(newName.trim())) openNote(newName.trim(), vaultId);
        else await openAttachment(newName.trim(), "", vaultId);
      } else {
        const item = await invoke(
          fileTarget.folder
            ? api.trashFolder({ vaultId, path: fileTarget.path, protectedFolders: protectedTreeFolders(preferences) })
            : api.trashFile({ vaultId, path: fileTarget.path, revision }),
        );
        setLastTrash({ ...item, vaultId });
        updateNavigation({ type: "remove", path: fileTarget.path }, vaultId);
        install(await invoke(api.snapshot({ vaultId })));
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
      if (/\.(md|canvas|base)$/i.test(lastTrash.path)) openNote(lastTrash.path, lastTrash.vaultId);
      else await openAttachment(lastTrash.path, "", lastTrash.vaultId);
      setLastTrash(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const followEditorLink = (target, kind, sourcePath = active, vaultId = vault.id) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) {
      invoke(api.openExternal(target)).catch((err) => setError(err.message));
      return;
    }
    const sourceVault = vaultsRef.current[vaultId];
    const sourceModel = models.get(vaultId);
    if (!sourceVault || !sourceModel) return;
    const asset = resolveLink(target, sourcePath, sourceVault.attachments ?? [], { kind });
    if (asset.status === "resolved" && sourceVault.attachments?.some(a => a.path === asset.path)) {
      openAttachment(asset.path, target.split("#").slice(1).join("#"), vaultId);
      return;
    }
    const resolved = resolveLink(target, sourcePath, [...sourceModel.notes, ...sourceVault.documents], { kind });
    if (resolved.status === "resolved") {
      if (resolved.path !== sourcePath) openNote(resolved.path, vaultId);
      setEditorJump({ path: resolved.path, fragment: target.split("#")[1] ?? "" }, vaultId);
    } else if (resolved.status === "ambiguous") {
      setError("같은 이름의 문서가 여러 개 있습니다. 링크에 폴더 경로를 적어 주세요.");
    } else {
      setNewName(target.split(/[\#^]/)[0]);
      setModal("new");
    }
  };

  const followLink = (event, sourcePath = active, sourcePreview = preview.current, vaultId = vault.id) => {
    const sourceVault = vaultsRef.current[vaultId];
    const sourceModel = models.get(vaultId);
    if (!sourceVault || !sourceModel) return;
    const sourceNote = sourceModel.notes.find(n => n.path === sourcePath);
    const checkbox = event.target.closest("input[data-task-line]");
    if (checkbox) {
      event.preventDefault();
      if (!checkbox.disabled)
        try {
          changeFile(sourcePath,
            toggleTask(
              sourceNote.content,
              Number(checkbox.dataset.taskLine),
              checkbox.checked,
            ), vaultId,
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
      openAttachment(anchor.dataset.attachment, anchor.dataset.attachmentFragment ?? "", vaultId);
      return;
    }
    if (anchor.dataset.anchor) {
      sourcePreview?.querySelectorAll("[id]").forEach((n) => {
        if (n.id === anchor.dataset.anchor)
          n.scrollIntoView({ behavior: "smooth" });
      });
      return;
    }
    const target = anchor.dataset.note;
    if (target !== undefined) {
      const resolved = resolveLink(target, sourcePath, [...sourceModel.notes, ...sourceVault.documents]);
      if (resolved.status === "resolved") {
        if (resolved.path !== sourcePath) openNote(resolved.path, vaultId);
        const heading = target.split("#")[1];
        if (heading)
          setTimeout(() => {
            const headingNode = [
              ...(document.querySelector(`[data-vault-id="${CSS.escape(vaultId)}"][data-document-path="${CSS.escape(resolved.path)}"]`)?.querySelectorAll("h1,h2,h3,h4,h5,h6") ?? []),
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
  const showLinkPreview = (event) => {
    const anchor = event.target.closest?.("a[data-note], [data-live-target]");
    if (!anchor || hoverAnchor.current === anchor || modal) return;
    clearTimeout(hoverTimer.current); clearTimeout(hoverClose.current);
    const source = anchor.closest("[data-document-path]");
    const vaultId = source?.dataset.vaultId ?? vault.id;
    const notes = models.get(vaultId)?.notes;
    if (!notes) return;
    const resolved = resolveLink(anchor.dataset.note ?? anchor.dataset.liveTarget, source?.dataset.documentPath ?? active, notes, { kind: anchor.dataset.liveKind ?? "wiki" });
    if (resolved.status !== "resolved") { setHover(null); return; }
    hoverAnchor.current = anchor;
    hoverTimer.current = setTimeout(() => {
      if (!anchor.isConnected) return;
      const bounds = anchor.getBoundingClientRect();
      setHover({ path: resolved.path, vaultId, position: { left: Math.max(12, Math.min(bounds.left, window.innerWidth - 372)), top: Math.max(12, Math.min(bounds.bottom + 8, window.innerHeight - 320)) } });
    }, 350);
  };
  const closeLinkPreview = (event) => {
    const anchor = event.target.closest?.("a[data-note], [data-live-target]");
    if (!anchor || anchor.contains(event.relatedTarget)) return;
    clearTimeout(hoverTimer.current); hoverAnchor.current = null;
    hoverClose.current = setTimeout(() => setHover(null), 200);
  };

  const insertTemplate = (path) => {
    const template = model.notes.find(n => n.path === path), view = editorView.current;
    if (!template || !note || !view || view.state.readOnly || busy || edits.blocked()) return;
    const target = { ...periodicNote("daily", localDate()), title: note.path.split("/").at(-1).replace(/\.md$/i, "") };
    const insert = renderTemplate(template.content, target);
    const { from, to } = view.state.selection.main;
    view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.replace(/\r\n|\r/g, "\n").length }, annotations: isolateHistory.of("full"), scrollIntoView: true });
    setModal(null); view.focus();
  };
  const insertDiagram = (code) => {
    const view = editorView.current;
    if (!view || view.state.readOnly || busy || edits.blocked()) return;
    const { from, to } = view.state.selection.main;
    const insert = diagramInsertion(view.state.doc.toString(), from, code);
    view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, annotations: isolateHistory.of("full"), scrollIntoView: true });
    setModal(null); view.focus();
  };
  const convertMap = async (kind) => {
    const vaultId = vault.id;
    setBusy(true);
    try {
      await flush();
      const content = convertMindmap(note.content, kind);
      const path = note.path.replace(/\.md$/i, `-${kind}.md`);
      const created = await invoke(api.createNote({ vaultId, path, content }));
      if (currentVault.current !== vaultId) return;
      revisions.current.set(path, created.revision); setRaw(old => [...old, created]); openNote(path); setMode("mindmap");
    } catch (err) { if (currentVault.current === vaultId) setError(err.message); }
    finally { setBusy(false); }
  };
  const periodicCommands = useMemo(() => modal !== "commands" ? [] : Object.keys(periods).flatMap(period => {
    const entries = periodicEntries(model.notes, period, { ...journalPreferences[period], locale: journalPreferences.locale });
    return [[-1,"이전"],[1,"다음"]].map(([direction,label]) => {
      const target = adjacentEntry(entries, active, direction);
      return { id: `${period}-${direction}`, label: `${label} ${periods[period]} 일지`, disabled: !target, run: () => openNote(target.path) };
    });
  }), [modal === "commands", model.notes, journalPreferences, active, openNote]);
  const commands = [
    { id: "ess", label: "ESS LINK 3D 보기", run: () => openEss() },
    ...pluginData.entries.flatMap(entry => entry.commands?.map(command => ({ id: command.id, label: command.name, run: async () => { setModal(null); await invoke(api.pluginCommand({ vaultId: vault.id, id: entry.id, command: command.id })); } })) || []),
    { id: "new", label: "새 문서 만들기", run: () => { setNewName(""); setModal("new"); } },
    { id: "switch", label: "문서로 이동", run: () => { setSwitchQuery(""); setModal("switch"); } },
    ...[["planner", "개발 플래너"], ["files", "파일 목록"], ["recent", "최근 파일"], ["bookmarks", "북마크"], ["journal", "달력과 일지"], ["graph", "그래프 보기"], ["search", "전체 검색"]].map(([id,label]) => ({ id, label, run: () => { setSection(id); setModal(null); } })),
    { id: "bookmark", label: "현재 문서 북마크 전환", disabled: !note && !structured, run: () => { updateNavigation({ type: "bookmark", path: active }, vault.id); setModal(null); } },
    { id: "today", label: "오늘의 일지 열기 또는 만들기", run: () => createPeriodic(periodicNote("daily", localDate(), { ...journalPreferences.daily, locale: journalPreferences.locale })) },
    ...["weekly", "monthly", "quarterly", "yearly"].map((period, i) => ({ id: period, label: `현재 ${["주간", "월간", "분기", "연간"][i]} 노트 열기 또는 만들기`, run: () => createPeriodic(periodicNote(period, localDate(), { ...journalPreferences[period], locale: journalPreferences.locale })) })),
    { id: "template", label: "템플릿 삽입", disabled: !note || edits.blocked(), run: () => { setMode("edit"); setModal("template"); } },
    ...[["up", "목록 항목 위로 이동"], ["down", "목록 항목 아래로 이동"], ["indent", "목록 들여쓰기"], ["outdent", "목록 내어쓰기"], ["fold", "목록 접기"], ["unfold", "목록 펼치기"]].map(([action,label]) => ({ id: `outline-${action}`, label, disabled: !note || edits.blocked(), run: () => { setModal(null); if (!["edit", "live", "split"].includes(mode)) setMode("edit"); setEditorCommand({ path: active, action }); } })),
    { id: "mermaid", label: "Mermaid 작성 도구", disabled: !note || edits.blocked(), run: () => { if (mode === "read" || mode === "mindmap") setMode("edit"); setModal("mermaid"); } },
    { id: "mindmap", label: "마인드맵 보기", disabled: !note || edits.blocked(), run: () => { setMode("mindmap"); setModal(null); } },
    { id: "new-map", label: "새 마인드맵 만들기", run: () => { setNewName("새 마인드맵.md"); setModal("newMap"); } },
    { id: "timestamp", label: "일지 시간 기록 삽입", disabled: !note || edits.blocked(), run: () => { setModal(null); setMode("edit"); setEditorCommand({ path: active, type: "timestamp", now: new Date().toISOString(), atEnd: !editorView.current }); } },
    { id: "rating", label: "일지 평가", disabled: !note || edits.blocked(), run: () => setModal("rating") },
    { id: "on-this-day", label: "과거 같은 날의 기록", run: () => { setHistoryDate(localDate()); setModal("onThisDay"); } },
    { id: "audio", label: "음성 녹음", disabled: edits.blocked(), run: () => { setAudioNotice(""); setModal("audio"); } },
    { id: "web", label: "웹 뷰어 열기", run: () => { setError(""); setModal("web"); } },
    { id: "extract-selection", label: "선택 영역을 새 문서로 추출", disabled: !note || editorSelection?.path !== active || edits.blocked(), run: () => setModal("compose-extract") },
    { id: "extract-heading", label: "제목 단위로 새 문서 추출", disabled: !note?.headings.length || edits.blocked(), run: () => setModal("compose-extract-heading") },
    { id: "merge-note", label: "현재 문서를 다른 문서와 합치기", disabled: !note || edits.blocked(), run: () => setModal("compose-merge") },
    ...periodicCommands,
    { id: "save", label: "현재 변경 저장", run: async () => { await flush(); setModal(null); } },
    { id: "settings", label: "설정 열기", run: () => setModal("settings") },
    { id: "git-workspace", label: "Git 변경 관리", run: () => { setSettingsTab("git-workspace"); setModal("settings"); } },
    { id: "updates", label: "Dynote 업데이트 확인", run: () => { setSettingsTab("updates"); setModal("settings"); } },
  ];
  const dailyRating = modal === "rating" && note ? parseMetadata(note.content).properties["daily rating"] : null;
  const commandResults = commands.filter(c => c.label.toLowerCase().includes(commandQuery.toLowerCase()));
  const runCommand = (command) => {
    if (!command || command.disabled || busy || (!vault?.id && command.id !== "settings")) return;
    Promise.resolve().then(command.run).catch(err => setError(err.message));
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
  const resolveDocument = key => {
    const { vaultId, path } = documentRef(key);
    const scope = vaults[vaultId];
    const notes = models.get(vaultId)?.notes;
    const document = notes?.find(note => note.path === path);
    return document && {
      note: document, notes, vault: scope, journalPaths: journalPaths.get(vaultId),
      scopeLabel: together ? spaceLabel(scope) : undefined,
      captureLocked: automaticCaptureId === vaultId,
      edits: editState.forVault(vaultId),
      jump: editorJump?.vaultId === vaultId ? editorJump : null,
    };
  };
  const renderTree = scope => <FileTree notes={[...models.get(scope.id).notes, ...scope.documents]} folders={scope.folders ?? emptyFiles}
    active={vault.id === scope.id ? active : null} disabled={busy} onOpen={path => openNote(path, scope.id)}
    reveal={treeReveal?.vaultId === scope.id ? treeReveal : null}
    onDragDocument={(event, path) => startTreeDrag(event, scope.id, path)} onDragEnd={endTreeDrag}
    onCopyPointer={(event, path) => startMacCopy(event, scope.id, path)}
    dropProps={folder => treeDropProps(scope.id, folder)}
    onContext={(event, target) => {
      if (macCopyDrag.current && event.ctrlKey) return;
      showTreeMenu(event.currentTarget, event.clientX, event.clientY, target, scope.id);
    }} />;
  const spaceSelector = label => together && <label className="space-filter">
    <span>문서 공간</span>
    <select aria-label={label} value={filter} onChange={event => setSpaceFilter(event.target.value)}>
      <option value="all">전체 공간</option>
      <option value="personal">개인 노트</option>
      {connectedSpaces.filter(scope => scope.purpose === "team").map(scope => <option key={scope.id} value={scope.id}>{spaceLabel(scope)}</option>)}
      {filter !== "all" && filter !== "personal" && vaults[filter]?.purpose !== "team" &&
        <option value={filter}>{spaceLabel(vaults[filter])}</option>}
    </select>
  </label>;
  const hoverModel = hover ? models.get(hover.vaultId) : null;
  const incoming = model.backlinks[active] ?? [];
  const outgoing = model.edges
    .filter((e) => e.source === active)
    .map((e) => model.notes.find((n) => n.path === e.target))
    .filter(Boolean);
  return (
    <div className="app-shell" onPointerMove={moveMacCopy} onPointerUp={finishMacCopy}
      onPointerCancel={finishMacCopy} onLostPointerCapture={finishMacCopy}>
      <header className={isMac ? "titlebar titlebar-mac" : "titlebar"}>
        <button className="app-version" aria-label="앱 버전 정보" title="DyNote 버전 정보" onClick={() => setModal("about")}>
          <img src="./brand/dynote.svg" width="30" height="30" alt="" />
          <span className="app-wordmark">Dy<span>Note</span></span>
          <small>v{version}</small>
        </button>
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
            <IconButton label="명령 팔레트" disabled={busy} onClick={() => { setCommandQuery(""); setCommandIndex(0); setModal("commands"); }}><Terminal size={20}/></IconButton>
            <IconButton label="최근 파일" active={section === "recent"} onClick={() => setSection("recent")}><History size={20}/></IconButton>
            <IconButton label="북마크" active={section === "bookmarks"} onClick={() => setSection("bookmarks")}><Bookmark size={20}/></IconButton>
            <IconButton label="달력과 일지" active={showCalendar} onClick={() => { setJournalScopeId(vault.id); setSection("journal"); }}><CalendarDays size={20}/></IconButton>
            <IconButton label="개발 플래너" active={section === "planner"} onClick={() => setSection("planner")}><Sparkles size={20}/></IconButton>
            <IconButton label="ESS LINK 3D 보기" active={section === "ess"} onClick={() => openEss()}><Box size={20}/></IconButton>
            <IconButton
              label="파일 목록"
              active={section === "files" || (section === "journal" && !showCalendar)}
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
            <IconButton label="설정" disabled={busy} onClick={() => setModal("settings")}><Settings size={20} /></IconButton>
            <IconButton
              label="저장과 복구 안내"
              onClick={() => setModal("about")}
            >
              <ShieldCheck size={20} />
            </IconButton>
            <span className="avatar">DN</span>
          </div>
        </nav>
        <aside className="navigator" style={{ width: panelLayout.left }}>
          <button className="vault-switch" aria-label="공간 전환·관리" disabled={busy} {...(!together ? treeDropProps(vault.id, "") : {})} onClick={() => { setSettingsTab("vault"); setModal("settings"); }}>
            <span className="vault-icon">
              <FolderOpen size={18} />
            </span>
            <span className="space-current">
              <strong>{vault.name}</strong>
              <span className={`space-badge ${space?.purpose ?? "unclassified"}`}>{space?.purpose === "personal" ? "개인 노트" : space?.purpose === "team" ? "팀 공유 노트" : "용도 미지정"}</span>
            </span>
            <ChevronDown size={16} />
          </button>
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
                  queue.dirty ? setModal("reload") : reload()
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
          {!showCalendar && !["recent", "bookmarks"].includes(section) && spaceSelector("문서 공간 범위")}
          {spaceWarnings.map(warning => <p key={warning} className="space-warning" role="status">{warning}</p>)}
          {showCalendar ? <JournalPanel key={vault.id} notes={model.notes} active={active} preferences={journalPreferences} onPreferences={updateJournalPreferences} onOpen={openNote} onCreate={createPeriodic} onHistory={(date) => { setHistoryDate(date); setModal("onThisDay"); }} busy={busy}/>
          : ["recent", "bookmarks"].includes(section) ? <NavigationPanel title={section === "recent" ? "최근 파일" : "북마크"} paths={navigation[section]} onOpen={openNote}/>
          : section === "search" ? (
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
                  className={`search-result ${n.key === workspace.active ? "selected" : ""}`}
                  key={n.key}
                  disabled={busy}
                  onClick={() => openNote(n.path, n.vaultId)}
                >
                  <strong>
                    <FileText size={14} />
                    {n.title}
                  </strong>
                  {together && <small className="search-space">{n.scopeLabel} · {n.path}</small>}
                  <span>{n.snippet || n.path}</span>
                </button>
              ))}
              {!results.length && (
                <p className="muted empty-small">일치하는 문서가 없습니다.</p>
              )}
            </div>
          ) : (
            together ? <div className="space-trees">
              {visibleSpaces.map(scope => <section key={scope.id} className="space-tree" aria-label={spaceLabel(scope)}>
                <h3 {...treeDropProps(scope.id, "")}>{spaceLabel(scope)}</h3>
                {renderTree(scope)}
              </section>)}
            </div> : renderTree(vault)
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
        <PanelResize side="left" width={panelLayout.left} max={panelBudget - (rightVisible ? panelLayout.right : 0)} onChange={resizePanel("left")} />
        <main className="workspace">
          <div className="tabbar">
            <div className="tabs">
              {tabs.map(key => {
                const { vaultId, path } = documentRef(key);
                const scope = vaults[vaultId];
                if (!scope) return null;
                const label = together ? spaceLabel(scope) : null;
                return <div className={`tab ${key === workspace.active && !["graph", "ess"].includes(section) ? "active" : ""}`} key={key}>
                  <button className="tab-label" title={label ? `${label} · ${path}` : path} disabled={busy}
                    draggable={!busy && /\.md$/i.test(path)}
                    onDragStart={event => { event.dataTransfer.setData(DOCUMENT_DRAG, key); event.dataTransfer.effectAllowed = "copy"; }}
                    onClick={() => openNote(path, vaultId)}>
                    <FileText size={13} />
                    <span className={label ? "tab-document" : undefined}>
                      <span>{path.split("/").at(-1).replace(/\.md$/i, "")}</span>
                      {label && <small className="tab-space">{label}</small>}
                    </span>
                  </button>
                  <button className="tab-close" aria-label={`${path} 탭 닫기`} disabled={busy} onClick={() => {
                    const next = tabs.filter(value => value !== key);
                    setTabs(next);
                    workspace.dispatch({ type: "close", path: key });
                    if (workspace.paths.length === 1 && workspace.active === key && next.length) workspace.setActive(next.at(-1));
                  }}><X size={12} /></button>
                </div>;
              })}
              {essOpened && <div className={`tab ${section === "ess" ? "active" : ""}`}>
                <button className="tab-label" onClick={() => openEss()}><Box size={13}/>ESS LINK 3D</button>
                <button className="tab-close" aria-label="ESS LINK 3D 탭 닫기" onClick={() => {setEssOpened(false);setEssTarget(null);if(section==="ess")setSection("files");}}><X size={12}/></button>
              </div>}
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
                {section === "journal" ? "저널" : section === "ess" ? "ESS LINK 3D" : section === "graph"
                  ? "문서 그래프"
                  : (active?.replace(/\.md$/i, "") ?? "문서 선택")}
              </span>
            </div>
            <div className="toolbar-actions">
              {note && <button className="text-action" disabled={busy} onClick={()=>{setModal("compare");}}>문서 나란히 보기</button>}
              {note && !["graph", "ess", "planner"].includes(section) && <button className="text-action" onClick={() => openEss(noteEssLinks(note.content)[0])}><Box size={14}/> ESS LINK 보기</button>}
              {!["graph", "ess"].includes(section) && (note || structured) && (
                <>
                  <IconButton label="현재 문서 북마크" active={navigation.bookmarks.includes(active)} disabled={busy} onClick={() => updateNavigation({ type: "bookmark", path: active }, vault.id)}><Bookmark size={15}/></IconButton>
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
              {note && !["graph", "ess"].includes(section) && !structured && (
                <div className="view-segments">
                  <IconButton label="마인드맵 보기" active={mode === "mindmap"} disabled={!note || busy || edits.blocked()} onClick={() => setMode("mindmap")}><Network size={15}/></IconButton>
                  <IconButton
                    label="읽기 보기"
                    active={mode === "read"}
                    onClick={() => setMode("read")}
                  >
                    <BookOpen size={15} />
                  </IconButton>
                  <IconButton
                    label="Live Preview"
                    active={mode === "live"}
                    onClick={() => setMode("live")}
                  >
                    <Sparkles size={15} />
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
                label="AI 채팅 열기"
                active={right && rightTab === "copilot"}
                onClick={() => { setRight(true); setRightTab("copilot"); }}
              >
                <MessageCircle size={16} />
              </IconButton>
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
                <button onClick={() => flush(true).catch(() => {})}>
                  저장 재시도
                </button>
              )}
              <button aria-label="알림 닫기" onClick={() => setError("")}>
                <X size={15} />
              </button>
            </div>
          )}
          {updateState?.phase === "ready" && updateState.result?.latest?.tag !== dismissedUpdate && !updateState.preferences.ignored.includes(updateState.result?.latest?.tag) && <div className="classification-notice" role="status"><span>새 버전 {updateState.result?.latest?.tag} 다운로드 검증 완료 · 직접 설치할 수 있습니다.</span><button onClick={()=>invoke(api.showUpdate()).catch(e=>setError(e.message))}>설치 파일 위치 열기</button><button onClick={()=>setDismissedUpdate(updateState.result?.latest?.tag)}>나중에</button></div>}
          {journalNote && !["journal", "planner", "graph", "ess"].includes(section) && !attachment && <div className="classification-notice classification-controls">
            <span>이 기록을 폴더별로 정리할 수 있습니다.</span>
            <div ref={classificationHelpRef} className={`classification-action${classificationHelpDismissed ? " help-dismissed" : ""}`} onMouseEnter={()=>setClassificationHelpDismissed(false)} onFocusCapture={()=>setClassificationHelpDismissed(false)} tabIndex={busy||edits.blocked()||!classification.length ? 0 : undefined} aria-label="분류 제안 사용 방법" aria-describedby="classification-help">
              <button aria-describedby="classification-help" disabled={busy||edits.blocked()||!classification.length} onClick={()=>setModal("classify")}>분류 제안 검토 ({classification.length})</button>
              <div className="classification-tooltip" id="classification-help" role="tooltip">
                <strong>저널 내용을 관련 폴더로 정리합니다.</strong>
                <p>제목과 본문을 기존 폴더 이름과 비교해 정리할 구간을 제안합니다.</p>
                <ol><li>버튼을 눌러 원하는 제안을 선택합니다.</li><li>저장할 문서 경로를 확인하거나 수정합니다.</li><li>미리보기를 확인한 뒤 적용합니다.</li></ol>
                <p>원본 저널은 그대로 두고 선택한 원문을 대상 문서에 복사합니다. 입력 중에는 저장이 끝난 뒤 검토할 수 있습니다.</p>
              </div>
            </div>
          </div>}
          {compositionRecovery && <div className="composition-notice" role="status">문서를 정리했습니다. 이전 내용은 복구 사본에 남아 있습니다.<button onClick={() => invoke(api.showRecovery({ vaultId: vault.id })).catch(err => setError(err.message))}>복구 폴더 열기</button><button aria-label="문서 정리 안내 닫기" onClick={() => setCompositionRecovery(null)}>×</button></div>}
          {section!=="journal"&&journalNote&&!attachment&&!["planner","graph","ess"].includes(section)&&<>
            <CopilotJournalToolbar {...captureControls} disabled={busy||captureLocked||edits.blocked()}/>
            <CopilotJournalEntries records={captureState?.records?.filter(record=>record.journalPath===note.path)} disabled={busy||captureLocked||edits.blocked()} onOpen={openNote} onTrash={captureControls.onTrash}/>
          </>}
          {section!=="journal"&&!attachment&&!["planner","graph","ess"].includes(section)&&note&&captureState?.records?.some(record=>record.path===note.path)&&<CopilotJournalEntries records={captureState.records.filter(record=>record.path===note.path)} disabled={busy||captureLocked||edits.blocked()} onOpen={openNote} onTrash={captureControls.onTrash}/>}
          <div className="document-area" onMouseOver={showLinkPreview} onMouseOut={closeLinkPreview}>
            {section === "journal" ? <JournalFeed key={vault.id} notes={model.notes} preferences={journalPreferences} vault={vault}
              currentDate={today} pendingDate={vault.id === dailyVaultId && checkedJournal !== dailyKey ? today : null}
              onOpen={openNote} onChange={(path, content) => changeFile(path, content, vault.id, true)}
              onImportFiles={files => importFiles(files, vault.id)} onLink={followEditorLink}
              jump={editorJump?.vaultId === vault.id ? editorJump : null}
              fonts={fonts} onFontSettings={() => { setSettingsTab("fonts"); setModal("settings"); }}
              disabled={!registryReady || (!journalScopeId && !dailyVaultId) || busy || captureLocked || edits.blocked()} capture={captureControls}/>
            : section === "ess" ? <EssViewer key={vault.id} notes={raw} target={essTarget} onTarget={setEssTarget} onOpen={openNote} onLink={linkEssNote} disabled={busy||edits.blocked()}/>
            : section === "planner" ? <Planner key={vault.id} api={api} session={aiSession} vaultId={vault.id} notes={raw} disabled={busy||edits.blocked()}
              onOpen={openNote}
              onImported={file => setVault(old => ({...old, attachments:[...(old.attachments??[]),file]}))}
              onSave={async (content, expectedRevision) => {
                const vaultId=vault.id;
                await flush();
                if(currentVault.current!==vaultId)throw new Error("보관함이 변경되었습니다.");
                if((revisions.current.get(BOARD_PATH)??null)!==expectedRevision)throw new Error("일정 문서가 변경되었습니다. 다시 열어 주세요.");
                const saved=await invoke(expectedRevision===null ? api.createNote({vaultId,path:BOARD_PATH,content}) : api.saveNote({vaultId,path:BOARD_PATH,content,revision:expectedRevision}));
                if(currentVault.current!==vaultId)return;
                revisions.current.set(saved.path,saved.revision);
                setRaw(old=>[...old.filter(n=>n.path!==saved.path),{...saved,content}]);
              }} /> : section === "graph" ? (
              <Graph
                key={vault.id}
                fontFamily={fontVariables(fonts)["--ui-font"]}
                vaultId={vault.id}
                notes={model.notes}
                edges={model.edges}
                attachments={vault.attachments}
                documents={documents}
                active={active}
                onOpen={openFile}
              />
            ) : structured && !attachment ? (
              structured.kind === "canvas" ? <CanvasEditor key={`${vault.id}:${structured.path}`} document={structured}
                files={[...model.notes, ...documents, ...(vault.attachments ?? [])]} attachments={vault.attachments ?? []} vaultId={vault.id}
                onChange={(content) => changeFile(structured.path, content)} onOpen={openFile} onExternal={openExternal} onError={setError} readOnly={busy || captureLocked} />
                : <BasesView key={`${vault.id}:${structured.path}`} document={structured} notes={model.notes}
                  onChange={(content) => changeFile(structured.path, content)} onNoteChange={changeFile} onOpen={openFile} onError={setError} readOnly={busy || captureLocked} />
            ) : attachment ? (
              <div className="attachment-view">
                <div className="attachment-heading">
                  <strong>{attachment.path}</strong>
                  <button onClick={() => { attachmentRequest.current++; setAttachment(null); }}>
                    문서로 돌아가기
                  </button>
                </div>
                {attachment.mime === "application/pdf" ? (
                  <PdfViewer key={documentKey(attachment.vaultId, attachment.path)} bytes={attachment.bytes} path={attachment.path} fragment={attachment.fragment} backlinks={attachmentBacklinks}
                    onCopy={text => invoke(api.copyText({ vaultId: attachment.vaultId, text }))}
                    onOpenNote={path => openNote(path, attachment.vaultId)}
                    onFollow={fragment => setAttachment(old => old?.vaultId === attachment.vaultId && old.path === attachment.path ? { ...old, fragment } : old)}
                    onPreviewEdit={async input => {
                      const { vaultId, revision } = attachment;
                      const request = attachmentRequest.current;
                      const result = await invoke(api.previewPdf({ vaultId, input: { ...input, sourceRevision: revision } }));
                      if (request !== attachmentRequest.current || !vaultsRef.current[vaultId]) throw new Error("열려 있는 PDF가 변경되었습니다.");
                      return result;
                    }}
                    onApplyEdit={async preview => {
                      const { vaultId } = attachment;
                      const request = attachmentRequest.current;
                      const result = await invoke(api.applyPdf({ vaultId, input: preview.input, revision: preview.revision }));
                      if (request === attachmentRequest.current) {
                        const fragment = `page=${preview.input.page}` + (result.annotationId ? `&annotation=${encodeURIComponent(result.annotationId)}` : "");
                        setAttachment(old => old?.vaultId === vaultId && old.path === attachment.path && old.revision === attachment.revision
                          ? { ...result.attachment, vaultId, fragment } : old);
                      }
                      return result;
                    }}/>
                ) : attachment.mime.startsWith("audio/") ? <AudioViewer bytes={attachment.bytes} mime={attachment.mime}/> : (
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
            ) : note && mode === "mindmap" ? <MindmapEditor key={`${vault.id}:${note.path}`} note={note} onChange={change} onConvert={convertMap} onMarkdown={() => setMode("edit")} readOnly={busy || captureLocked || edits.blocked()} onError={setError}/>
            : note ? (
              <DocumentWorkspace workspace={workspace} resolveDocument={resolveDocument} onOpen={openWorkspaceKey} onAdd={addPane}
                onContext={(editor, element, selection)=>{editorView.current=editor;preview.current=element;setEditorSelection(old=>old===selection?old:selection);}}
                fonts={fonts} onFontSettings={()=>{setSettingsTab("fonts");setModal("settings");}}
                onChange={changeFile} onImportFiles={importFiles} onLink={followEditorLink} onPreviewLink={followLink}
                disabled={busy}/>
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
              onClick={() => flush(true).catch(() => {})}
            >
              {status === "saving" ? (
                <LoaderCircle size={13} className="spin" />
              ) : status === "saved" ? (
                <CheckCheck size={13} />
              ) : (
                <span className="status-dot" />
              )}
              <span>
                {pendingEdit ? "Copilot 미확정 변경 · 복구 초안 보관" : status === "saved"
                  ? "모든 변경사항 저장됨"
                  : status === "saving"
                    ? "저장 중…"
                    : status === "error"
                      ? "초안 보관 중 · 저장 확인 필요"
                      : "변경사항 저장 대기 중"}
              </span>
            </div>
            <button className={`git-status ${gitStatus.phase}`} title={gitStatus.message} onClick={() => { setGitSettingsId(vault.id); setSettingsTab("git"); setModal("settings"); }}>{gitStatus.message}</button>
            <div>
              {note && <span>{statistics.words.toLocaleString()}단어</span>}
              <span>{(note ? statistics.characters : structured?.content.length ?? 0).toLocaleString()}자</span>
              <span>{structured?.kind ?? "Markdown"}</span>
              <span>UTF-8</span>
            </div>
          </footer>
        </main>
        {rightVisible && (<>
          <PanelResize side="right" width={panelLayout.right} max={panelBudget - panelLayout.left} onChange={resizePanel("right")} />
          <aside className={`context-panel ${rightTab === "copilot" ? "with-copilot" : ""}`} style={{ width: panelLayout.right }}>
            <div className="context-tabs" role="tablist" aria-label="오른쪽 패널">
              <button role="tab" aria-selected={rightTab === "info"} className={rightTab === "info" ? "selected" : ""} onClick={() => setRightTab("info")}>
                <List size={14} />
                문서 정보
              </button>
              <button role="tab" aria-selected={rightTab === "copilot"} className={rightTab === "copilot" ? "selected" : ""} onClick={() => setRightTab("copilot")}><Sparkles size={14} />AI 채팅</button>
            </div>
            {together && <div className="context-space" aria-label="현재 문서 공간">{spaceLabel(vault)}</div>}
            {Object.values(vaults).map(scope => {
              const id = scope.id;
              const focused = id === vault.id;
              const scopeEdits = editState.forVault(id);
              const contextNote = focused ? (section === "graph" || attachment || structured ? null : note)
                : models.get(id).notes.find(n => n.path === chatPaths.current.get(id));
              return <CopilotPanel key={id ?? "missing"} api={api} session={aiSession} vaultId={id}
                note={contextNote} notes={scope.notes} liveEdits={scopeEdits}
                onOpenVault={() => { setSettingsTab("vault"); setModal("settings"); }}
                onBeginLive={async requestId => { await flush(); scopeEdits.begin(requestId); }}
                selection={focused && note && mode !== "read" ? editorSelection : null}
                busy={busy || !focused} visible={focused && rightTab === "copilot"}
                onReview={path => {
                  openNote(path, id);
                  workspace.dispatch({ type: "mode", path: documentKey(id, path), mode: "edit" });
                }}
                onApply={async proposal => {
                  if (busy) throw new Error("저장 작업이 끝난 뒤 다시 적용해 주세요.");
                  const key = documentKey(id, proposal.path);
                  if (proposal.kind === "create") {
                    await flush();
                    const created = await invoke(api.createNote({ vaultId: id, path: proposal.path, content: proposal.content }));
                    revisionMap(id).set(created.path, created.revision);
                    updateVault(id, old => old && ({ ...old, notes: [...old.notes, created] }));
                    if (currentVault.current === id) {
                      openNote(created.path, id);
                      workspace.dispatch({ type: "mode", path: key, mode: "edit" });
                    }
                    return;
                  }
                  const target = vaultsRef.current[id]?.notes.find(n => n.path === proposal.path);
                  const content = applyProposal(proposal.target, { vaultId: id, ...target }, proposal.content);
                  const view = editorView.current;
                  if (currentVault.current === id && view && !view.state.readOnly && note?.path === proposal.path) {
                    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content }, annotations: isolateHistory.of("full"), userEvent: "input.copilot" });
                  } else changeFile(proposal.path, content, id);
                  await flush();
                }} />;
            })}
            <div className="document-info" hidden={rightTab !== "info"}>
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
                      if (mode === "live") {
                        setEditorJump({ path: note.path, fragment: h.id });
                        return;
                      }
                      if (mode === "edit") setMode("read");
                      setTimeout(
                        () =>
                          [
                            ...(preview.current?.querySelectorAll(
                              "h1,h2,h3,h4,h5,h6",
                            ) ?? []),
                          ]
                            .find((node) => node.id === h.id)
                            ?.scrollIntoView({ behavior: "smooth" }),
                        30,
                      );
                    }}
                  >
                    {h.plainText ?? h.text}
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
            </div>
          </aside>
        </>
        )}
      </div>
      {treeMenu && <div ref={treeMenuRef} className="file-tree-menu" role="menu" aria-label="문서·폴더 작업" style={{left:treeMenu.x, top:treeMenu.y}}
        onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setTreeMenu(null);}}>
        <button role="menuitem" disabled={busy||edits.blocked()} onClick={()=>{const {path,folder,vaultId}=treeMenu;setTreeMenu(null);prepareFile(path,"trash",folder,vaultId);}}>휴지통으로 이동</button>
      </div>}
      {lastTrash && (
        <div className="undo-toast">
          {lastTrash.systemTrash ? "폴더를 시스템 휴지통으로 이동했습니다. 복구는 시스템 휴지통에서 할 수 있습니다." : "휴지통으로 이동했습니다."}{" "}
          {!lastTrash.systemTrash && <button
            disabled={busy || !vaults[lastTrash.vaultId]}
            onClick={restoreLast}
          >
            되돌리기
          </button>}
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
            <p>{together && vaults[fileTarget?.vaultId] ? `${spaceLabel(vaults[fileTarget.vaultId])} · ` : ""}{fileTarget?.path}</p>
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
              <p>{fileTarget?.folder ? "하위 폴더와 모든 파일을 함께 시스템 휴지통으로 이동합니다. 복구는 시스템 휴지통에서 할 수 있습니다. 연결 문서의 링크는 남습니다." : "복구 가능한 사본을 보관합니다. 연결 문서의 링크는 남습니다."}</p>
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
      {modal === "tree-copy" && crossCopy && vaults[crossCopy.source.vaultId] && vaults[crossCopy.vaultId] && (
        <Modal title="다른 보관함에 복사" onClose={() => !busy && setModal(null)}>
          <p>원본 · {spaceLabel(vaults[crossCopy.source.vaultId])} / {crossCopy.source.path}</p>
          <p>대상 · {spaceLabel(vaults[crossCopy.vaultId])}{crossCopy.folder && ` / ${crossCopy.folder}`}</p>
          <p className="muted">선택한 문서만 복사합니다. 연결된 문서와 첨부파일은 대상 보관함에 같은 내용으로 있어야 합니다.</p>
          <div className="modal-actions">
            <button type="button" disabled={busy} onClick={() => setModal(null)}>취소</button>
            <button type="button" className="primary-button" disabled={busy} onClick={() => transferTreeFile(crossCopy)}>복사</button>
          </div>
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
      {modal === "commands" && <Modal title="명령 팔레트" wide onClose={() => setModal(null)}>
        <input className="native-command-input" autoFocus aria-label="명령 검색" placeholder="실행할 명령을 검색하세요…" value={commandQuery}
          onChange={e => { setCommandQuery(e.target.value); setCommandIndex(0); }}
          onKeyDown={e => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault(); setCommandIndex(i => Math.max(0, Math.min(commandResults.length - 1, i + (e.key === "ArrowDown" ? 1 : -1))));
            } else if (e.key === "Enter") { e.preventDefault(); runCommand(commandResults[commandIndex]); }
          }}/>
        <div className="native-command-results">{commandResults.map((command, index) => <button key={command.id} className={index === commandIndex ? "selected" : ""}
          disabled={busy || command.disabled || (!vault.id && command.id !== "settings")} onMouseMove={() => setCommandIndex(index)} onClick={() => runCommand(command)}>{command.label}</button>)}
          {!commandResults.length && <p className="muted">일치하는 명령이 없습니다.</p>}</div>
        <p className="muted">↑ ↓ 선택 · Enter 실행 · Esc 닫기 · 문서 이동 {shortcut} K</p>
      </Modal>}
      {hoverModel?.notes.some(n => n.path === hover.path) && <NoteHover note={hoverModel.notes.find(n => n.path === hover.path)} notes={hoverModel.notes} vault={vaults[hover.vaultId]} position={hover.position}
        onEnter={() => clearTimeout(hoverClose.current)} onLeave={() => setHover(null)} onOpen={() => { openNote(hover.path, hover.vaultId); setHover(null); }}/>}
      {modal?.startsWith("compose-") && note && <Modal title="문서 정리" wide onClose={() => !busy && setModal(null)}>
        <ComposerDialog key={`${modal}:${note.path}`} kind={modal.slice(8)} source={note} notes={model.notes} selection={editorSelection?.path === active ? editorSelection : null} busy={busy}
          onPreview={async (input) => {
            const vaultId = vault.id; setBusy(true);
            try { await flush(); const result = await invoke(api.previewComposition({ vaultId, input: { ...input, sourceRevision: revisions.current.get(input.sourcePath) } })); if (currentVault.current !== vaultId) throw new Error("보관함이 변경되었습니다."); return result; }
            finally { setBusy(false); }
          }}
          onApply={async (preview) => {
            const vaultId = vault.id; setBusy(true);
            try {
              await flush(); const result = await invoke(api.applyComposition({ vaultId, input: preview.input, revision: preview.revision }));
              if (currentVault.current !== vaultId) throw new Error("보관함이 변경되었습니다.");
              if (preview.input.kind === "merge") updateNavigation({ type: "rename", from: preview.input.sourcePath, to: preview.input.targetPath }, vaultId);
              install(result.snapshot); openNote(preview.input.targetPath); setMode("edit"); setModal(null); setCompositionRecovery(result.recoveryPath);
            } finally { setBusy(false); }
          }}/>
      </Modal>}
      {modal === "template" && <Modal title="템플릿 삽입" onClose={() => setModal(null)}>
        <p>선택한 문서 내용을 현재 선택 영역에 삽입합니다.</p>
        <div className="native-command-results">{model.notes.filter(n => n.path !== active).map(template => <button disabled={busy || edits.blocked()} key={template.path} onClick={() => insertTemplate(template.path)}>{template.path}</button>)}</div>
      </Modal>}
      {modal === "mermaid" && <Modal title="Mermaid 작성 도구" wide onClose={() => setModal(null)}><MermaidTools disabled={busy || edits.blocked()} onInsert={insertDiagram}/></Modal>}
      {modal === "rating" && note && <Modal title="일지 평가" onClose={() => setModal(null)}>
        <p>{note.path} · 현재 평가 {Number.isInteger(dailyRating) && dailyRating >= 1 && dailyRating <= 5 ? dailyRating : "없음"}</p>
        <div className="journal-ratings">{[1,2,3,4,5,null].map(value => <button key={value ?? "none"} aria-label={value ? `평가 ${value}점` : "평가 지우기"} disabled={busy || edits.blocked()} onClick={() => {
          try { change(rateJournal(note.content,value)); setModal(null); } catch (err) { setError(err.message); }
        }}>{value ? "★".repeat(value) : "지우기"}</button>)}</div>
      </Modal>}
      {modal === "onThisDay" && <Modal title="과거 같은 날의 기록" onClose={() => setModal(null)}>
        <input type="date" aria-label="과거 기록 기준 날짜" value={historyDate} onChange={e => { if (e.target.value) setHistoryDate(e.target.value); }}/>
        <NavigationPanel title="지난 기록" paths={onThisDay(model.notes,historyDate,{...journalPreferences.daily,locale:journalPreferences.locale}).map(n=>n.path)} onOpen={openNote}/>
      </Modal>}
      {modal === "audio" && <Modal title="음성 녹음" onClose={() => audioActive.current ? setAudioNotice("녹음을 저장하거나 취소한 뒤 닫아 주세요.") : setModal(null)}>
        {audioNotice && <p role="alert">{audioNotice}</p>}
        <AudioRecorder onActive={(value) => { audioActive.current = value; if (value) setAudioNotice(""); }} onCancel={() => setModal(null)} onSave={async ({ name, bytes }) => {
          const vaultId = vault.id;
          await flush();
          const saved = await invoke(api.importAttachment({ vaultId, name, bytes }));
          if (currentVault.current !== vaultId) throw new Error("보관함이 변경되었습니다.");
          setVault(old => ({ ...old, attachments: [...(old.attachments ?? []), saved] }));
          if (note) { change(note.content + `\n![[${saved.path}]]\n`); await flush(); }
          setModal(null); await openAttachment(saved.path);
        }}/>
      </Modal>}
      {modal === "web" && <Modal title="웹 뷰어 열기" onClose={() => !busy && setModal(null)}>
        <form onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(""); try { await invoke(api.openWebViewer({ url: webUrl.trim() })); setModal(null); } catch (err) { setError(err.message); } finally { setBusy(false); } }}>
          <label>웹 주소<input autoFocus aria-label="웹 뷰어 주소" value={webUrl} onChange={e => setWebUrl(e.target.value)} placeholder="https://" disabled={busy}/></label>
          {error && <p role="alert">{error}</p>}<button className="primary-button" disabled={busy || !webUrl.trim()}>웹 페이지 열기</button>
        </form>
      </Modal>}
      {(modal === "new" || modal === "newMap") && (
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
                  openNote(switchResults[0].path, switchResults[0].vaultId);
              }}
            />
            <kbd>ESC</kbd>
          </div>
          {spaceSelector("빠른 검색 공간 범위")}
          <div className="switch-results">
            {switchResults.map((n) => (
              <button key={n.key} onClick={() => openNote(n.path, n.vaultId)}>
                <FileText size={17} />
                <span>
                  <strong>{n.title}</strong>
                  <small>{together ? `${n.scopeLabel} · ` : ""}{n.path}</small>
                </span>
                {n.key === workspace.active && <Check size={15} />}
              </button>
            ))}
            {!switchResults.length && (
              <p className="empty-small muted">검색 결과가 없습니다.</p>
            )}
          </div>
          <div className="switch-footer">
            Enter로 첫 문서 열기<span>{together ? "선택한 공간 범위에서 검색합니다" : "내 보관함 안에서만 검색합니다"}</span>
          </div>
        </Modal>
      )}
      {modal === "classify" && note && <Modal title="저널 폴더 분류" wide onClose={()=>!busy&&setModal(null)}><ClassificationReview suggestions={classification}
        onPreview={async input=>{await flush();return invoke(api.previewClassification({vaultId:vault.id,input}));}}
        onApply={async value=>{const id=vault.id;setBusy(true);try{await flush();const result=await invoke(api.applyClassification({vaultId:id,input:value.input,revision:value.revision}));if(currentVault.current!==id)return;install(result.snapshot);setModal(null);}finally{setBusy(false);}}}/></Modal>}
      {modal === "compare" && <Modal title="문서 나란히 보기" onClose={()=>setModal(null)}><p>파일이나 탭을 문서의 왼쪽·오른쪽으로 끌어 놓으면 최대 3개를 비교합니다.</p>{searchAcross("").filter(n=>!workspace.paths.includes(n.key)).map(n=><button key={n.key} disabled={workspace.paths.length>=3} onClick={()=>{addPane(n.key);setModal(null);}}>{together ? `${n.scopeLabel} · ` : ""}{n.path} 옆에 열기</button>)}</Modal>}
      {modal === "about" && (
        <Modal title="Dynote 정보" onClose={() => setModal(null)}>
          <p className="app-version-details">현재 버전 v{version}</p>
          <div className="about-icon">
            <ShieldCheck size={31} />
          </div>
          <p>
            문서는 내 기기의 일반 Markdown 파일로 저장됩니다. 변경 전 내용은
            별도의 복구 폴더에 남습니다.
          </p>
          <p>
            로컬 이미지·PDF를 지원합니다. 외부 이미지와 플러그인은 실행하지
            않습니다. 설정에서 노트 전용 Git 저장소를 연결하면 로컬 저장 후
            자동으로 커밋·업로드합니다. 다른 기기의 변경을 가져온 뒤에는 문서를 새로고침하세요.
          </p>
          <button
            className="secondary-button"
            onClick={() =>
              invoke(api.showRecovery({ vaultId: vault.id })).catch((err) => setError(err.message))
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
      {modal === "settings" && (
        <Modal title="설정" wide className="settings-modal" onClose={() => !busy && setModal(null)}>
          <nav className="settings-tabs" aria-label="설정 항목">
            {[["general", "시작 화면"], ["vault", "보관함"], ["fonts", "글꼴"], ["shortcuts", "단축키"], ["plugins", "플러그인"], ["capture", "저널 자동기록"], ["git", "백업·복원"], ["updates", "업데이트"]].map(([key, label]) =>
              <button key={key} aria-current={(settingsTab === key || (key === "git" && ["git-workspace", "history"].includes(settingsTab))) ? "page" : undefined} disabled={busy} onClick={() => setSettingsTab(key)}>{label}</button>)}
          </nav>
          {["git", "history", "git-workspace"].includes(settingsTab) && <nav className="backup-sections" aria-label="백업 작업">
            {[["git", "자동 백업"], ["history", "복원"], ["git-workspace", "고급 Git 관리"]].map(([key, label]) =>
              <button key={key} aria-pressed={settingsTab === key} disabled={busy} onClick={() => setSettingsTab(key)}>{label}</button>)}
          </nav>}
          {settingsTab === "general" && <section className="settings-section"><h3>앱 시작 화면</h3><label>시작할 때 <select aria-label="시작 화면" value={startup} onChange={e=>{setStartup(e.target.value);persist("dynote.startup",e.target.value);}}><option value="journal">오늘의 저널</option><option value="last">마지막 문서</option></select></label><p>저널 파일 이름과 폴더는 달력과 일지 설정에서 변경할 수 있습니다.</p></section>}
          {settingsTab === "shortcuts" && <section className="settings-section">
            <h3>포스트잇</h3>
            <p><strong>새 포스트잇 열기</strong> <kbd>{STICKY_SHORTCUT}</kbd></p>
            <p>Dynote가 백그라운드에서 실행 중이면 다른 앱을 사용하는 중에도 새 포스트잇을 열 수 있습니다. 메뉴 막대에서도 포스트잇을 열 수 있습니다.</p>
          </section>}
          {settingsTab === "vault" && <VaultSettings key={selectedVaultId ?? "missing"}
            onList={loadSpaces}
            onPurpose={async (root, purpose) => { await flush(); await invoke(api.setVaultPurpose({ root, purpose })); }}
            onOpenGit={() => { setGitSettingsId(selectedVaultId); setSettingsTab("git"); }}
            onPick={async (purpose) => {
              setBusy(true);
              try { await flush(); const snapshot = await invoke(api.pickVault({ purpose })); if (snapshot) { setSpaceFilter("all"); install(snapshot, true); } }
              finally { setBusy(false); }
            }}
            onSelect={async (root) => {
              setBusy(true);
              try { await flush(); const snapshot = await invoke(api.selectVault({ root })); setSpaceFilter("all"); install(snapshot, true); }
              finally { setBusy(false); }
            }}
            onForget={async root => { await flush(); return invoke(api.forgetVault({ root })); }} />}
          {settingsTab === "capture"&&<CopilotJournalSettings key={captureVaultId} state={captureTargetState}
            destination={captureVault?.name} disabled={busy || automaticCaptureId === captureVaultId}
            onRefresh={async () => { const state = await invoke(api.captureStatus({ vaultId: captureVaultId })); updateCaptureState(captureVaultId, () => state); return state; }}
            onSource={async () => { const state = await invoke(api.pickCaptureSource({ vaultId: captureVaultId })); if (state) updateCaptureState(captureVaultId, () => state); return state; }}
            onSave={async input => { const state = await invoke(api.configureCapture({ vaultId: captureVaultId, input })); updateCaptureState(captureVaultId, () => state); return state; }}
            onImport={()=>captureAction("sync",true,{},captureVaultId)} onManageSpaces={()=>setSettingsTab("vault")}/>}
          {settingsTab === "fonts" && <FontSettings value={fonts} onChange={(value) => setFonts(normalizeFonts(value))} />}
          {settingsTab === "plugins" && vault.id && <PluginSettings key={vault.id} data={pluginData}
            onImport={() => invoke(api.importPlugin({ vaultId: vault.id }))}
            onEnable={(id, enabled) => invoke(api.enablePlugin({ vaultId: vault.id, id, enabled }))}
            onShow={(id, settings) => invoke(api.showPlugin({ vaultId: vault.id, id, settings }))} />}
          {settingsTab === "updates" && <UpdateSettings currentVersion={version} state={updateState} onCheck={()=>invoke(api.checkUpdates()).then(setUpdateState)} onSettings={async value=>{const previous=updateState;setUpdateState(old=>({...old,preferences:{...old.preferences,...value}}));try{setUpdateState(await invoke(api.updateSettings(value)));}catch(error){setUpdateState(previous);throw error;}}} onDownload={()=>invoke(api.downloadUpdate()).then(setUpdateState)} onShow={()=>invoke(api.showUpdate())} onOpen={openExternal}/>}
          {settingsTab === "git-workspace" && gitVault.id && <GitWorkspace key={gitVault.id} busy={busy} backupEnabled={gitSettingsStatus.enabled}
            onStatus={() => invoke(api.gitWorkspaceStatus({ vaultId: gitVault.id }))}
            onDiff={(path, staged) => invoke(api.gitWorkspaceDiff({ vaultId: gitVault.id, path, staged }))}
            onOpen={(path) => { openFile(path, gitVault.id); setModal(null); }}
            onAction={async (action) => {
              setBusy(true);
              try {
                await flush();
                const result = await invoke(api.gitWorkspaceAction({ vaultId: gitVault.id, action }));
                if (result.snapshot) install(result.snapshot);
                return result.status;
              } finally { setBusy(false); }
            }}/>}
          {["git", "history", "git-workspace"].includes(settingsTab) && !gitVault.id && <p>먼저 보관함에서 노트 폴더를 선택해 주세요.</p>}
          {settingsTab === "git" && gitVault.id && <GitSettings key={`${gitVault.id}:${gitSettingsStatus.config?.remote ?? ""}`} status={gitSettingsStatus} space={gitVault.root ? gitVault : null} onManageSpaces={() => setSettingsTab("vault")}
            onRepositoryStatus={() => invoke(api.gitWorkspaceStatus({ vaultId: gitVault.id }))}
            onConnect={async (config) => { await flush(); acceptGitStatus(await invoke(api.connectGit({ vaultId: gitVault.id, config }))); }}
            onClone={async (config) => {
              await flush(); setBusy(true);
              try { const snapshot = await invoke(api.cloneGit({ vaultId: gitVault.id, config })); if (snapshot) { install(snapshot, true); setModal(null); } }
              finally { setBusy(false); }
            }}
            onSync={async () => { await flush(); acceptGitStatus(await invoke(api.syncGit({ vaultId: gitVault.id }))); }}
            onDisconnect={async () => acceptGitStatus(await invoke(api.disconnectGit({ vaultId: gitVault.id })))} />}
          {settingsTab === "history" && gitVault.id && <GitHistory key={gitVault.id} busy={busy}
            onList={(month) => invoke(api.gitHistory({ vaultId: gitVault.id, month }))}
            onPreview={async (commit) => { await flush(); return invoke(api.previewGit({ vaultId: gitVault.id, commit })); }}
            onRestore={async (preview) => {
              setBusy(true);
              try {
                await flush();
                const result = await invoke(api.restoreGit({ vaultId: gitVault.id, commit: preview.commit, revision: preview.revision }));
                install(result.snapshot); return result;
              } finally { setBusy(false); }
            }}
            onRecovery={() => invoke(api.showRecovery({ vaultId: gitVault.id })).catch((e) => setError(e.message))} />}
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
