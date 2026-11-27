import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { textSizeOptions } from "../core/text-size-options.mjs";
import { runSelectionOrLine } from "./format-line.mjs";
import { selectionToolbar } from "./selection-toolbar.mjs";
import AiSuggestion from "./AiSuggestion.jsx";
import TextColorPicker, { textColorPresets } from "./TextColorPicker.jsx";
import { EditorState, Compartment, Transaction } from "@codemirror/state";
import {
  EditorView,
  keymap,
  panels,
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
import { fenceLanguage, fenceHighlighter } from "../core/code-highlighting.mjs";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  defaultHighlightStyle,
  syntaxHighlighting,
  syntaxTree,
  bracketMatching,
  foldGutter,
} from "@codemirror/language";
import { openSearchPanel, search, searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { suggestNotes } from "../core/knowledge.mjs";
import { changedRange } from "./copilotEdits.mjs";
import { headingId } from "../core/headings.mjs";
import { livePreview, refreshLivePreview, wikiSyntax } from "./live-preview.mjs";
import { outlineFolding, runOutlineCommand, runMarkdownFormat, runTextColor, runTextSize, runHighlight, runBulletFormat, contextSelectionContains } from "./editorCommands.mjs";
import { journalOutline, journalInsertAttachments, addJournalBlock } from "./journal-outline.mjs";
import { applyOutlineRegion, selectedOutlineRegion } from "./outline-regions.mjs";

let lastAppliedTextColor = null;

function applyFormat(view, format, color) {
  return runSelectionOrLine(view, target => {
    const size = textSizeOptions.find(option => option.id === format);
    if (format === "highlight" || format === "clear-highlight") return runHighlight(target, format === "highlight");
    if (size) return runTextSize(target, size.value);
    if (format === "clear-color") return runTextColor(target, null);
    if (format === "apply-color") {
      const applied = runTextColor(target, color);
      if (applied) lastAppliedTextColor = color;
      return applied;
    }
    return runMarkdownFormat(target, format);
  });
}

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
  searchHost,
  pendingOriginal,
}) {
  const [suggestion, setSuggestion] = useState(null);
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
  const beforeContextMenu = useRef(null);
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
  useLayoutEffect(() => {
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
          search({ top: true }),
          panels({ topContainer: searchHost?.current }),
          EditorState.phrases.of({
            Find: "문서에서 찾기", next: "다음", previous: "이전", all: "모두 선택",
            "match case": "대소문자 구분", "by word": "단어 단위", regexp: "정규식",
            Replace: "바꿀 내용", replace: "바꾸기", "replace all": "모두 바꾸기", close: "닫기",
            "current match": "현재 일치 항목", "on line": "줄 번호",
          }),
          highlightSelectionMatches(),
          bracketMatching(),
          markdown({ base: markdownLanguage, extensions: [wikiSyntax], codeLanguages: fenceLanguage }),
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
          syntaxHighlighting(fenceHighlighter),
          EditorView.lineWrapping,
          selectionToolbar((view, format, color) => {
            if (color) setTextColor(color);
            return applyFormat(view, format, color);
          }, textColorPresets),
          keymap.of([
            { key: "Mod-b", run: view => runMarkdownFormat(view, "bold") },
            { key: "Mod-i", run: view => runMarkdownFormat(view, "italic") },
            { key: "Mod-Shift-x", run: view => runMarkdownFormat(view, "strike") },
            { key: "Mod-e", run: view => runMarkdownFormat(view, "code") },
            { key: "Mod-Shift-h", run: view => !!lastAppliedTextColor && applyFormat(view, "apply-color", lastAppliedTextColor) },
            { key: "Alt-ArrowUp", run: view => runOutlineCommand(view, "up") },
            { key: "Alt-ArrowDown", run: view => runOutlineCommand(view, "down") },
            { key: "Tab", run: view => runOutlineCommand(view, "indent") },
            { key: "Shift-Tab", run: view => runOutlineCommand(view, "outdent") },
            { key: "Ctrl-f", run: openSearchPanel },
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            ...completionKeymap,
            indentWithTab,
          ]),
          EditorView.domEventHandlers({
            pointerdown: (event, view) => {
              // macOS can select the word under the pointer before the native menu opens.
              beforeContextMenu.current = event.button === 2 || (event.button === 0 && event.ctrlKey)
                ? { doc: view.state.doc, selection: view.state.selection } : null;
              return false;
            },
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
              `${/\.(pdf|xlsx|pptx)$/i.test(asset.path) ? "" : "!"}[[${asset.path}]]`,
          )
          .join("\n");
        const { state } = target;
        let from = state.selection.main.head;
        // Keep the link under the caret intact, including an image nested inside a link.
        for (let node = syntaxTree(state).resolveInner(from, -1); node; node = node.parent) {
          if (["WikiLink", "WikiEmbed", "Link", "Image"].includes(node.name)) from = node.to;
        }
        if (journalInsertAttachments(target, text, from)) return;
        const inserted = "\n" + text + "\n";
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
    if (!view || view.state.readOnly || view.composing) return;
    if (format === "undo" || format === "redo") {
      if (view.hasFocus) (format === "undo" ? undo : redo)(view);
      return;
    }
    let position;
    if (point) {
      if (!view.contentDOM.contains(view.dom.ownerDocument.elementFromPoint(point.x, point.y))) return;
      position = view.posAtCoords(point, false);
      if (position == null) return;
    } else if (!view.hasFocus) return;
    if (format === "bullet-list" || format === "paragraph") {
      runBulletFormat(view, format, position);
      return;
    }
    if (position != null) {
      const saved = beforeContextMenu.current;
      beforeContextMenu.current = null;
      const selection = saved?.doc === view.state.doc ? saved.selection : view.state.selection;
      const inside = selection.ranges.some(range => contextSelectionContains(view.state.doc, range, position));
      if (!inside) view.dispatch({ selection: { anchor: position } });
      else if (!selection.eq(view.state.selection)) view.dispatch({ selection });
    }
    if (format === "ai-suggestion") {
      let range;
      runSelectionOrLine(view, target => {
        if (target.state.selection.ranges.length === 1) range = target.state.selection.main;
        return true;
      });
      setSuggestion({ id: crypto.randomUUID(), path: latest.current.note.path, vaultId: latest.current.vaultId,
        doc: view.state.doc, from: range?.from, to: range?.to });
      return;
    }
    applyFormat(view, format, textColor);
  }), [textColor]);
  useEffect(() => {
    editor.current?.dispatch({
      effects: readonly.current.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);
  useEffect(() => { editor.current?.requestMeasure(); }, [fontSettings]);
  useEffect(() => { editor.current?.dispatch({ effects: outlining.current.reconfigure(journalOutline({ journal, live })) }); }, [journal, live]);
  useEffect(() => { setRegionMode(regionSelection.active ? "journal" : "normal"); }, [regionSelection.active, note.path]);
  useEffect(() => { setRegionNotice(""); }, [note.path]);
  useLayoutEffect(() => {
    const view = editor.current;
    if (!view) return;
    view.dispatch({ effects: rendering.current.reconfigure(live ? liveExtensions() : []) });
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
      view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 52 }) });
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
      <span className="format-target">{regionSelection.selected ? "선택 영역" : "현재 줄"}</span>
      {[["bold", "굵게", "B"], ["italic", "기울임", "I"], ["strike", "취소선", "S"], ["code", "인라인 코드", "</>"]].map(([format, label, text]) =>
        <button key={format} className={`format-${format}`} type="button" aria-label={label} title={label} disabled={readOnly}
          onMouseDown={event => event.preventDefault()} onClick={() => applyFormat(editor.current, format)}>{text}</button>)}
      <select aria-label="글자 크기 적용" title="현재 줄 또는 선택 영역의 글자 크기" value="" disabled={readOnly}
        onChange={event => applyFormat(editor.current, event.target.value)}>
        <option value="" disabled>글자 크기</option>
        {textSizeOptions.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
      </select>
      <TextColorPicker value={textColor} onChange={setTextColor} disabled={readOnly} />
      <button type="button" aria-label="글자 색상 적용" disabled={readOnly} onMouseDown={event => event.preventDefault()} title="마지막 글자색 반복 · Ctrl/Cmd+Shift+H" onClick={() => applyFormat(editor.current, "apply-color", textColor)}>색상 적용</button>
      <button type="button" aria-label="글자 색상 지우기" disabled={readOnly} onMouseDown={event => event.preventDefault()} onClick={() => applyFormat(editor.current, "clear-color")}>기본색</button>
      <button type="button" disabled={readOnly} onMouseDown={event => event.preventDefault()} onClick={() => applyFormat(editor.current, "highlight")}>노란 형광펜</button>
      <button type="button" disabled={readOnly} onMouseDown={event => event.preventDefault()} onClick={() => applyFormat(editor.current, "clear-highlight")}>형광펜 지우기</button>
      <button type="button" title="앱 전체의 글꼴과 크기 설정" onClick={onFontSettings}>글꼴·크기</button>
    </div>
    <div className="editor-host" ref={host} />
    {suggestion && suggestion.path === note.path && suggestion.vaultId === vaultId && <AiSuggestion key={suggestion.id}
      target={suggestion} editor={editor.current} readOnly={readOnly} onClose={() => setSuggestion(null)} />}
  </div>;
}
