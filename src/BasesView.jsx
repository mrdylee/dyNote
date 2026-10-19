import { useEffect, useMemo, useState } from "react";
import { parseBase, patchProperty } from "../core/bases.mjs";
const display = (v) =>
  v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);

export default function BasesView({
  document,
  notes,
  onChange,
  onNoteChange,
  onOpen,
  onError,
  readOnly = false,
}) {
  const parsed = useMemo(() => {
    try {
      return parseBase(document.content);
    } catch (e) {
      return { error: e.message };
    }
  }, [document.content]);
  const [view, setView] = useState(0),
    [result, setResult] = useState(null),
    [error, setError] = useState(""),
    [calculating, setCalculating] = useState(true),
    [config, setConfig] = useState(false);
  useEffect(() => {
    setError("");
    setCalculating(true);
    if (parsed.error) {
      setError(parsed.error);
      setCalculating(false);
      return;
    }
    if (view >= parsed.data.views.length) {
      setView(0);
      return;
    }
    let worker,
      limit,
      disposed = false;
    const start = setTimeout(() => {
      worker = new Worker(new URL("./bases.worker.mjs", import.meta.url), {
        type: "module",
      });
      worker.onmessage = ({ data }) => {
        if (disposed) return;
        clearTimeout(limit);
        setCalculating(false);
        if (data.ok) setResult(data.value);
        else setError(data.error);
        worker.terminate();
      };
      worker.onerror = () => {
        if (disposed) return;
        clearTimeout(limit);
        setCalculating(false);
        setError("Bases 계산 작업을 실행하지 못했습니다.");
        worker.terminate();
      };
      limit = setTimeout(() => {
        worker.terminate();
        setCalculating(false);
        setError("계산 시간이 초과되었습니다. 조건·수식을 단순하게 해 주세요.");
      }, 1800);
      worker.postMessage({
        source: document.content,
        notes,
        view,
        path: document.path,
      });
    }, 100);
    return () => {
      disposed = true;
      clearTimeout(start);
      clearTimeout(limit);
      worker?.terminate();
    };
  }, [document.content, document.path, notes, view]);
  function edit(notePath, property, input) {
    try {
      const note = notes.find((n) => n.path === notePath);
      onNoteChange(
        notePath,
        patchProperty(note.content, property.replace(/^note\./, ""), input),
      );
    } catch (e) {
      onError(e.message);
    }
  }
  return (
    <div className="bases-view">
      <div className="structured-toolbar">
        <strong>Bases</strong>
        <select
          aria-label="Bases 보기"
          value={view}
          onChange={(e) => setView(Number(e.target.value))}
        >
          {(parsed.data?.views ?? []).map((v, i) => (
            <option value={i} key={i}>
              {v.name || `보기 ${i + 1}`}
            </option>
          ))}
        </select>
        <button onClick={() => setConfig(!config)}>
          {config ? "표 보기" : "보기 설정 편집"}
        </button>
        <span>
          {calculating
            ? "계산 중…"
            : result
              ? `${result.rows.length}개 문서`
              : "결과 없음"}
        </span>
      </div>
      {parsed.warnings?.map((w) => (
        <p className="structured-notice" key={w}>
          {w} 원본 설정을 유지하는 읽기 전용입니다.
        </p>
      ))}
      {error && (
        <p role="alert" className="structured-notice">
          {error}
        </p>
      )}
      {config || parsed.error ? (
        <div className="base-config">
          <p>
            YAML로 열·필터·정렬·그룹·수식을 설정합니다. 변경은 자동 저장됩니다.
          </p>
          <textarea
            aria-label="Bases YAML 설정"
            spellCheck={false}
            value={document.content}
            readOnly={readOnly || parsed.readOnly}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      ) : (
        result && (
          <div className="base-table-scroll">
            <table className="base-table">
              <thead>
                <tr>
                  {result.columns.map((column) => (
                    <th key={column}>
                      {parsed.data.properties?.[column]?.displayName ??
                        parsed.data.properties?.[column.replace(/^note\./, "")]
                          ?.displayName ??
                        column.replace(/^(note|file|formula)\./, "")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.groups.map((group) => (
                  <Group
                    key={group.key}
                    group={group}
                    grouped={result.grouped}
                    columns={result.columns}
                    readOnly={readOnly || result.readOnly || !!error}
                    onOpen={onOpen}
                    onEdit={edit}
                  />
                ))}
              </tbody>
            </table>
            {!result.rows.length && (
              <p className="structured-footnote">
                조건에 맞는 문서가 없습니다.
              </p>
            )}
          </div>
        )
      )}
      <p className="structured-footnote">
        현재 보관함의 Markdown 문서를 표시합니다. 속성 셀은 편집 후 Enter 또는
        다른 곳을 누르면 저장됩니다. file·formula 열은 읽기 전용입니다.
      </p>
    </div>
  );
}

function Group({ group, grouped, columns, readOnly, onOpen, onEdit }) {
  return (
    <>
      {grouped && (
        <tr className="base-group">
          <th colSpan={columns.length}>
            {group.key || "값 없음"} · {group.rows.length}
          </th>
        </tr>
      )}
      {group.rows.map((row) => (
        <tr key={row.path}>
          {columns.map((column) => (
            <td key={column}>
              {column === "file.name" || column === "file.path" ? (
                <button
                  className="base-note-link"
                  onClick={() => onOpen(row.path)}
                  title={row.path}
                >
                  {display(row.values[column])}
                </button>
              ) : !readOnly && !/^(file|formula)\./.test(column) ? (
                <input
                  key={`${row.path}:${display(row.values[column])}`}
                  aria-label={`${row.path} ${column}`}
                  defaultValue={display(row.values[column])}
                  onBlur={(e) => {
                    if (e.target.value !== display(row.values[column]))
                      onEdit(row.path, column, e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                />
              ) : (
                display(row.values[column])
              )}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
