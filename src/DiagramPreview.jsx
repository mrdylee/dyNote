import { useEffect, useRef } from "react";
import DOMPurify from "dompurify";
let serial = 0;
export default function DiagramPreview({ html, onClick, previewRef, className = "markdown-preview", renderDiagrams = true }) {
  const own = useRef(null);
  useEffect(() => {
    if (!renderDiagrams) return;
    let disposed = false;
    const root = own.current;
    const blocks = [...root.querySelectorAll("code.language-mermaid")];
    if (blocks.length)
      import("mermaid")
        .then(async ({ default: mermaid }) => {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            suppressErrorRendering: true,
            theme: "neutral",
            htmlLabels: false,
            flowchart: { htmlLabels: false },
          });
          for (const block of blocks) {
            try {
              const result = await mermaid.render(
                `dynote-diagram-${++serial}`,
                block.textContent,
              );
              if (disposed) return;
              const svg = DOMPurify.sanitize(result.svg, {
                USE_PROFILES: { svg: true, svgFilters: true },
                FORBID_TAGS: ["foreignObject", "image"],
                FORBID_ATTR: ["href", "xlink:href"],
              });
              const container = document.createElement("div");
              container.className = "mermaid-diagram";
              container.innerHTML = svg;
              block.parentElement.replaceWith(container);
            } catch {
              if (!disposed)
                block.parentElement.setAttribute(
                  "title",
                  "다이어그램 문법을 확인해 주세요.",
                );
            }
          }
        })
        .catch(() => {});
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
      className={className}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
