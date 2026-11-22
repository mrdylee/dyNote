import { read, utils } from "xlsx";

const pageRows = 100, pageColumns = 32;
let book, names;

function page(name, rowOffset, columnOffset) {
  const sheet = book.Sheets[name], range = sheet["!ref"] && utils.decode_range(sheet["!ref"]);
  if (!range) return { name, rows: [], columns: [] };
  rowOffset = Math.min(rowOffset, Math.floor((range.e.r - range.s.r) / pageRows) * pageRows);
  columnOffset = Math.min(columnOffset, Math.floor((range.e.c - range.s.c) / pageColumns) * pageColumns);
  const firstRow = range.s.r + rowOffset, firstCol = range.s.c + columnOffset;
  const lastRow = Math.min(firstRow + pageRows - 1, range.e.r);
  const lastCol = Math.min(firstCol + pageColumns - 1, range.e.c);
  const visible = (first, last, metadata) => Array.from({ length: last - first + 1 }, (_, i) => first + i).filter(i => !metadata?.[i]?.hidden);
  const columns = visible(firstCol, lastCol, sheet["!cols"]), indices = visible(firstRow, lastRow, sheet["!rows"]);
  const spans = new Map();
  for (const { s, e } of sheet["!merges"] ?? []) {
    if (s.r > lastRow || e.r < firstRow || s.c > lastCol || e.c < firstCol) continue;
    const rr = indices.filter(r => r >= s.r && r <= e.r), cc = columns.filter(c => c >= s.c && c <= e.c);
    for (const r of rr) for (const c of cc) {
      spans.set(utils.encode_cell({ r, c }), r === rr[0] && c === cc[0]
        ? { source: utils.encode_cell(s), rowSpan: rr.length, colSpan: cc.length } : null);
    }
  }
  const rows = indices.map(r => ({ number: r + 1, cells: columns.flatMap(c => {
    const address = utils.encode_cell({ r, c }), span = spans.get(address);
    if (span === null) return [];
    const cell = sheet[span?.source ?? address];
    return [{ address, text: cell?.w ?? (cell?.v == null && cell?.f ? "=" + cell.f : String(cell?.v ?? "")),
      numeric: cell?.t === "n", rowSpan: span?.rowSpan, colSpan: span?.colSpan }];
  }) }));
  return { name, rows, columns: columns.map(c => utils.encode_col(c)), rowOffset, columnOffset,
    moreRows: lastRow < range.e.r, moreColumns: lastCol < range.e.c, pageRows, pageColumns };
}

self.onmessage = ({ data }) => {
  try {
    if (data.bytes) {
      book = read(data.bytes, { type: "array", cellHTML: false, cellStyles: true });
      names = book.SheetNames.filter((_, i) => !book.Workbook?.Sheets?.[i]?.Hidden);
    }
    const name = names.includes(data.name) ? data.name : names[0];
    self.postMessage({ names, view: name ? page(name, data.rowOffset ?? 0, data.columnOffset ?? 0) : null });
  } catch {
    self.postMessage({ error: "시트를 표시할 수 없습니다. 앱에서 원본을 열어 주세요." });
  }
};
