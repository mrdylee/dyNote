import { useEffect, useState } from "react";

export default function FileVersionHistory({ path, onList, onPreview, onRestore }) {
  const [entries, setEntries] = useState([]),
    [anchor, setAnchor] = useState(null),
    [more, setMore] = useState(false);
  const [preview, setPreview] = useState(null),
    [pending, setPending] = useState(true),
    [message, setMessage] = useState("");

  useEffect(() => {
    let open = true;
    onList(0, null)
      .then((page) => {
        if (open) {
          setEntries(page.entries);
          setAnchor(page.anchor);
          setMore(page.more);
        }
      })
      .catch((e) => {
        if (open) setMessage(e.message);
      })
      .finally(() => {
        if (open) setPending(false);
      });
    return () => {
      open = false;
    };
  }, [path]);

  async function run(action) {
    setPending(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error.message);
      setPreview(null);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="settings-section">
      <h3>{path}</h3>
      <div className="backup-records">
        {entries.map((entry) => (
          <button
            key={entry.hash}
            className="backup-record"
            disabled={pending}
            aria-pressed={preview?.commit === entry.hash}
            onClick={() => run(async () => setPreview(await onPreview(entry.hash)))}
          >
            {new Date(entry.time).toLocaleString()} · {entry.device || entry.author}
          </button>
        ))}
      </div>
      {more && (
        <button
          className="secondary-button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const page = await onList(entries.length, anchor);
              setEntries((previous) => [...previous, ...page.entries]);
              setMore(page.more);
            })
          }
        >
          이전 기록 더 보기
        </button>
      )}
      {!pending && !entries.length && !message && <p>이 파일의 Git 기록이 없습니다.</p>}
      {preview && (
        <div className="restore-preview">
          {preview.text !== null ? (
            <pre style={{ whiteSpace: "pre-wrap", maxHeight: "15rem", overflow: "auto" }}>{preview.text}</pre>
          ) : (
            <p>
              {preview.path} · {preview.size.toLocaleString()}바이트
            </p>
          )}
          {preview.identical ? (
            <p>현재 파일과 같은 버전입니다.</p>
          ) : (
            <button
              className="primary-button"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  await onRestore(preview);
                  setPreview(null);
                  setMessage("이 파일을 선택한 버전으로 복원했습니다.");
                })
              }
            >
              이 파일만 복원
            </button>
          )}
        </div>
      )}
      {pending && <p role="status">기록 확인 중…</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
