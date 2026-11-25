export default function LocalOnlyFiles({ files }) {
  if (!files?.length) return null;
  return <details className="backup-details">
    <summary>이 PC에만 있는 항목 {files.length}개</summary>
    <ul>{files.map(file => <li key={file.name}>{file.name} · {file.message}</li>)}</ul>
  </details>;
}
