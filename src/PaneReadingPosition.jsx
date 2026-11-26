import { Component } from "react";
import { EditorView } from "@codemirror/view";

function editorPosition(view, line, fraction) {
  const source = view.state.doc.line(Math.min(line + 1, view.state.doc.lines));
  return source.from + Math.round(fraction * source.length);
}

function blockLines(block) {
  return block.dataset.sourceLines.split(":").map(Number);
}

// Within a multiline paragraph, each explicit break starts another source line.
// A long wrapped line can occupy much more space than its neighbours.
function blockPosition(block, { y, line }) {
  let [start, end] = blockLines(block);
  let { top, bottom } = block.getBoundingClientRect();
  if (block.tagName === "P" && end > start + 1) {
    const breaks = block.querySelectorAll("br");
    if (breaks.length === end - start - 1) {
      for (const br of breaks) {
        const next = br.getBoundingClientRect().bottom;
        if (y !== undefined ? y < next : line <= start) {
          bottom = next;
          break;
        }
        top = next;
        start++;
      }
      end = start + 1;
    }
  }
  return { start, end, top, height: bottom - top };
}

function nearestBlock(preview, point, bounds) {
  let nearest, distance = Infinity;
  for (const block of preview.querySelectorAll("[data-source-lines]")) {
    const [start, end] = bounds(block);
    const gap = Math.max(start - point, point - end, 0);
    if (gap > distance && start > point) break;
    if (gap <= distance) {
      nearest = block;
      distance = gap;
    }
  }
  return nearest;
}

function previewAnchor(preview, y) {
  const x = preview.getBoundingClientRect().left + preview.clientWidth / 2;
  const hit = preview.ownerDocument.elementFromPoint(x, y)?.closest("[data-source-lines]");
  const block = hit && preview.contains(hit) ? hit : nearestBlock(preview, y, el => {
    const rect = el.getBoundingClientRect();
    return [rect.top, rect.bottom];
  });
  if (!block) return null;
  const { start, end, top, height } = blockPosition(block, { y });
  const ratio = Math.max(0, Math.min(1, (y - top) / (height || 1)));
  const source = start + ratio * (end - start);
  const line = Math.min(end - 1, Math.floor(source));
  return { line, fraction: source - line, offset: top + ratio * height - y };
}

function previewTop(preview, { line, fraction }) {
  const block = nearestBlock(preview, line, el => {
    const [start, end] = blockLines(el);
    return [start, end - 1];
  });
  if (!block) return null;
  const { start, end, top, height } = blockPosition(block, { line });
  return top + height * Math.max(0, Math.min(1, (line + fraction - start) / (end - start)));
}

export default class PaneReadingPosition extends Component {
  usesPreview(mode) {
    return mode === "read" || (mode === "split" && this.props.readingPreview.current);
  }

  // Capture while the old editor/preview and its original layout still exist.
  getSnapshotBeforeUpdate(previous) {
    return previous.mode === this.props.mode ? null : this.capture(previous.mode);
  }

  capture(mode) {
    if (this.pending) return this.pending;
    const header = this.props.header.current.closest(".pane-header");
    const pane = header.parentElement;
    if (pane.scrollTop <= 0) return { start: true };
    const y = header.getBoundingClientRect().bottom + 1;
    if (this.usesPreview(mode)) {
      const anchor = previewAnchor(this.props.preview.current, y);
      if (anchor) return anchor;
    }
    const view = this.props.editor.current;
    if (!view) return null;
    const pos = view.posAtCoords({ x: view.contentDOM.getBoundingClientRect().left + 24, y }, false);
    const line = view.state.doc.lineAt(pos);
    return { line: line.number - 1, fraction: (pos - line.from) / (line.length || 1), offset: (view.coordsAtPos(pos)?.top ?? y) - y };
  }

  componentDidUpdate(previous, _state, anchor) {
    if (previous.content !== this.props.content || previous.jump !== this.props.jump) { this.cancel(); return; }
    if (anchor) this.restore(anchor);
  }

  componentDidMount() {
    const { positions, tabKey, readingPreview, jump } = this.props;
    const saved = positions.get(tabKey);
    if (!saved) return;
    positions.delete(tabKey);
    readingPreview.current = saved.preview;
    if (!jump) this.restore(saved.anchor);
  }

  restore(anchor) {
    this.cancel();
    const header = this.props.header.current.closest(".pane-header");
    const pane = header.parentElement;
    if (anchor.start) { pane.scrollTop = 0; return; }

    const preview = this.props.preview.current;
    const view = this.usesPreview(this.props.mode) ? null : this.props.editor.current;
    this.pending = anchor;
    const pos = view && editorPosition(view, anchor.line, anchor.fraction);
    const targetY = () => header.getBoundingClientRect().bottom + 1 + anchor.offset;
    if (view) {
      // Ask CodeMirror to materialize the target before measuring its character.
      view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: targetY() - pane.getBoundingClientRect().top }) });
    }
    const align = () => {
      const measured = view?.coordsAtPos(pos);
      const top = view ? measured?.top ?? view.documentTop + view.lineBlockAt(pos).top : previewTop(preview, anchor);
      if (top != null) {
        pane.scrollTop += top - targetY();
        if (!view || measured) this.pending = null;
      }
    };
    const schedule = () => {
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(align);
    };
    // Markdown parsing, wrapping and media can change heights after the first paint.
    this.resize = new ResizeObserver(schedule);
    this.resize.observe(view ? view.contentDOM : preview);
    if (view) {
      this.rendered = new MutationObserver(schedule);
      this.rendered.observe(view.contentDOM, { childList: true, subtree: true });
    }
    this.events = new AbortController();
    const options = { capture: true, passive: true, signal: this.events.signal };
    if (this.props.mode === "split") pane.addEventListener("focusin", this.cancel, options);
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"])
      pane.addEventListener(event, this.cancel, options);
    schedule();
  }

  cancel = () => {
    cancelAnimationFrame(this.frame);
    this.resize?.disconnect();
    this.rendered?.disconnect();
    this.events?.abort();
    this.pending = null;
  };
  componentWillUnmount() {
    const { positions, tabKey, mode, readingPreview } = this.props;
    const anchor = this.capture(mode);
    if (anchor) positions.set(tabKey, { anchor, preview: readingPreview.current });
    this.cancel();
  }
  render() { return this.props.children; }
}
