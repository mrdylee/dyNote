import { useEffect, useRef, useState } from "react";
import { EditorState, Compartment, Transaction } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
  Decoration,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  undo,
  redo,
  indentWithTab,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  defaultHighlightStyle,
  syntaxHighlighting,
  bracketMatching,
  foldGutter,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { suggestNotes } from "../core/knowledge.mjs";
import { changedRange } from "./copilotEdits.mjs";
import { headingId } from "../core/headings.mjs";
import { livePreview, refreshLivePreview, wikiSyntax } from "./live-preview.mjs";
import { outlineFolding, runOutlineCommand, runMarkdownFormat, runTextColor, runBulletFormat } from "./editorCommands.mjs";
import { journalOutline, journalInsertAttachments, addJournalBlock } from "./journal-outline.mjs";
import { applyOutlineRegion, selectedOutlineRegion } from "./outline-regions.mjs";

export default function Editor({
  note,
  notes,
  onChange,
  onImportFiles,
  live = false,
  journal = false,
  vaultId,
  attachments,
  onLink,
  jump,
  readOnly = false,
  fontSettings,
  onFontSettings,
  onSelection,
  editorRef,
  pendingOriginal,
}) {
  const [textColor, setTextColor] = useState("#c62828");
  const [regionSelection, setRegionSelection] = useState({ selected: false, active: false });
  const [regionMode, setRegionMode] = useState("normal");
  const [regionNotice, setRegionNotice] = useState("");
  function trackRegionSelection(state) {
    const selected = !state.selection.main.empty, active = !!selectedOutlineRegion(state);
    setRegionSelection(previous => previous.selected === selected && previous.active === active ? previous : { selected, active });
  }
  const host = useRef(null);
  const editor = useRef(null);
  const callback = useRef(onChange);
  const lineBreak = useRef("\n");
  // CodeMirror keeps normalized offsets internally; disk content retains the
  // file's line endings, including when all existing newlines are deleted.
  lineBreak.current = note.content.match(/\r\n|\r|\n/)?.[0] ?? lineBreak.current;
  const syncing = useRef(false);
  const wasPending = useRef(false);
  const readonly = useRef(new Compartment());
  const rendering = useRef(new Compartment());
  const outlining = useRef(new Compartment());
  const pendingMarks = useRef(new Compartment());
  const latest = useRef(null);
  latest.current = { note, notes, onImportFiles, vaultId, attachments, onLink, onSelection };
  const liveExtensions = () => livePreview({
    getContext: () => ({ path: latest.current.note.path, vaultId: latest.current.vaultId, attachments: latest.current.attachments }),
    onLink: (target, kind) => latest.current.onLink?.(target, kind),
  });
  callback.current = onChange;
  useEffect(() => {
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: note.content,
        extensions: [
          lineNumbers(),
          outlineFolding,
          foldGutter(),
          pendingMarks.current.of([]),
          readonly.current.of(EditorState.readOnly.of(readOnly)),
          history(),
          drawSelection(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          bracketMatching(),
          markdown({ base: markdownLanguage, extensions: [wikiSyntax] }),
          rendering.current.of(live ? liveExtensions() : []),
          autocompletion({
            override: [
              (context) => {
                const match = context.matchBefore(/\[\[[^\]\n]*/);
                if (!match) return null;
                return {
                  from: match.from + 2,
                  filter: false,
                  options: suggestNotes(
                    latest.current.notes ?? [],
                    match.text.slice(2),
                  ).map((item) => ({
                    label: item.label,
                    detail: item.detail,
                    type: "text",
                    apply: (view, _completion, from, to) => {
                      const close =
                        view.state.sliceDoc(to, to + 2) === "]]" ? "" : "]]";
                      view.dispatch({
                        changes: { from, to, insert: item.insert + close },
                        selection: { anchor: from + item.insert.length + 2 },
                      });
                    },
                  })),
                };
              },
            ],
          }),
          outlining.current.of(journalOutline({ journal, live })),
          syntaxHighlighting(defaultHighlightStyle),
          EditorView.lineWrapping,
          keymap.of([
            { key: "Mod-b", run: view => runMarkdownFormat(view, "bold") },
            { key: "Mod-i", run: view => runMarkdownFormat(view, "italic") },
            { key: "Mod-Shift-x", run: view => runMarkdownFormat(view, "strike") },
            { key: "Mod-e", run: view => runMarkdownFormat(view, "code") },
            { key: "Alt-ArrowUp", run: view => runOutlineCommand(view, "up") },
            { key: "Alt-ArrowDown", run: view => runOutlineCommand(view, "down") },
            { key: "Tab", run: view => runOutlineCommand(view, "indent") },
            { key: "Shift-Tab", run: view => runOutlineCommand(view, "outdent") },
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            ...completionKeymap,
            indentWithTab,
          ]),
          EditorView.domEventHandlers({
            paste: (event, view) => {
              if (view.state.readOnly) return false;
              const files = [...(event.clipboardData?.files ?? [])];
              if (!files.length) return false;
              event.preventDefault();
              importFiles(files, view);
              return true;
            },
            drop: (event, view) => {
              if (view.state.readOnly) return false;
              const files = [...(event.dataTransfer?.files ?? [])];
              if (!files.length) return false;
              event.preventDefault();
              importFiles(files, view);
              return true;
            },
          }),
          EditorView.contentAttributes.of({
            "aria-label": "Markdown 편집기",
            spellcheck: "false",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncing.current)
              callback.current(update.state.doc.sliceString(0, update.state.doc.length, lineBreak.current));
            if (update.selectionSet || update.docChanged) {
              trackRegionSelection(update.state);
              const { from, to } = update.state.selection.main;
              if (from === to) {
                latest.current.onSelection?.(null);
                return;
              }
              const doc = update.state.doc, eol = lineBreak.current;
              latest.current.onSelection?.({
                path: latest.current.note.path,
                source: doc.sliceString(0, doc.length, eol),
                from: doc.sliceString(0, from, eol).length,
                to: doc.sliceString(0, to, eol).length,
              });
            }
          }),
        ],
      }),
    });
    editor.current = view;
    trackRegionSelection(view.state);
    if (editorRef) editorRef.current = view;
    latest.current.onSelection?.(null);
    async function importFiles(files, target) {
      const path = latest.current.note.path;
      try {
        const assets = await latest.current.onImportFiles(files);
        if (latest.current.note.path !== path || target !== editor.current)
          return;
        const text = assets
          .map(
            (asset) =>
              `${/\.pdf$/i.test(asset.path) ? "" : "!"}[[${asset.path}]]`,
          )
          .join("\n");
        if (journalInsertAttachments(target, text)) return;
        const from = target.state.selection.main.head, inserted = "\n" + text + "\n";
        target.dispatch({ changes: { from, insert: inserted }, selection: { anchor: from + inserted.length } });
      } catch {
        /* The parent reports import errors. */
      }
    }
    return () => {
      view.destroy();
      editor.current = null;
      if (editorRef?.current === view) editorRef.current = null;
    };
  }, []);
  useEffect(() => window.notes?.onFormatEditor?.((format, point) => {
    const view = editor.current;
    if (!view || view.state.readOnly) return;
    if (format === "bullet-list" || format === "paragraph") {
      if (!point) {
        if (view.hasFocus) runBulletFormat(view, format);
        return;
      }
      if (!view.contentDOM.contains(view.dom.ownerDocument.elementFromPoint(point.x, point.y))) return;
      const position = view.posAtCoords(point, false);
      if (position != null) runBulletFormat(view, format, position);
      return;
    }
    if (!view.hasFocus) return;
    if (format === "undo") undo(view);
    else if (format === "redo") redo(view);
    else runMarkdownFormat(view, format);
  }), []);
  useEffect(() => {
    editor.current?.dispatch({
      effects: readonly.current.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);
  useEffect(() => { editor.current?.requestMeasure(); }, [fontSettings]);
  useEffect(() => { editor.current?.dispatch({ effects: outlining.current.reconfigure(journalOutline({ journal, live })) }); }, [journal, live]);
  useEffect(() => { setRegionMode(regionSelection.active ? "journal" : "normal"); }, [regionSelection.active, note.path]);
  useEffect(() => { setRegionNotice(""); }, [note.path]);
  useEffect(() => {
    const view = editor.current;
    if (!view) return;
    const area = host.current.closest(".document-area");
    const bounds = area?.getBoundingClientRect();
    const anchor = bounds && view.posAtCoords({ x: view.contentDOM.getBoundingClientRect().left + 24, y: bounds.top + 24 }, false);
    const top = anchor != null ? view.coordsAtPos(anchor)?.top : null;
    view.dispatch({ effects: [rendering.current.reconfigure(live ? liveExtensions() : []), view.scrollSnapshot()] });
    if (area && top != null) view.requestMeasure({
      read: () => view.coordsAtPos(anchor)?.top,
      write: (next) => { if (next != null) area.scrollTop += next - top; },
    });
  }, [live]);
  useEffect(() => {
    if (live) editor.current?.dispatch({ effects: refreshLivePreview.of(null) });
  }, [attachments, vaultId]);
  useEffect(() => {
    const view = editor.current;
    if (view && view.state.doc.sliceString(0, view.state.doc.length, lineBreak.current) !== note.content) {
      syncing.current = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: note.content },
        annotations: Transaction.addToHistory.of(pendingOriginal === undefined && !wasPending.current),
      });
      syncing.current = false;
    }
    wasPending.current = pendingOriginal !== undefined;
  }, [note.path, note.content, pendingOriginal]);
  useEffect(() => {
    const view = editor.current;
    if (!view) return;
    const range = pendingOriginal === undefined ? null : changedRange(pendingOriginal.replace(/\r\n|\r/g, "\n"), view.state.doc.toString());
    const marks = [];
    if (range) {
      const first = view.state.doc.lineAt(range.from).number, last = view.state.doc.lineAt(Math.min(range.to, view.state.doc.length)).number;
      for (let number = first; number <= last; number++) marks.push(Decoration.line({ class: "cm-copilot-pending" }).range(view.state.doc.line(number).from));
    }
    view.dispatch({ effects: pendingMarks.current.reconfigure(EditorView.decorations.of(Decoration.set(marks))) });
  }, [pendingOriginal, note.content]);
  useEffect(() => {
    if (!jump || jump.path !== note.path) return;
    let lineNumber = jump.heading?.line;
    if (lineNumber === undefined) {
      let fragment;
      try { fragment = decodeURIComponent(jump.fragment); } catch { return; }
      const heading = note.headings?.find((h) => h.text === fragment || h.plainText === fragment || h.id === fragment || headingId(h.plainText) === fragment);
      lineNumber = heading?.line;
    }
    const view = editor.current;
    if (view && lineNumber !== undefined) {
      const line = view.state.doc.line(Math.min(view.state.doc.lines, lineNumber + 1));
      view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
      view.focus();
    }
  }, [jump, note.path]);
  return <div className="code-editor">
    {journal && <div className="journal-outline-toolbar" role="toolbar" aria-label="저널 블록 작성">
      <span>Enter 새 블록 · Tab 하위 · Shift+Tab 상위 · Shift+Enter 줄바꿈</span>
      <button type="button" disabled={readOnly} onMouseDown={event => event.preventDefault()} onClick={() => addJournalBlock(editor.current)}>저널 블록 추가</button>
      <button type="button" disabled={readOnly} onMouseDown={event => event.preventDefault()} onClick={() => runOutlineCommand(editor.current, "fold")}>하위 블록 접기</button>
      <button type="button" disabled={readOnly} onMouseDown={event => event.preventDefault()} onClick={() => runOutlineCommand(editor.current, "unfold")}>하위 블록 펼치기</button>
    </div>}
    {!journal && <div className="outline-region-toolbar" role="toolbar" aria-label="구간 편집 설정">
      <label>구간 편집 <select aria-label="선택 구간 편집 방식" value={regionMode} disabled={readOnly} onChange={event => { setRegionMode(event.target.value); setRegionNotice(""); }}>
        <option value="normal">일반 편집</option>
        <option value="journal">저널식 편집 (Bullet Threading)</option>
      </select></label>
      <button type="button" disabled={readOnly || (!regionSelection.selected && !regionSelection.active)} onMouseDown={event => event.preventDefault()} onClick={() => {
        if (regionMode === (regionSelection.active ? "journal" : "normal")) { setRegionNotice("현재 구간에 적용된 편집 방식입니다."); return; }
        if (applyOutlineRegion(editor.current, regionMode)) setRegionNotice("");
        else setRegionNotice("하나의 구간을 선택해 주세요. 코드·속성의 일부나 기존 구간을 가로지르는 선택은 적용할 수 없습니다.");
      }}>선택 구간에 적용</button>
      <span>드래그로 구간 선택 · 저널식 편집은 문단을 불릿 블록으로 바꿉니다.</span>
      {regionNotice && <span role="status">{regionNotice}</span>}
    </div>}
    <div className="format-toolbar" role="toolbar" aria-label="Markdown 서식">
      {[["bold", "굵게", "B"], ["italic", "기울임", "I"], ["strike", "취소선", "S"], ["code", "인라인 코드", "</>"]].map(([format, label, text]) =>
        <button key={format} className={`format-${format}`} type="button" aria-label={label} title={label} disabled={readOnly}
          onMouseDown={event => event.preventDefault()} onClick={() => runMarkdownFormat(editor.current, format)}>{text}</button>)}
      <label className="text-color-picker">글자 색상<input aria-label="글자 색상" type="color" value={textColor} disabled={readOnly}
        onInput={event => setTextColor(event.currentTarget.value)} /></label>
      <button type="button" aria-label="글자 색상 적용" disabled={readOnly} onMouseDown={event => event.preventDefault()} onClick={() => runTextColor(editor.current, textColor)}>색상 적용</button>
      <button type="button" aria-label="글자 색상 지우기" disabled={readOnly} onMouseDown={event => event.preventDefault()} onClick={() => runTextColor(editor.current, null)}>기본색</button>
      <button type="button" onClick={onFontSettings}>글꼴·크기</button>
    </div>
    <div className="editor-host" ref={host} />
  </div>;
}
