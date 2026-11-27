import { useEffect, useMemo, useRef } from "react";
import { highlightCode, classHighlighter } from "@lezer/highlight";
import { highlightLargeFence } from "./large-code-preview.mjs";
import { fenceLanguage, inlineHighlightLimit } from "../core/code-highlighting.mjs";
import { renderMermaid } from "./mermaid-preview.mjs";

export default function DiagramPreview({ html, onClick, previewRef, tabIndex, className = "markdown-preview", renderDiagrams = true }) {
  const own = useRef(null);
  const markup = useMemo(() => ({ __html: html }), [html]);
  useEffect(() => {
    const root = own.current, cleanups = [];
    let disposed = false;
    for (const block of root.querySelectorAll("pre > code[class]")) {
      if (block.childElementCount) continue;
      const tag = [...block.classList].find(name => name.startsWith("language-"));
      const mode = tag && fenceLanguage(tag.slice(9));
      if (!mode) continue;
      const source = block.textContent;
      Promise.resolve(mode.parser ? mode : mode.load().then(support => support.language)).then(language => {
        if (disposed || !root.contains(block) || block.childElementCount) return;
        if (source.length > inlineHighlightLimit) {
          cleanups.push(highlightLargeFence(block, source, language));
          return;
        }
        const doc = block.ownerDocument;
        const fragment = doc.createDocumentFragment();
        highlightCode(source, language.parser.parse(source), classHighlighter, (text, classes) => {
          if (!classes) { fragment.append(text); return; }
          const token = doc.createElement("span");
          token.className = classes;
          token.textContent = text;
          fragment.append(token);
        }, () => fragment.append("\n"));
        block.replaceChildren(fragment);
      }).catch(() => { /* Keep escaped source readable if a parser cannot load. */ });
    }
    return () => { disposed = true; for (const cleanup of cleanups) cleanup(); };
  }, [html]);
  useEffect(() => {
    if (!renderDiagrams) return;
    let disposed = false;
    const root = own.current;
    const blocks = root.querySelectorAll('code[class~="language-mermaid" i]');
    async function render() {
      for (const block of blocks) {
        try {
          const svg = await renderMermaid(block.textContent);
          if (disposed) return;
          const container = root.ownerDocument.createElement("div");
          container.className = "mermaid-diagram";
          if (block.dataset.sourceLines) container.dataset.sourceLines = block.dataset.sourceLines;
          container.innerHTML = svg;
          block.parentElement.replaceWith(container);
        } catch {
          if (disposed) return;
          block.parentElement.title = "다이어그램 문법을 확인해 주세요.";
        }
      }
    }
    render();
    return () => {
      disposed = true;
    };
  }, [html, renderDiagrams]);
  return (
    <article
      ref={(node) => {
        own.current = node;
        if (previewRef) previewRef.current = node;
      }}
      tabIndex={tabIndex}
      className={className}
      onClick={onClick}
      dangerouslySetInnerHTML={markup}
    />
  );
}
