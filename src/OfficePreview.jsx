import { useEffect, useRef, useState } from "react";
import { ExternalLink, FileSpreadsheet, LockKeyhole, Presentation, RotateCw } from "lucide-react";
import "./office-preview.css";

function Workbook({ bytes, selection }) {
  const workerRef = useRef(null);
  const [result, setResult] = useState(null);
  useEffect(() => {
    const worker = new Worker(new URL("./office-sheet.worker.mjs", import.meta.url), { type: "module" });
    workerRef.current = worker;
    setResult(null);
    worker.onmessage = ({ data }) => setResult(data);
    worker.onerror = () => setResult({ error: "시트를 읽을 수 없습니다." });
    worker.postMessage({ bytes, ...selection.current });
    return () => { worker.terminate(); workerRef.current = null; };
  }, [bytes, selection]);
  if (!result || result.error) return <p className="office-message" role="status">{result?.error ?? "시트를 읽는 중…"}</p>;
  const { names, view } = result;
  if (!view) return <p className="office-message">표시할 시트가 없습니다.</p>;
  const select = (name, rowOffset = 0, columnOffset = 0) => {
    selection.current = { name, rowOffset, columnOffset };
    workerRef.current.postMessage(selection.current);
  };
  return <>
    <div className="sheet-tabs" aria-label="워크시트">
      {names.map(name => <button key={name} aria-pressed={name === view.name} onClick={() => select(name)}>{name}</button>)}
    </div>
    <div className="sheet-scroll" key={JSON.stringify([view.name, view.rowOffset, view.columnOffset])} tabIndex={0} aria-label={view.name + " 시트"}>
      {view.rows.length && view.columns.length ? <table><thead><tr><th aria-label="행 번호" />{view.columns.map(c => <th scope="col" key={c}>{c}</th>)}</tr></thead>
        <tbody>{view.rows.map(row => <tr key={row.number}><th scope="row">{row.number}</th>{row.cells.map(cell =>
          <td key={cell.address} rowSpan={cell.rowSpan} colSpan={cell.colSpan} className={cell.numeric ? "number" : undefined}>{cell.text}</td>)}</tr>)}</tbody></table>
        : <p className="office-message">표시할 셀이 없습니다.</p>}
    </div>
    {(view.rowOffset > 0 || view.columnOffset > 0 || view.moreRows || view.moreColumns) && <div className="sheet-pages">
      {(view.rowOffset > 0 || view.moreRows) && <><button disabled={!view.rowOffset} onClick={() => select(view.name, view.rowOffset - view.pageRows, view.columnOffset)}>이전 행</button>
        <button disabled={!view.moreRows} onClick={() => select(view.name, view.rowOffset + view.pageRows, view.columnOffset)}>다음 행</button></>}
      {(view.columnOffset > 0 || view.moreColumns) && <><button disabled={!view.columnOffset} onClick={() => select(view.name, view.rowOffset, view.columnOffset - view.pageColumns)}>이전 열</button>
        <button disabled={!view.moreColumns} onClick={() => select(view.name, view.rowOffset, view.columnOffset + view.pageColumns)}>다음 열</button></>}
    </div>}
  </>;
}

function Slides({ bytes, revision, selection }) {
  const frame = useRef(null);
  useEffect(() => {
    const remember = event => {
      if (event.source === frame.current?.contentWindow && event.origin === "notes://slides" && Number.isInteger(event.data?.slideIndex))
        selection.current.slideIndex = event.data.slideIndex;
    };
    window.addEventListener("message", remember);
    return () => window.removeEventListener("message", remember);
  }, [selection]);
  return <iframe ref={frame} key={revision} title="슬라이드 미리보기" src="notes://slides/slides.html" sandbox="allow-scripts allow-same-origin"
    onLoad={event => event.currentTarget.contentWindow.postMessage({ bytes, slideIndex: selection.current.slideIndex ?? 0 }, "notes://slides")} />;
}

export default function OfficePreview({ document, onEdit, onRefresh, busy, error, position }) {
  const localPosition = useRef({});
  const selection = position ?? localPosition;
  const slides = document.kind === "pptx", Icon = slides ? Presentation : FileSpreadsheet;
  return <section className={"office-preview " + (slides ? "slides" : "workbook")} aria-label={slides ? "PowerPoint 미리보기" : "Excel 미리보기"}>
    <header className="office-tools"><div className="office-type"><span className="office-icon"><Icon size={21}/></span>
      <strong>{slides ? "PowerPoint" : "Excel"}</strong><span className="office-readonly"><LockKeyhole size={12}/>읽기 전용</span></div>
      <div className="office-actions"><button type="button" className="office-refresh" onClick={onRefresh} disabled={busy} title="미리보기 새로고침" aria-label="미리보기 새로고침"><RotateCw size={15}/></button>
        <button type="button" className="office-edit" onClick={onEdit}><ExternalLink size={15}/>앱에서 수정</button></div></header>
    {error || document.previewError ? <p className="office-message" role="status">{error || document.previewError}</p>
      : !document.bytes ? <p className="office-message" role="status">문서를 읽는 중…</p>
      : slides ? <Slides selection={selection} bytes={document.bytes} revision={document.revision}/>
      : <Workbook selection={selection} bytes={document.bytes}/>}
  </section>;
}
