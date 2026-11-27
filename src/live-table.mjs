import { WidgetType } from "@codemirror/view";
import DOMPurify from "dompurify";
import { renderMarkdown } from "../core/knowledge.mjs";

export class TablePreview extends WidgetType {
  constructor(state, node) {
    super();
    this.lines = [];
    this.offsets = [];
    for (let row = node.firstChild; row; row = row.nextSibling) {
      if (!["TableHeader", "TableDelimiter", "TableRow"].includes(row.name)) continue;
      this.lines.push(state.sliceDoc(row.from, row.to));
      this.offsets.push(row.from - node.from);
    }
    this.source = this.lines.join("\n");
  }

  eq(other) {
    return this.source === other.source && this.offsets.every((offset, i) => offset === other.offsets[i]);
  }

  render(doc) {
    const purifier = DOMPurify.sanitize ? DOMPurify : DOMPurify(doc.defaultView);
    return purifier.sanitize(renderMarkdown(this.source, [], "", { compactPreview: true }), {
      RETURN_DOM_FRAGMENT: true,
      ALLOWED_TAGS: ["table", "thead", "tbody", "tr", "th", "td", "strong", "em", "s", "code", "span", "br", "sup", "sub"],
      ALLOWED_ATTR: ["style"], ALLOW_DATA_ATTR: false,
    });
  }

  cellOffset(rowIndex, column) {
    const row = rowIndex ? rowIndex + 1 : 0; // The Markdown alignment row has no displayed cells.
    const line = this.lines[row];
    let start = /^\s*\|/.exec(line)?.[0].length ?? 0;
    for (const match of line.matchAll(/\\.|\[\[[^\]\n]+\]\]|\|/g)) {
      if (match[0] !== "|" || match.index < start) continue;
      if (column-- === 0) return this.offsets[row] + start + line.slice(start, match.index).trimEnd().length;
      start = match.index + 1;
    }
    return this.offsets[row] + line.trimEnd().length;
  }

  toDOM(view) {
    const doc = view.dom.ownerDocument, box = doc.createElement("div");
    box.className = "cm-live-table";
    box.tabIndex = 0;
    box.append(this.render(doc));
    const edit = offset => {
      if (view.state.readOnly) return;
      const anchor = view.posAtDOM(box) + offset;
      view.focus();
      view.dispatch({ selection: { anchor }, userEvent: "select.table", scrollIntoView: true });
    };
    let down;
    box.addEventListener("mousedown", event => {
      if (event.button !== 0) return;
      down = { x: event.clientX, y: event.clientY };
      box.focus({ preventScroll: true });
    });
    box.addEventListener("click", event => {
      const cell = event.target.closest("th,td");
      if (!cell || (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 3)) return;
      edit(this.cellOffset(cell.parentElement.rowIndex, cell.cellIndex));
    });
    box.addEventListener("keydown", event => {
      if (event.key === "Enter" && !view.state.readOnly) {
        event.preventDefault();
        edit(this.cellOffset(0, 0));
      }
    });
    box.addEventListener("copy", event => {
      const selection = doc.getSelection();
      if (!selection || selection.isCollapsed || !box.contains(selection.anchorNode) || !box.contains(selection.focusNode)) return;
      event.preventDefault();
      event.stopPropagation();
      event.clipboardData.setData("text/plain", selection.toString());
    });
    return box;
  }
}
