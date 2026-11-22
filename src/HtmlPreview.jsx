import { useEffect, useState } from "react";
import DOMPurify from "dompurify";

export default function HtmlPreview({ content }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    const html = DOMPurify.sanitize(content, {
      WHOLE_DOCUMENT: true, USE_PROFILES: { html: true, svg: true },
      FORBID_TAGS: ["base", "meta", "link", "form", "iframe", "object", "embed", "foreignObject"],
      FORBID_ATTR: ["href", "xlink:href", "srcset", "action", "formaction", "target"],
      RETURN_DOM: true,
    });
    const policy = document.createElement("meta");
    policy.httpEquiv = "Content-Security-Policy";
    policy.content = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'";
    html.querySelector("head").prepend(policy);
    const address = URL.createObjectURL(new Blob(["<!doctype html>", html.outerHTML], { type: "text/html;charset=utf-8" }));
    setUrl(address);
    return () => URL.revokeObjectURL(address);
  }, [content]);
  return url && <iframe className="html-preview" title="HTML 미리보기" sandbox="" referrerPolicy="no-referrer" src={url}/>;
}
