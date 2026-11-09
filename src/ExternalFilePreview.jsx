import { useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { renderMarkdown } from "../core/knowledge.mjs";
import DiagramPreview from "./DiagramPreview.jsx";
import WordPreview from "./WordPreview.jsx";
import PdfViewer from "./PdfViewer.jsx";
import AudioViewer from "./AudioViewer.jsx";
import CanvasEditor from "./CanvasEditor.jsx";
import BasesView from "./BasesView.jsx";

const empty = [];
function ImagePreview({ document }) {
  const [url, setUrl] = useState(null), [failed, setFailed] = useState(false);
  useEffect(() => {
    const value = URL.createObjectURL(new Blob([new Uint8Array(document.bytes)], { type: document.mime }));
    setUrl(value); setFailed(false);
    return () => URL.revokeObjectURL(value);
  }, [document.bytes, document.mime]);
  return failed ? <p role="alert">이미지를 읽을 수 없습니다.</p> : url && <img className="external-file-image" src={url} alt={document.name} onError={() => setFailed(true)} />;
}

export default function ExternalFilePreview({ document, error, onExternal }) {
  const [notice, setNotice] = useState("");
  const html = useMemo(() => document?.kind === "markdown" ? DOMPurify.sanitize(renderMarkdown(document.content, empty, document.path), {
    FORBID_TAGS: ["iframe", "style", "form", "svg", "math"], ADD_ATTR: ["data-external", "data-note", "data-anchor"],
  }) : "", [document]);
  if (error) return <p role="status">{error}</p>;
  if (!document) return <p role="status" className="muted">파일을 읽는 중…</p>;
  const related = () => setNotice("연결 파일은 파일 열기로 따로 선택해 주세요.");
  const external = url => Promise.resolve().then(() => onExternal(url)).catch(value => setNotice(value.message));
  let preview;
  switch (document.kind) {
    case "word": preview = <WordPreview html={document.html} />; break;
    case "markdown": preview = <section aria-label="Markdown 미리보기"><DiagramPreview html={html} onClick={event => {
      const link = event.target.closest("a");
      if (!link) return;
      event.preventDefault();
      if (link.dataset.external) void external(link.getAttribute("href"));
      else if (link.dataset.anchor) event.currentTarget.querySelector(`[id="${CSS.escape(link.dataset.anchor)}"]`)?.scrollIntoView();
      else related();
    }} /></section>; break;
    case "pdf": preview = <PdfViewer bytes={document.bytes} path={document.name} />; break;
    case "image": preview = <ImagePreview document={document} />; break;
    case "audio": preview = <AudioViewer bytes={document.bytes} mime={document.mime} />; break;
    case "canvas": preview = <CanvasEditor document={document} files={empty} attachments={empty} readOnly onOpen={related} onExternal={external} onError={setNotice} />; break;
    case "base": preview = <><p className="muted">보관함과 연결하지 않은 Bases 설정 미리보기입니다.</p><BasesView document={document} notes={empty} readOnly onOpen={related} onError={setNotice} /></>; break;
    default: preview = <pre className="external-file-text" aria-label="텍스트 미리보기">{document.content}</pre>;
  }
  return <>{notice && <p role="status">{notice}</p>}{preview}{["canvas", "base"].includes(document.kind) && <details><summary>원문 보기</summary><pre className="external-file-text">{document.content}</pre></details>}</>;
}
