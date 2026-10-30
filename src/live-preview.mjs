import { colorInlineParser, readColorSpan } from "../core/text-color.mjs";
import { Facet, RangeSet, RangeValue, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import MarkdownIt from "markdown-it";
import { attachmentUrl } from "../core/knowledge.mjs";

const { unescapeAll } = new MarkdownIt().utils;

// This grammar participates in Markdown parsing, so escaped brackets and code
// never become wiki links through a second, unrelated regex pass.
export const wikiSyntax = {
  defineNodes: ["WikiLink", "WikiEmbed", "TextColor", "ColorMark"],
  parseInline: [{
    name: "WikiLink", before: "Link",
    parse(cx, next, pos) {
      if (next !== 91 && next !== 33) return -1;
      const match = /^(!?)\[\[([^\]\n]+)\]\]/.exec(cx.slice(pos, cx.end));
      return match ? cx.addElement(cx.elt(match[1] ? "WikiEmbed" : "WikiLink", pos, pos + match[0].length)) : -1;
    },
  }, colorInlineParser],
};

const config = Facet.define({ combine: (values) => values[0] ?? {} });
export const composition = StateEffect.define();
export const refreshLivePreview = StateEffect.define();
const formatting = { StrongEmphasis: "strong", Emphasis: "emphasis", Strikethrough: "strike", InlineCode: "code" };
const literal = new Set(["FencedCode", "CodeBlock", "HTMLBlock", "HTMLTag", "Table", "LinkReference"]);

function selected(state, from, to) {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

function linkInfo(state, node) {
  const text = state.sliceDoc(node.from, node.to);
  if (node.name === "WikiLink" || node.name === "WikiEmbed") {
    const offset = node.name === "WikiEmbed" ? 3 : 2;
    const body = text.slice(offset, -2), pipe = body.indexOf("|");
    const target = (pipe < 0 ? body : body.slice(0, pipe)).trim();
    const hasAlias = pipe >= 0 && body.slice(pipe + 1).trim().length > 0;
    const from = node.from + offset + (hasAlias ? pipe + 1 : 0);
    const to = !hasAlias && pipe >= 0 ? node.from + offset + pipe : node.to - 2;
    return { target, kind: "wiki", from, to };
  }
  const url = node.getChild("URL");
  const marks = node.getChildren("LinkMark");
  if (!url || marks.length < 2) return null; // Reference links stay source in phase 1.
  return { target: unescapeAll(state.sliceDoc(url.from, url.to).replace(/^<|>$/g, "")), kind: "markdown", from: marks[0].to, to: marks[1].from };
}

class Bullet extends WidgetType {
  eq() { return true; }
  toDOM(view) {
    const span = view.dom.ownerDocument.createElement("span");
    span.className = "cm-live-bullet";
    span.textContent = "•";
    return span;
  }
}

class Checkbox extends WidgetType {
  constructor(checked, disabled) { super(); this.checked = checked; this.disabled = disabled; }
  eq(other) { return this.checked === other.checked && this.disabled === other.disabled; }
  toDOM(view) {
    const input = view.dom.ownerDocument.createElement("input");
    input.type = "checkbox";
    input.className = "cm-live-checkbox";
    input.checked = this.checked;
    input.disabled = this.disabled;
    input.setAttribute("aria-label", "할 일 완료");
    input.addEventListener("mousedown", (event) => event.preventDefault());
    input.addEventListener("click", (event) => {
      event.preventDefault();
      if (view.state.readOnly) return;
      const from = view.posAtDOM(input);
      if (!/^\[[ xX]\]$/.test(view.state.sliceDoc(from, from + 3))) return;
      view.dispatch({ changes: { from: from + 1, to: from + 2, insert: this.checked ? " " : "x" }, userEvent: "input.task" });
    });
    return input;
  }
  ignoreEvent() { return true; }
}

class ImagePreview extends WidgetType {
  constructor(url, label) { super(); this.url = url; this.label = label; }
  eq(other) { return this.url === other.url && this.label === other.label; }
  toDOM(view) {
    const image = view.dom.ownerDocument.createElement("img");
    image.className = "cm-live-image";
    image.src = this.url;
    image.alt = this.label;
    image.title = "클릭하여 이미지 Markdown 편집";
    image.addEventListener("load", () => view.requestMeasure());
    image.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: view.posAtDOM(image) }, scrollIntoView: true });
      view.focus();
    });
    return image;
  }
  ignoreEvent() { return true; }
}

class RevealRegion extends RangeValue {
  constructor(replacements) { super(); this.replacements = replacements; }
}

function decorate(state) {
  const ranges = [], reveals = [], options = state.facet(config), context = options.getContext?.() ?? {};
  const source = state.doc.toString();
  const frontmatter = /^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(source)?.[0].length ?? 0;
  const mark = (from, to, name, attributes) => { if (to > from) ranges.push(Decoration.mark({ class: `cm-live-${name}`, attributes }).range(from, to)); };
  syntaxTree(state).iterate({ enter(ref) {
    const node = ref.node, { name, from, to } = node;
    if (to <= frontmatter) return false;
    if (name === "FencedCode" || name === "CodeBlock") {
      const last = state.doc.lineAt(Math.max(from, to - 1)).number;
      for (let line = state.doc.lineAt(from).number; line <= last; line++)
        ranges.push(Decoration.line({ class: "cm-live-code-block" }).range(state.doc.line(line).from));
      return false;
    }
    if (literal.has(name)) return false;
    if (name === "Blockquote" && /^>\s*\[!/.test(state.sliceDoc(from, to))) return false;
    const replacements = [];
    const hide = (from, to, widget) => { if (to > from) replacements.push(Decoration.replace({ widget }).range(from, to)); };
    const finish = (skipChildren = false) => {
      if (replacements.length) {
        reveals.push(new RevealRegion(replacements).range(from, to));
        if (!selected(state, from, to)) ranges.push(...replacements);
      }
      if (skipChildren) return false;
    };
    if (name === "TextColor") {
      const span = readColorSpan(source, from);
      if (span) {
        mark(span.contentFrom, span.contentTo, "color", { style: `color:${span.color}` });
        hide(from, span.contentFrom); hide(span.contentTo, to);
      }
    } else if (formatting[name]) {
      mark(from, to, formatting[name]);
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (/^(?:Emphasis|Strikethrough|Code)Mark$/.test(child.name)) hide(child.from, child.to);
      }
      if (name === "InlineCode") return finish(true);
    } else if (/^(?:ATX|Setext)Heading[1-6]$/.test(name)) {
      ranges.push(Decoration.line({ class: `cm-live-heading cm-live-h${name.at(-1)}` }).range(state.doc.lineAt(from).from));
      const marker = node.getChild("HeaderMark");
      if (marker) hide(marker.from, marker.to + (state.sliceDoc(marker.to, marker.to + 1) === " " ? 1 : 0));
      const closing = node.getChildren("HeaderMark")[1];
      if (closing) hide(closing.from, closing.to);
    } else if (name === "ListMark" && /^[-+*]$/.test(state.sliceDoc(from, to))) {
      hide(from, to, node.parent.getChild("Task") ? undefined : new Bullet());
    } else if (name === "TaskMarker") {
      hide(from, to, new Checkbox(/x/i.test(state.sliceDoc(from, to)), state.readOnly));
    } else if (["Link", "Image", "WikiLink", "WikiEmbed"].includes(name)) {
      const link = linkInfo(state, node);
      if (!link) return false;
      if (name === "Image" || name === "WikiEmbed") {
        const url = /\.(?:png|jpe?g|gif|webp)(?:[#?]|$)/i.test(link.target)
          ? attachmentUrl(link.target, context.path, context.attachments ?? [], context.vaultId, link.kind) : null;
        if (url) hide(from, to, new ImagePreview(url, state.sliceDoc(link.from, link.to)));
        return finish(true);
      }
      mark(link.from, link.to, "link", { "data-live-target": link.target, "data-live-kind": link.kind, title: "⌘/Ctrl+클릭으로 링크 열기 · 커서에서 ⌘/Ctrl+Enter" });
      hide(from, link.from); hide(link.to, to);
    }
    return finish();
  }});
  return { decorations: Decoration.set(ranges, true), reveals: RangeSet.of(reveals, true) };
}

function updateSelection(value, before, after) {
  const seen = new Set(), removed = new Set(), add = [], intervals = [];
  // The index includes hidden and currently revealed syntax. Query both ends of
  // a move, including ancestors, without walking the document between them.
  for (const selection of [...before.selection.ranges, ...after.selection.ranges]) {
    let from = selection.from, to = selection.to, filter = false;
    value.reveals.between(from, to, (start, end, region) => {
      if (seen.has(region)) return;
      seen.add(region);
      const active = selected(after, start, end);
      if (active === selected(before, start, end)) return;
      if (!active) { add.push(...region.replacements); return; }
      for (const range of region.replacements) {
        removed.add(range.value);
        from = Math.min(from, range.from); to = Math.max(to, range.to);
        filter = true;
      }
    });
    if (filter) intervals.push({ from, to });
  }
  if (!removed.size && !add.length) return value;
  const merged = [];
  for (const interval of intervals.sort((a, b) => a.from - b.from)) {
    const last = merged.at(-1);
    if (last && interval.from <= last.to) last.to = Math.max(last.to, interval.to);
    else merged.push(interval);
  }
  let decorations = value.decorations;
  for (const { from, to } of merged) decorations = decorations.update({
    filterFrom: from, filterTo: to, filter: (_from, _to, decoration) => !removed.has(decoration),
  });
  if (add.length) decorations = decorations.update({ add, sort: true });
  return { ...value, decorations };
}

export const livePreviewState = StateField.define({
  create: (state) => ({ ...decorate(state), composing: false }),
  update(value, tr) {
    let composing = value.composing, refresh = false;
    for (const effect of tr.effects) {
      if (effect.is(composition)) { composing = effect.value; refresh = true; }
      if (effect.is(refreshLivePreview)) refresh = true;
    }
    if (composing) return { ...value, composing, decorations: value.decorations.map(tr.changes) };
    if (refresh || tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state) || tr.startState.readOnly !== tr.state.readOnly)
      return { ...decorate(tr.state), composing };
    return tr.selection ? updateSelection(value, tr.startState, tr.state) : value;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

export function livePreview(options = {}) {
  return [config.of(options), livePreviewState,
    EditorView.editorAttributes.of({ class: "cm-live-preview" }),
    ViewPlugin.fromClass(class {
      constructor(view) { this.view = view; this.timer = null; }
      destroy() { clearTimeout(this.timer); }
    }, { eventHandlers: {
      compositionstart() { clearTimeout(this.timer); this.view.dispatch({ effects: composition.of(true) }); },
      compositionend() {
        this.timer = setTimeout(() => this.view.dispatch({ effects: composition.of(false) }), 50);
      },
      mousedown(event) {
        const link = event.target.closest?.("[data-live-target]");
        if (!link || !(event.metaKey || event.ctrlKey)) return false;
        event.preventDefault();
        this.view.state.facet(config).onLink?.(link.dataset.liveTarget, link.dataset.liveKind);
        return true;
      },
    }}),
    keymap.of([{ key: "Mod-Enter", run(view) {
      let node = syntaxTree(view.state).resolveInner(view.state.selection.main.head, -1);
      while (node && !["Link", "WikiLink"].includes(node.name)) node = node.parent;
      const link = node && linkInfo(view.state, node);
      if (!link) return false;
      view.state.facet(config).onLink?.(link.target, link.kind);
      return true;
    } }]),
  ];
}
