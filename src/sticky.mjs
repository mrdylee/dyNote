import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Transaction } from "@codemirror/state";
import { EditorView, drawSelection, keymap } from "@codemirror/view";
import { rewriteLinks } from "../core/links.mjs";
import { stickyTitle } from "../core/sticky-title.mjs";
import { changedRange } from "./copilotEdits.mjs";
import { journalOutline, startJournalBullet } from "./journal-outline.mjs";
import { livePreview, wikiSyntax } from "./live-preview.mjs";
import "./sticky.css";
import "./journal-outline.css";

const pin = document.querySelector("#pin");
const title = document.querySelector("header span");
const status = document.querySelector("#status");
const updatePin = pinned => pin.setAttribute("aria-pressed", String(pinned));
const updateTitle = content => {
  const text = stickyTitle(content);
  if (title.textContent !== text) title.textContent = text;
};

document.querySelector("#close").addEventListener("click", () => window.sticky.close());
pin.addEventListener("click", () => window.sticky.pin());
window.sticky.onPinned(updatePin);
window.sticky.onStatus(message => {
  status.textContent = message;
});

const initial = await window.sticky.state();
document.body.dataset.color = initial.color;
updatePin(initial.pinned === true);
updateTitle(initial.content);

const lineBreak = initial.content.match(/\r\n|\r|\n/)?.[0] ?? "\n";
let moveVersion = 0;
const publish = state => {
  const content = state.doc.sliceString(0, state.doc.length, lineBreak);
  updateTitle(content);
  window.sticky.edit(content, moveVersion);
};
const view = new EditorView({
  parent: document.querySelector("#memo"),
  doc: initial.content || "- ",
  extensions: [
    history(),
    drawSelection(),
    markdown({ base: markdownLanguage, extensions: [wikiSyntax] }),
    livePreview({ onLink: (target, kind) => window.sticky.openLink(target, kind, moveVersion) }),
    journalOutline({ live: true }),
    EditorView.lineWrapping,
    keymap.of([{ key: "Enter", run: startJournalBullet }, ...defaultKeymap, ...historyKeymap, indentWithTab]),
    EditorView.contentAttributes.of({ "aria-label": "Sticky Note 메모", spellcheck: "false" }),
    EditorView.updateListener.of(({ docChanged, state }) => {
      if (docChanged) publish(state);
    }),
  ],
});
window.sticky.onMoved(({ from, to, files, version }) => {
  moveVersion = version;
  const before = view.state.doc.toString();
  const after = rewriteLinks(before, from, from, to, files);
  const change = changedRange(before, after);
  if (change) {
    const tail = after.length - change.to;
    view.dispatch({
      changes: { from: change.from, to: before.length - tail, insert: after.slice(change.from, change.to) },
      annotations: Transaction.addToHistory.of(false),
    });
  } else publish(view.state);
});
view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true });
view.focus();
