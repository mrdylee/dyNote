import { useMemo } from "react";
import DOMPurify from "dompurify";

export default function WordPreview({ html, error }) {
  const preview = useMemo(() => DOMPurify.sanitize(html ?? "", {
    ALLOWED_TAGS: ["b", "blockquote", "br", "caption", "div", "em", "h1", "h2", "h3", "h4", "h5", "h6",
      "hr", "i", "img", "li", "ol", "p", "s", "span", "strong", "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul"],
    ALLOWED_ATTR: ["src", "alt", "colspan", "rowspan", "start"],
    ALLOW_DATA_ATTR: false,
  }), [html]);

  if (error) return <p role="status">{error}</p>;
  if (html === undefined) return <p className="muted" role="status">Word 문서를 읽는 중…</p>;
  if (!preview) return <p className="muted">미리볼 본문이 없습니다.</p>;
  return <article className="markdown-preview word-preview" aria-label="Word 미리보기"
    dangerouslySetInnerHTML={{ __html: preview }} />;
}
