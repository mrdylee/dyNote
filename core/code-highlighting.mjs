import { languages as catalog } from "@codemirror/language-data";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { languageDataProp, StreamLanguage } from "@codemirror/language";
import { javascriptLanguage, typescriptLanguage } from "@codemirror/lang-javascript";
import { c, cpp } from "@codemirror/legacy-modes/mode/clike";
import { python } from "@codemirror/legacy-modes/mode/python";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { classHighlighter, highlightCode } from "@lezer/highlight";

// Keep the original six parsers synchronous. Other catalog entries load on demand.
const eager = new Map([
  ["C", StreamLanguage.define(c)], ["C++", StreamLanguage.define(cpp)],
  ["Python", StreamLanguage.define(python)], ["Shell", StreamLanguage.define(shell)],
  ["JavaScript", javascriptLanguage], ["TypeScript", typescriptLanguage],
]);
const byName = new Map();
for (const entry of catalog) {
  const mode = eager.get(entry.name) ?? entry;
  for (const alias of [...entry.alias, entry.name.toLowerCase().replaceAll(" ", "-")])
    byName.set(alias, mode);
}
for (const entry of catalog) {
  for (const ext of entry.extensions) {
    const key = ext.toLowerCase();
    if (!byName.has(key)) byName.set(key, eager.get(entry.name) ?? entry);
  }
}

export const fenceLanguage = name => byName.get(name.toLowerCase());
const eagerData = new Set([...eager.values()].map(language => language.data));
export const fenceHighlighter = {
  ...classHighlighter,
  scope(type) {
    const data = type.prop(languageDataProp);
    return !!data && data !== markdownLanguage.data &&
      (eagerData.has(data) || catalog.some(entry => entry.support?.language.data === data));
  },
};

// Larger previews paint only the visible portion after the plain text is displayed.
export const inlineHighlightLimit = 16 * 1024;

export function highlightFence(source, name, escapeHtml) {
  if (source.length > inlineHighlightLimit) return "";
  const mode = fenceLanguage(name);
  const language = mode?.support?.language ?? (mode?.parser ? mode : null);
  if (!language) return ""; // Let Markdown-it escape plain code.
  let html = "";
  highlightCode(source, language.parser.parse(source), classHighlighter, (text, classes) => {
    const escaped = escapeHtml(text);
    html += classes ? `<span class="${classes}">${escaped}</span>` : escaped;
  }, () => { html += "\n"; });
  return html;
}
