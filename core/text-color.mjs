import { startsCallout } from "./callout.mjs";
import { textSizeOptions } from "./text-size-options.mjs";

const sizes = textSizeOptions.flatMap(({ value }) => value ? [value] : []);
const sizePattern = sizes.map(size => size.replace(".", "\\.")).join("|");
const styleTag = new RegExp(`<span style="(?:color:(#[a-f0-9]{6})|font-size:(${sizePattern}))">`, "i");
const opening = new RegExp("^" + styleTag.source, "i");
export const validTextColor = value => typeof value === "string" && /^#[a-f0-9]{6}$/i.test(value);
export const validTextSize = value => sizes.includes(value);
export const styleOpening = (property, value) => `<span style="${property}:${value.toLowerCase()}">`;

// Accept one allowlisted declaration per span. All other HTML stays literal.
export function readStyleSpan(source, from = 0) {
  const open = opening.exec(source.slice(from));
  if (!open) return null;
  const contentFrom = from + open[0].length;
  const tokens = new RegExp(/\\[\s\S]|`+|<\/span>/.source + "|" + styleTag.source, "gi");
  tokens.lastIndex = contentFrom;
  let depth = 1, match;
  while ((match = tokens.exec(source))) {
    const token = match[0];
    if (token[0] === "\\") continue;
    if (token[0] === "`") {
      const ticks = /`+/g; ticks.lastIndex = tokens.lastIndex;
      let closing;
      while ((closing = ticks.exec(source))) if (closing[0].length === token.length) { tokens.lastIndex = ticks.lastIndex; break; }
      continue;
    }
    if (/^<span /i.test(token)) { if (++depth > 32) return null; }
    else if (--depth === 0) return { from, contentFrom, contentTo: match.index, to: tokens.lastIndex, property: open[1] ? "color" : "font-size", value: (open[1] ?? open[2]).toLowerCase() };
  }
  return null;
}

export const textStyleParser = {
  name: "TextStyle", before: "HTMLTag",
  parse(cx, next, pos) {
    if (next !== 60) return -1;
    const source = cx.slice(pos, cx.end), span = readStyleSpan(source);
    if (!span) return -1;
    return cx.addElement(cx.elt("TextStyle", pos, pos + span.to, [
      cx.elt("StyleMark", pos, pos + span.contentFrom),
      ...cx.parser.parseInline(source.slice(span.contentFrom, span.contentTo), pos + span.contentFrom),
      cx.elt("StyleMark", pos + span.contentTo, pos + span.to),
    ]));
  },
};

export function installTextStyle(md) {
  md.inline.ruler.before("html_inline", "text_style", (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 60) return false;
    const span = readStyleSpan(state.src, state.pos);
    if (!span) return false;
    if (!silent) {
      const open = state.push("text_style_open", "span", 1);
      open.attrSet("style", `${span.property}:${span.value}`);
      const children = [];
      state.md.inline.parse(state.src.slice(span.contentFrom, span.contentTo), state.md, state.env, children);
      state.tokens.push(...children);
      state.push("text_style_close", "span", -1);
    }
    state.pos = span.to;
    return true;
  });
}

// Rebuild only spans of the edited property. Keep the other property and Markdown delimiters intact.
// This avoids turning headings/lists into HTML text or splitting emphasis marks.
export function rewriteTextStyle(source, tree, targets, selections, property, value) {
  let output = "";
  const points = selections.flatMap(range => [
    { pos: range.anchor, assoc: range.empty || range.anchor === range.from ? 1 : -1 },
    { pos: range.head, assoc: range.empty || range.head === range.from ? 1 : -1 },
  ]);
  const overlaps = (from, to) => targets.some(range => range.from < to && range.to > from);
  const map = (from, to, offset) => {
    if (from === to) return;
    for (const point of points) {
      if (point.value !== undefined) continue;
      if ((point.pos > from && point.pos < to) || (point.pos === from && point.assoc > 0) || (point.pos === to && point.assoc < 0))
        point.value = offset + point.pos - from;
    }
  };
  const raw = (from, to) => { map(from, to, output.length); output += source.slice(from, to); };
  const remove = (from, to) => {
    for (const point of points) if (point.value === undefined && point.pos >= from && point.pos < to) point.value = output.length;
  };
  const piece = (from, to, value) => {
    const text = source.slice(from, to), body = /\S(?:[\s\S]*\S)?/.exec(text);
    if (!value || !body) { raw(from, to); return; }
    const start = from + body.index, end = start + body[0].length;
    raw(from, start);
    const open = styleOpening(property, value);
    output += open; map(start, end, output.length); output += source.slice(start, end) + "</span>";
    raw(end, to);
  };
  let protectedUntil = /^\uFEFF?---\n[\s\S]*?\n(?:---|\.\.\.)(?:\n|$)/.exec(source)?.[0].length ?? 0;
  const text = (from, to, current) => {
    if (from < protectedUntil) { const end = Math.min(to, protectedUntil); raw(from, end); from = end; }
    if (from >= to) return;
    const boundaries = [from, to];
    for (const range of targets) for (const pos of [range.from, range.to]) if (pos > from && pos < to) boundaries.push(pos);
    for (let pos = source.indexOf("\n", from); pos >= 0 && pos < to; pos = source.indexOf("\n", pos + 1)) boundaries.push(pos, pos + 1);
    const sorted = [...new Set(boundaries)].sort((a,b) => a-b);
    for (let index = 0; index < sorted.length - 1; index++) {
      const start = sorted[index], end = sorted[index + 1];
      piece(start, end, overlaps(start, end) ? value : current);
    }
  };
  const block = new Set(["FencedCode", "CodeBlock", "HTMLBlock", "HTMLTag", "HorizontalRule", "LinkReference", "URL", "LinkTitle", "TaskMarker"]);
  const atomic = new Set(["InlineCode", "Autolink", "WikiLink", "WikiEmbed", "Image", "Escape", "Entity"]);
  const contents = (node, from, to, current) => {
    let pos = from;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.to <= from || child.from >= to) continue;
      text(pos, child.from, current); walk(child, current); pos = child.to;
    }
    text(pos, to, current);
  };
  const walk = (node, current = null) => {
    if (node.name === "Paragraph" && node.parent?.name === "Blockquote") {
      const newline = source.indexOf("\n", node.from);
      const end = newline < 0 ? node.to : Math.min(newline, node.to);
      if (startsCallout(node, source.slice(node.from, end))) protectedUntil = Math.max(protectedUntil, end);
    }
    if (node.to <= protectedUntil || block.has(node.name) || /(?:Mark|Delimiter)$/.test(node.name)) { raw(node.from, node.to); return; }
    if (!current && !overlaps(node.from, node.to)) { raw(node.from, node.to); return; }
    if (node.name === "TextStyle") {
      const span = readStyleSpan(source, node.from);
      if (span.property === property) {
        remove(node.from, span.contentFrom);
        contents(node, span.contentFrom, span.contentTo, span.value);
        remove(span.contentTo, node.to);
      } else {
        raw(node.from, span.contentFrom);
        contents(node, span.contentFrom, span.contentTo, current);
        raw(span.contentTo, node.to);
      }
      return;
    }
    if (atomic.has(node.name)) {
      const full = targets.some(range => range.from <= node.from && range.to >= node.to);
      piece(node.from, node.to, full ? value : current); return;
    }
    contents(node, node.from, node.to, current);
  };
  walk(tree.topNode);
  raw(tree.length, source.length);
  return { content: output, ranges: selections.map((_range, index) => ({ anchor: points[index * 2].value ?? output.length, head: points[index * 2 + 1].value ?? output.length })) };
}

export function textWithoutStyleMarkup(source) {
  if (!styleTag.test(source)) return source;
  let result = "", pos = 0;
  while (pos < source.length) {
    if (source[pos] === "\\") { result += source.slice(pos,pos+2); pos += 2; continue; }
    if (source[pos] === "`") {
      const opening = /^`+/.exec(source.slice(pos))[0], runs = /`+/g;
      runs.lastIndex = pos + opening.length;
      let match, end = -1;
      while ((match = runs.exec(source))) if (match[0].length === opening.length) { end = runs.lastIndex; break; }
      if (end >= 0) { result += source.slice(pos,end); pos = end; continue; }
    }
    const span = source[pos] === "<" ? readStyleSpan(source,pos) : null;
    if (span) { result += textWithoutStyleMarkup(source.slice(span.contentFrom,span.contentTo)); pos = span.to; }
    else result += source[pos++];
  }
  return result;
}
