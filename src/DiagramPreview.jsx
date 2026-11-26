import { useEffect, useRef } from "react";
import { renderMermaid } from "./mermaid-preview.mjs";

export default function DiagramPreview({ html, onClick, previewRef, tabIndex, className = "markdown-preview", renderDiagrams = true }) {
  const own = useRef(null);
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
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
