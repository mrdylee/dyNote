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
import { markdown } from "@codemirror/lang-markdown";
import {
  defaultHighlightStyle,
  syntaxHighlighting,
  bracketMatching,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { suggestNotes } from "../core/knowledge.mjs";

export default function Editor({
  note,
  notes,
  onChange,
  onImportFiles,
  readOnly = false,
}) {
  const host = useRef(null);
  const editor = useRef(null);
  const callback = useRef(onChange);
  const syncing = useRef(false);
  const readonly = useRef(new Compartment());
  const latest = useRef({ note, notes, onImportFiles });
  latest.current = { note, notes, onImportFiles };
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
          markdown(),
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
              callback.current(update.state.doc.toString());
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
  useEffect(() => {
    const view = editor.current;
    if (view && view.state.doc.toString() !== note.content) {
      syncing.current = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: note.content },
      });
      syncing.current = false;
    }
  }, [note.path, note.content]);
  return <div className="code-editor" ref={host} />;
}
