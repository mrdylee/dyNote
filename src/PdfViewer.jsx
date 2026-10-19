import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
GlobalWorkerOptions.workerSrc = workerUrl;
export default function PdfViewer({ bytes }) {
  const canvas = useRef(null);
  const [document, setDocument] = useState(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    const job = getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      enableXfa: false,
      useSystemFonts: true,
    });
    job.promise
      .then((value) => {
        if (!disposed) setDocument(value);
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      });
    return () => {
      disposed = true;
      job.destroy();
    };
  }, [bytes]);
  useEffect(() => {
    if (!document) return;
    let cancelled = false,
      render;
    document
      .getPage(page)
      .then((p) => {
        if (cancelled) return;
        const viewport = p.getViewport({ scale: 1.25 });
        const target = canvas.current;
        target.width = viewport.width;
        target.height = viewport.height;
        render = p.render({ canvasContext: target.getContext("2d"), viewport });
        return render.promise;
      })
      .catch((e) => {
        if (!cancelled && e.name !== "RenderingCancelledException")
          setError(e.message);
      });
    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [document, page]);
  return (
    <div className="pdf-viewer">
      {error ? (
        <p role="alert">PDF를 열 수 없습니다: {error}</p>
      ) : (
        <>
          <div className="pdf-toolbar">
            <button
              disabled={!document || page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              이전 페이지
            </button>
            <span>
              {document ? `${page} / ${document.numPages}` : "PDF 불러오는 중…"}
            </span>
            <button
              disabled={!document || page === document.numPages}
              onClick={() => setPage((p) => p + 1)}
            >
              다음 페이지
            </button>
          </div>
          <canvas ref={canvas} aria-label={`PDF ${page}페이지`} />
        </>
      )}
    </div>
  );
}
