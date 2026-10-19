import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, EditorSelection, Compartment } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { history, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { JSDOM } from "jsdom";
import { livePreview, livePreviewState, wikiSyntax, composition, refreshLivePreview } from "../src/live-preview.mjs";

const context = { path: "Home.md", vaultId: "vault", attachments: [{ path: "assets/a.png" }] };
function state(doc, anchor = doc.length, extra = []) {
  return EditorState.create({ doc, selection: { anchor }, extensions: [
    markdown({ base: markdownLanguage, extensions: [wikiSyntax] }),
    livePreview({ getContext: () => context }), ...extra,
  ] });
}
function ranges(s) {
  const result = [];
  s.field(livePreviewState).decorations.between(0, s.doc.length, (from, to, value) => {
    result.push({ from, to, spec: value.spec, text: s.sliceDoc(from, to) });
  });
  return result;
}
const hidden = (s) => ranges(s).filter((r) => r.to > r.from && !r.spec.class && !r.spec.attributes);

test("selection updates match a fresh render for nested, distant and multiple ranges", () => {
  // RangeSet.between does not promise traversal order across nested layers.
  const snapshot = (s) => ranges(s).map((r) => JSON.stringify(r)).sort();
  const doc = "# **Heading**\n\n**outer *inner*** and [**label**](Guide.md)\n\n- [ ] task\n\n![[assets/a.png]]\n\nHeading\n=======\n\n" + "plain\n".repeat(100) + "*last*\n\nend";
  let s = state(doc, doc.length, [EditorState.allowMultipleSelections.of(true)]);
  const selections = [
    EditorSelection.cursor(doc.indexOf("inner") + 1),
    EditorSelection.cursor(doc.indexOf("label") + 1),
    EditorSelection.cursor(doc.indexOf("last") + 1),
    EditorSelection.range(doc.indexOf("task"), doc.indexOf("=======")),
    EditorSelection.range(0, doc.length),
    EditorSelection.cursor(doc.length),
    EditorSelection.create([EditorSelection.cursor(4), EditorSelection.cursor(doc.indexOf("last"))]),
    EditorSelection.cursor(0),
    ...[...new Set(ranges(s).flatMap(({ from, to }) => [from - 1, from, to, to + 1]))]
      .filter((pos) => pos >= 0 && pos <= doc.length).map((pos) => EditorSelection.cursor(pos)),
  ];
  for (const selection of selections) {
    s = s.update({ selection }).state;
    assert.deepEqual(snapshot(s), snapshot(s.update({ effects: refreshLivePreview.of(null) }).state));
  }
  s = s.update({ changes: { from: 0, insert: "intro\n\n" } }).state;
  s = s.update({ selection: { anchor: s.doc.length } }).state;
  assert.deepEqual(snapshot(s), snapshot(s.update({ effects: refreshLivePreview.of(null) }).state));
});

test("large-document cursor movement costs substantially less than a full preview rebuild", () => {
  const doc = Array.from({ length: 10000 }, (_, i) => `## Note ${i}\n\n**text** *italic* [[Guide|link]]\n\n`).join("");
  let s = state(doc);
  assert.ok(ensureSyntaxTree(s, doc.length, 10000));
  s = s.update({ effects: refreshLivePreview.of(null) }).state;
  function median(specs) {
    const samples = specs.map((spec) => {
      const start = performance.now();
      s = s.update(spec).state;
      return performance.now() - start;
    }).sort((a, b) => a - b);
    return samples[Math.floor(samples.length / 2)];
  }
  const rebuild = median(Array.from({ length: 5 }, () => ({ effects: refreshLivePreview.of(null) })));
  const selection = median(Array.from({ length: 10 }, (_, i) => ({ selection: { anchor: Math.floor((doc.length - 1) * i / 10) } })));
  assert.ok(selection < rebuild / 4, `selection ${selection.toFixed(2)} ms vs rebuild ${rebuild.toFixed(2)} ms`);
});

test("decorations preserve Markdown and reveal only the selected formatted span", () => {
  const doc = "# Title\n\n**bold** and *italic* ~~old~~ `code`\n\nend";
  const s = state(doc);
  assert.deepEqual(hidden(s).map((r) => r.text), ["# ", "**", "**", "*", "*", "~~", "~~", "`", "`"]);
  const editing = s.update({ selection: { anchor: doc.indexOf("bold") + 1 } }).state;
  assert.equal(hidden(editing).filter((r) => r.text === "**").length, 0);
  assert.equal(hidden(editing).filter((r) => r.text === "*").length, 2);
  assert.equal(editing.doc.toString(), doc);
  const selected = s.update({ selection: EditorSelection.range(0, doc.length) }).state;
  assert.equal(hidden(selected).length, 0);
});

test("nested markup reveals its ancestors; code, frontmatter, HTML and tables remain literal", () => {
  const doc = '---\ntitle: "**raw**"\n---\n\n```md\n[[fake]] **raw**\n```\n\n<div>[[fake]]</div>\n\n| a | b |\n| - | - |\n| **raw** | [[fake]] |\n\n**outer *inner***\n\nend';
  const s = state(doc, doc.indexOf("inner") + 1);
  assert.equal(hidden(s).length, 0);
  assert.equal(ranges(s).filter((r) => r.spec.attributes?.["data-live-target"]).length, 0);
  assert.equal(hidden(state("`[[fake]]`\n\nend")).length, 2);
});

test("wiki and Markdown links retain editable labels and safe metadata", () => {
  const doc = '[[Guide|안내]] [문서](Guide.md "title")\n\nend';
  const s = state(doc);
  const links = ranges(s).filter((r) => r.spec.attributes?.["data-live-target"]);
  assert.deepEqual(links.map((r) => [r.text, r.spec.attributes["data-live-target"]]), [["안내", "Guide"], ["문서", "Guide.md"]]);
  assert.deepEqual(hidden(s).map((r) => r.text), ["[[Guide|", "]]", "[", '](Guide.md "title")']);
});

test("BOM frontmatter stays literal and empty wiki aliases display their target", () => {
  const s = state('\uFEFF---\ntitle: "**raw**"\n---\n\n[[Guide| ]]\n\nend');
  assert.equal(hidden(s).some((r) => r.text === "**"), false);
  const link = ranges(s).find((r) => r.spec.attributes?.["data-live-target"]);
  assert.equal(link.text, "Guide");
});

test("setext headings retain heading style outside their editable marker", () => {
  const s = state("Heading\n=======\n\nend");
  assert.ok(ranges(s).some((r) => r.spec.class?.includes("cm-live-h1")));
  assert.deepEqual(hidden(s).map((r) => r.text), ["======="]);
});

test("only resolved local raster images become widgets; remote, SVG and missing images stay source", () => {
  const doc = '![local](assets/a.png) ![[assets/a.png]] ![remote](https://example.org/a.png) ![[a.svg]] ![[missing.png]]\n\nend';
  const s = state(doc);
  const widgets = ranges(s).filter((r) => r.spec.widget?.url);
  assert.equal(widgets.length, 2);
  assert.ok(widgets.every((r) => r.spec.widget.url === "notes://vault/vault/assets/a.png"));
  const selected = s.update({ selection: { anchor: 4 } }).state;
  assert.equal(ranges(selected).filter((r) => r.spec.widget?.url).length, 1);
});

test("composition maps decorations without replacing them until composition ends", () => {
  let s = state("**bold**\n\n한글");
  s = s.update({ effects: composition.of(true) }).state;
  s = s.update({ changes: { from: s.doc.length, insert: "입력" } }).state;
  assert.equal(s.field(livePreviewState).composing, true);
  assert.equal(hidden(s).length, 2);
  s = s.update({ effects: composition.of(false) }).state;
  assert.equal(s.field(livePreviewState).composing, false);
  assert.equal(s.doc.toString(), "**bold**\n\n한글입력");
  s = state("**한글** and *italic*", 3);
  s = s.update({ effects: composition.of(true) }).state;
  s = s.update({ changes: { from: 3, insert: "입력" }, selection: { anchor: 5 } }).state;
  assert.equal(hidden(s).some((r) => r.text === "**"), false);
  s = s.update({ effects: composition.of(false) }).state;
  assert.equal(s.doc.toString(), "**한입력글** and *italic*");
  assert.equal(hidden(s).filter((r) => r.text === "*").length, 2);
});

test("live/source reconfiguration keeps document, selection and undo history", () => {
  const mode = new Compartment();
  let s = EditorState.create({ doc: "**bold**\nend", extensions: [markdown({ base: markdownLanguage }), history(), mode.of(livePreview())] });
  s = s.update({ changes: { from: s.doc.length, insert: "!" }, selection: { anchor: 3 } }).state;
  s = s.update({ effects: mode.reconfigure([]) }).state;
  assert.equal(s.selection.main.head, 3);
  s = s.update({ effects: mode.reconfigure(livePreview()) }).state;
  assert.equal(s.selection.main.head, 3);
  assert.equal(undo({ state: s, dispatch: (tr) => { s = tr.state; } }), true);
  assert.equal(s.doc.toString(), "**bold**\nend");
});

test("checkbox widget clicks are undoable, position-safe after edits, and respect read-only", () => {
  const dom = new JSDOM("<div id='editor'></div>", { pretendToBeVisual: true });
  const globals = ["window", "document", "MutationObserver", "requestAnimationFrame", "cancelAnimationFrame"];
  const original = globals.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  globals.forEach((name) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof dom.window[name] === "function" && name.includes("AnimationFrame") ? dom.window[name].bind(dom.window) : dom.window[name] }));
  let view;
  try {
    const readonly = new Compartment();
    view = new EditorView({ parent: dom.window.document.querySelector("#editor"), state: state("- [ ] task\n\nend", 14, [history(), readonly.of(EditorState.readOnly.of(false))]) });
    view.dom.querySelector("input").click();
    assert.match(view.state.doc.toString(), /^- \[x\]/);
    assert.equal(undo(view), true);
    assert.match(view.state.doc.toString(), /^- \[ \]/);
    view.dispatch({ changes: { from: 0, insert: "intro\n\n" } });
    view.dom.querySelector("input").click();
    assert.match(view.state.doc.toString(), /intro\n\n- \[x\]/);
    view.dispatch({ effects: readonly.reconfigure(EditorState.readOnly.of(true)) });
    assert.equal(view.dom.querySelector("input").disabled, true);
    const before = view.state.doc.toString();
    view.dom.querySelector("input").click();
    assert.equal(view.state.doc.toString(), before);
  } finally {
    view?.destroy(); dom.window.close();
    globals.forEach((name, i) => original[i] ? Object.defineProperty(globalThis, name, original[i]) : delete globalThis[name]);
  }
});
