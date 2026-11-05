import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorView, drawSelection, keymap } from "@codemirror/view";
import { journalOutline } from "./journal-outline.mjs";
import { livePreview, wikiSyntax } from "./live-preview.mjs";
import "./sticky.css";
import "./journal-outline.css";

const pin = document.querySelector("#pin");
const status = document.querySelector("#status");
const updatePin = pinned => pin.setAttribute("aria-pressed", String(pinned));

document.querySelector("#close").addEventListener("click", () => window.sticky.close());
pin.addEventListener("click", () => window.sticky.pin());
window.sticky.onPinned(updatePin);
window.sticky.onStatus(({ message, error }) => {
  status.textContent = message;
  status.classList.toggle("error", error);
});

const initial = await window.sticky.state();
document.body.dataset.color = initial.color;
updatePin(initial.pinned === true);
status.textContent = initial.saved ? "저장됨" : "";

const lineBreak = initial.content.match(/\r\n|\r|\n/)?.[0] ?? "\n";
const view = new EditorView({
  parent: document.querySelector("#memo"),
  doc: initial.content || "- ",
  extensions: [
    history(),
    drawSelection(),
    markdown({ base: markdownLanguage, extensions: [wikiSyntax] }),
    livePreview(),
    journalOutline({ live: true }),
    EditorView.lineWrapping,
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    EditorView.contentAttributes.of({ "aria-label": "포스트잇 메모", spellcheck: "false" }),
    EditorView.updateListener.of(({ docChanged, state }) => {
      if (docChanged) window.sticky.edit(state.doc.sliceString(0, state.doc.length, lineBreak));
    }),
  ],
});
view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true });
view.focus();
