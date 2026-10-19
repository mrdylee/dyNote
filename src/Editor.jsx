import { useEffect, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  defaultHighlightStyle,
  syntaxHighlighting,
  bracketMatching,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { suggestNotes } from "../core/knowledge.mjs";
import { headingId } from "../core/headings.mjs";
import { livePreview, refreshLivePreview, wikiSyntax } from "./live-preview.mjs";

export default function Editor({
  note,
  notes,
  onChange,
  onImportFiles,
  live = false,
  vaultId,
  attachments,
  onLink,
  jump,
  readOnly = false,
  fontSettings,
}) {
  const host = useRef(null);
  const editor = useRef(null);
  const callback = useRef(onChange);
  const lineBreak = useRef("\n");
  // CodeMirror keeps normalized offsets internally; disk content retains the
  // file's line endings, including when all existing newlines are deleted.
  lineBreak.current = note.content.match(/\r\n|\r|\n/)?.[0] ?? lineBreak.current;
  const syncing = useRef(false);
  const readonly = useRef(new Compartment());
  const rendering = useRef(new Compartment());
  const latest = useRef(null);
  latest.current = { note, notes, onImportFiles, vaultId, attachments, onLink };
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
          syntaxHighlighting(defaultHighlightStyle),
          EditorView.lineWrapping,
          keymap.of([
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
          }),
        ],
      }),
    });
    editor.current = view;
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
        target.dispatch({
          changes: {
            from: target.state.selection.main.head,
            insert: "\n" + text + "\n",
          },
        });
      } catch {
        /* The parent reports import errors. */
      }
    }
    return () => {
      view.destroy();
      editor.current = null;
    };
  }, []);
  useEffect(() => {
    editor.current?.dispatch({
      effects: readonly.current.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);
  useEffect(() => { editor.current?.requestMeasure(); }, [fontSettings]);
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
      });
      syncing.current = false;
    }
  }, [note.path, note.content]);
  useEffect(() => {
    if (!jump || jump.path !== note.path) return;
    let fragment;
    try { fragment = decodeURIComponent(jump.fragment); } catch { return; }
    const heading = note.headings?.find((h) => h.text === fragment || h.plainText === fragment || h.id === fragment || headingId(h.plainText) === fragment);
    const view = editor.current;
    if (view && heading) {
      const line = view.state.doc.line(Math.min(view.state.doc.lines, heading.line + 1));
      view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
      view.focus();
    }
  }, [jump, note.path]);
  return <div className="code-editor" ref={host} />;
}
