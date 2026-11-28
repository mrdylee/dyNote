import { useEffect, useRef, useState } from "react";
import { AlignLeft } from "lucide-react";

const emptyHeadings = [];

export default function TableOfContents({ note, mode, editorRef, previewRef, onJump }) {
  const headings = note?.headings ?? emptyHeadings;
  const [current, setCurrent] = useState(0);
  const list = useRef(null);
  const baseLevel = Math.min(...headings.map(heading => heading.level));
  const depth = heading => heading.level - baseLevel;

  useEffect(() => {
    if (!headings.length) return;
    let frame;
    const update = () => {
      const editor = editorRef.current;
      const preview = previewRef.current;
      const reading = mode === "read";
      const pane = (reading ? preview : editor?.dom)?.closest(".document-pane");
      if (!pane || pane.dataset.documentPath !== note.path) return;
      const top = mode === "split"
        ? editor.scrollDOM.getBoundingClientRect().top + 12
        : pane.getBoundingClientRect().top + (pane.querySelector(".pane-heading")?.offsetHeight ?? 0) + 48;
      let index = 0;
      if (reading) {
        const nodes = [...preview.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(node => !node.closest("[data-embed]"));
        const occurrences = new Map();
        headings.forEach((heading, i) => {
          const occurrence = occurrences.get(heading.id) ?? 0;
          const node = nodes.filter(node => node.id === heading.id)[occurrence];
          occurrences.set(heading.id, occurrence + 1);
          if (node && node.getBoundingClientRect().top <= top) index = i;
        });
      } else {
        const rect = editor.contentDOM.getBoundingClientRect();
        const pos = editor.posAtCoords({ x: rect.left + 8, y: Math.max(top, rect.top + 1) }, false) ?? editor.viewport.from;
        const line = editor.state.doc.lineAt(pos).number - 1;
        headings.forEach((heading, i) => { if (heading.line <= line) index = i; });
      }
      setCurrent(index);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    const pane = (previewRef.current ?? editorRef.current?.dom)?.closest(".document-pane");
    pane?.addEventListener("scroll", schedule, true);
    const observer = new ResizeObserver(schedule);
    if (pane) observer.observe(pane);
    if (previewRef.current) observer.observe(previewRef.current);
    schedule();
    return () => { cancelAnimationFrame(frame); pane?.removeEventListener("scroll", schedule, true); observer.disconnect(); };
  }, [headings, note?.path, mode, editorRef, previewRef]);

  useEffect(() => {
    const row = list.current?.children[current];
    const scroller = list.current?.parentElement;
    if (!row || !scroller) return;
    const top = row.offsetTop, bottom = top + row.offsetHeight;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (bottom > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = bottom - scroller.clientHeight;
  }, [current]);

  return <section className="toc-panel" aria-label="문서 목차">
    <h3><AlignLeft size={15} />On this page</h3>
    {headings.length ? <nav className="toc-scroll" aria-label="이 문서의 제목">
      <ol className="toc-list" ref={list}>
        {headings.map((heading, index) => {
          const x = 8.5 + depth(heading) * 8;
          const previous = index ? 8.5 + depth(headings[index - 1]) * 8 : x;
          return <li key={`${heading.line}:${index}`} className={current === index ? "active" : ""} style={{ "--toc-indent": `${16 + depth(heading) * 8}px` }}>
            <svg className="toc-rail" viewBox="0 0 56 100" preserveAspectRatio="none" aria-hidden="true">
              <path d={`M${previous} 0 C${previous} 10 ${x} 8 ${x} 20 L${x} 100`} vectorEffect="non-scaling-stroke" />
            </svg>
            <button aria-current={current === index ? "location" : undefined}
              onClick={() => { setCurrent(index); onJump(heading); }}>{heading.plainText || heading.text || "제목 없음"}</button>
          </li>;
        })}
      </ol>
    </nav> : <p className="toc-empty">{note ? "아직 제목이 없습니다. # 제목을 추가하면 여기에 표시됩니다." : "Markdown 문서를 열면 목차가 표시됩니다."}</p>}
  </section>;
}
