import { languageDataProp, StreamLanguage } from "@codemirror/language";
import { javascriptLanguage, typescriptLanguage } from "@codemirror/lang-javascript";
import { c, cpp } from "@codemirror/legacy-modes/mode/clike";
import { python } from "@codemirror/legacy-modes/mode/python";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { classHighlighter, highlightCode } from "@lezer/highlight";

const languages = new Map();
for (const [names, language] of [
  [["c"], StreamLanguage.define(c)],
  [["cpp", "c++", "cxx"], StreamLanguage.define(cpp)],
  [["python", "py"], StreamLanguage.define(python)],
  [["bash", "sh", "shell"], StreamLanguage.define(shell)],
  [["javascript", "js"], javascriptLanguage],
  [["typescript", "ts"], typescriptLanguage],
]) {
  for (const name of names) languages.set(name, language);
}

export const fenceLanguage = name => languages.get(name.toLowerCase());
const languageData = new Set([...languages.values()].map(language => language.data));
export const fenceHighlighter = {
  ...classHighlighter,
  scope: type => languageData.has(type.prop(languageDataProp)),
};

export function highlightFence(source, name, escapeHtml) {
  const language = fenceLanguage(name);
  if (!language) return ""; // Let Markdown-it escape plain code.
  let html = "";
  highlightCode(source, language.parser.parse(source), classHighlighter, (text, classes) => {
    const escaped = escapeHtml(text);
    html += classes ? `<span class="${classes}">${escaped}</span>` : escaped;
  }, () => { html += "\n"; });
  return html;
}
