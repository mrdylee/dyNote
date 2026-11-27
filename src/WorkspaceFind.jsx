import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Replace } from "lucide-react";
import { replaceMatches, replacementText } from "../core/workspace-find.mjs";

const defaults = { query: "", regexp: false, caseSensitive: false, wholeWord: false, include: "", exclude: "" };

function FileMatches({ file, matches, replacing, value, regexp, onOpen, onReplace, disabled }) {
  const [limit, setLimit] = useState(40);
  return (
    <details className="find-file" open>
      <summary>
        {file.label && <small>{file.label} · </small>}
        {file.path} <b>{matches.length}</b>
      </summary>
      {matches.slice(0, limit).map((match) => (
        <div className="find-hit" key={match.from}>
          <button
            type="button"
            onClick={() => onOpen(file, match)}
            title={match.before + match.text + match.after}
          >
            <small>{match.line + 1}</small> {match.before}
            <mark>{match.text || "│"}</mark>
            {replacing && <ins>{replacementText(match, value, regexp)}</ins>}
            {match.after}
          </button>
          {replacing && (
            <button
              aria-label={file.path + " " + (match.line + 1) + "행 바꾸기"}
              title="이 항목 바꾸기"
              disabled={disabled}
              onClick={() => onReplace([{ file, matches: [match] }])}
            >
              <Replace size={14} />
            </button>
          )}
        </div>
      ))}
      {matches.length > limit && <button onClick={() => setLimit(limit + 40)}>결과 더 보기</button>}
    </details>
  );
}

export default function WorkspaceFind({ files, onOpen, onReplace, busy }) {
  const [options, setOptions] = useState(defaults),
    [value, setValue] = useState("");
  const [replacing, setReplacing] = useState(false),
    [response, setResponse] = useState(null);
  const [confirm, setConfirm] = useState(null),
    [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const running = useRef(false);
  const byKey = useMemo(() => new Map(files.map((file) => [file.key, file])), [files]);
  useEffect(() => {
    if (!options.query) return;
    const worker = new Worker(new URL("./workspace-find.worker.mjs", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => setResponse({ ...data, files, options });
    worker.onerror = () => setResponse({ error: "검색을 완료하지 못했습니다.", files, options });
    const timer = setTimeout(() => worker.postMessage({ files, options }), 120);
    return () => {
      clearTimeout(timer);
      worker.terminate();
    };
  }, [files, options]);
  const current = response?.files === files && response.options === options ? response : null;
  const groups = current?.groups ?? [];
  const count = groups.reduce((sum, group) => sum + group.matches.length, 0);
  function field(name, next) {
    setOptions((old) => ({ ...old, [name]: next }));
    setConfirm(null);
    setNotice("");
  }
  async function apply(selection) {
    if (running.current || busy) return;
    running.current = true;
    setSaving(true);
    setConfirm(null);
    setNotice("");
    try {
      await onReplace(
        selection.map(({ file, matches }) => ({
          file,
          content: replaceMatches(file.content, matches, value, options.regexp),
        })),
      );
      setNotice("바꾸기가 완료되었습니다.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      running.current = false;
      setSaving(false);
    }
  }
  return (
    <div className="search-panel workspace-find">
      <div className="workspace-find-row">
        <button
          aria-label={replacing ? "바꾸기 접기" : "바꾸기 펼치기"}
          title="바꾸기"
          aria-expanded={replacing}
          onClick={() => {
            setReplacing(!replacing);
            setConfirm(null);
          }}
        >
          {replacing ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <input
          id="vault-search"
          autoFocus
          aria-label="본문 검색"
          placeholder="Markdown 본문 검색"
          value={options.query}
          onChange={(e) => field("query", e.target.value)}
        />
      </div>
      {replacing && (
        <div className="workspace-find-row">
          <input
            aria-label="바꿀 내용"
            placeholder="바꿀 내용"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setConfirm(null);
              setNotice("");
            }}
          />
          <button disabled={!count || busy || saving} onClick={() => setConfirm(current)}>
            모두 바꾸기
          </button>
        </div>
      )}
      <div className="workspace-find-flags">
        {[
          ["caseSensitive", "Aa", "대소문자 구분"],
          ["wholeWord", "단어", "단어 단위"],
          ["regexp", ".*", "정규식"],
        ].map(([key, text, label]) => (
          <button
            key={key}
            aria-label={label}
            title={label}
            aria-pressed={options[key]}
            onClick={() => field(key, !options[key])}
          >
            {text}
          </button>
        ))}
      </div>
      <details className="find-paths">
        <summary>파일 범위</summary>
        <label>
          포함
          <input
            placeholder="예: 회의록/**, *.md"
            value={options.include}
            onChange={(e) => field("include", e.target.value)}
          />
        </label>
        <label>
          제외
          <input
            placeholder="예: 보관/**"
            value={options.exclude}
            onChange={(e) => field("exclude", e.target.value)}
          />
        </label>
      </details>
      <p role="status">
        {current?.error
          ? "검색식 오류 · " + current.error
          : !options.query
            ? ""
            : !current
              ? "검색 중…"
              : `${groups.length}개 문서 · ${count}개 일치`}
      </p>
      {confirm && confirm === current && (
        <div className="find-confirm">
          <span>
            {groups.length}개 문서의 {count}개 항목을 {value ? "바꿀까요?" : "삭제할까요?"}
          </span>
          <button
            disabled={busy || saving}
            onClick={() => apply(groups.map((g) => ({ file: byKey.get(g.key), matches: g.matches })))}
          >
            적용
          </button>
          <button onClick={() => setConfirm(null)}>취소</button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {groups.map((g) => (
        <FileMatches
          key={g.key}
          file={byKey.get(g.key)}
          matches={g.matches}
          replacing={replacing}
          value={value}
          regexp={options.regexp}
          onOpen={onOpen}
          onReplace={apply}
          disabled={busy || saving}
        />
      ))}
    </div>
  );
}
