import DOMPurify from "dompurify";

let renderer;
let serial = 0;

export async function renderMermaid(source) {
  const mermaid = await (renderer ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: "neutral",
      htmlLabels: false,
      flowchart: { htmlLabels: false },
    });
    return mermaid;
  }));
  const { svg } = await mermaid.render(`dynote-diagram-${++serial}`, source);
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["foreignObject", "image"],
    FORBID_ATTR: ["href", "xlink:href"],
  });
}
