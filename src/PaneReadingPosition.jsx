import { Component } from "react";
import { EditorView } from "@codemirror/view";
import { readSplitPosition, writeSplitPosition } from "./split-reading-position.mjs";

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

// Screen order differs from source order for footnotes. Populate the line map in
// DOM order so a child (a table row, for example) wins over its container.
function indexBlocks(preview) {
  const blocks = [...preview.querySelectorAll("[data-source-lines]")].filter(el => !el.closest("[data-embed]"));
  const lines = [];
  for (const block of blocks) {
    const [start, end] = blockLines(block);
    for (let line = start; line < end; line++) lines[line] = block;
  }
  // Hidden YAML, blank lines and table separators use the nearest body block.
  let previous = -1;
  for (let line = 0; line < lines.length; line++) {
    if (!lines[line]) continue;
    for (let gap = previous + 1; gap < line; gap++)
      lines[gap] = previous < 0 || line - gap < gap - previous ? lines[line] : lines[previous];
    previous = line;
  }
  return { blocks, lines };
}

function previewAnchor(preview, y, index) {
  const x = preview.getBoundingClientRect().left + preview.clientWidth / 2;
  const hit = preview.ownerDocument.elementFromPoint(x, y)?.closest("[data-source-lines]");
  let block = hit && preview.contains(hit) && !hit.closest("[data-embed]") ? hit : null;
  if (!block) {
    // A gutter or paragraph margin can have no hit. Locate its visual neighbours.
    const blocks = index.blocks;
    let low = 0, high = blocks.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (blocks[mid].getBoundingClientRect().top <= y) low = mid + 1;
      else high = mid;
    }
    const before = blocks[low - 1], after = blocks[low];
    block = before && after
      ? (y - before.getBoundingClientRect().bottom <= after.getBoundingClientRect().top - y ? before : after)
      : before ?? after;
  }
  if (!block) return null;
  const { start, end, top, height } = blockPosition(block, { y });
  const ratio = Math.max(0, Math.min(1, (y - top) / (height || 1)));
  const source = start + ratio * (end - start);
  const line = Math.min(end - 1, Math.floor(source));
  return { line, fraction: source - line, offset: top + ratio * height - y };
}

function previewTop(index, { line, fraction }) {
  const block = index.lines[Math.min(line, index.lines.length - 1)];
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

  blocks() {
    const root = this.props.preview.current;
    if (this.props.mode !== "split") return indexBlocks(root);
    if (this.indexRoot !== root || !this.index) {
      this.indexRoot = root;
      this.index = indexBlocks(root);
    }
    return this.index;
  }

  scroller(mode, reading) {
    if (mode === "split")
      return reading ? this.props.preview.current?.parentElement : this.props.editor.current?.scrollDOM;
    return this.props.header.current.closest(".document-pane");
  }

  top(mode, scroller) {
    return (mode === "split" ? scroller.getBoundingClientRect().top :
      this.props.header.current.closest(".pane-header").getBoundingClientRect().bottom) + 1;
  }

  capture(mode) {
    if (this.pending) return this.pending;
    const reading = this.usesPreview(mode);
    const pane = this.scroller(mode, reading);
    if (!pane) return null;
    if (pane.scrollTop <= 0) return { start: true };
    const y = this.top(mode, pane);
    if (reading) {
      const anchor = previewAnchor(this.props.preview.current, y, this.blocks());
      if (anchor) return anchor;
    }
    const view = this.props.editor.current;
    if (!view) return null;
    const pos = view.posAtCoords({ x: view.contentDOM.getBoundingClientRect().left + 24, y }, false);
    const line = view.state.doc.lineAt(pos);
    return { line: line.number - 1, fraction: (pos - line.from) / (line.length || 1), offset: (view.coordsAtPos(pos)?.top ?? y) - y };
  }

  watchSplit() {
    this.stopSplit?.();
    this.index = null;
    if (this.props.mode !== "split") return;
    const preview = this.props.preview.current;
    const pane = preview.closest(".document-pane");
    let frame;
    let correction;
    const applied = new WeakMap();
    const move = (scroller, top) => {
      scroller.scrollTop = top;
      applied.set(scroller, scroller.scrollTop);
    };
    const sync = () => {
      frame = null;
      cancelAnimationFrame(correction);
      const reading = this.props.readingPreview.current;
      const source = this.scroller("split", reading), target = this.scroller("split", !reading);
      if (!source || !target || source.scrollHeight <= source.clientHeight) return;
      if (source.scrollTop <= 0) { move(target, 0); return; }
      if (source.scrollTop >= source.scrollHeight - source.clientHeight - 1) {
        move(target, target.scrollHeight);
        return;
      }
      const anchor = this.capture("split");
      if (!anchor || anchor.start) return;
      const view = this.props.editor.current;
      let top;
      if (reading) {
        const pos = editorPosition(view, anchor.line, anchor.fraction);
        const measured = view.coordsAtPos(pos);
        top = measured?.top ?? view.documentTop + view.lineBlockAt(pos).top;
        if (!measured) {
          // A large jump first materializes a virtualized line. Correct its wrapped
          // position once CodeMirror has measured it, unless input changed sides.
          const doc = view.state.doc;
          correction = requestAnimationFrame(() => {
            if (doc !== view.state.doc || !this.props.readingPreview.current) return;
            const rect = view.coordsAtPos(pos);
            if (rect) move(target, target.scrollTop + rect.top - this.top("split", target) - anchor.offset);
          });
        }
      } else top = previewTop(this.blocks(), anchor);
      if (top != null) move(target, target.scrollTop + top - this.top("split", target) - anchor.offset);
    };
    const schedule = () => { if (frame == null) frame = requestAnimationFrame(sync); };
    const scroll = event => {
      const scroller = event.target;
      const previous = applied.get(scroller);
      applied.delete(scroller);
      if (previous === scroller.scrollTop) return;
      if (scroller === this.scroller("split", this.props.readingPreview.current)) schedule();
    };
    pane.addEventListener("scroll", scroll, true);
    const resize = new ResizeObserver(schedule);
    resize.observe(preview);
    resize.observe(preview.parentElement);
    const mutation = new MutationObserver(() => { this.index = null; schedule(); });
    mutation.observe(preview, { childList: true, subtree: true });
    this.stopSplit = () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(correction);
      resize.disconnect(); mutation.disconnect();
      pane.removeEventListener("scroll", scroll, true);
      this.stopSplit = null;
    };
    schedule();
  }

  componentDidUpdate(previous, _state, anchor) {
    if (previous.mode !== this.props.mode) this.watchSplit();
    if (previous.content !== this.props.content) this.index = null;
    if (previous.mode === "split" && this.props.mode !== "split") writeSplitPosition(this.props.tabKey, null);
    if (previous.content !== this.props.content || previous.jump !== this.props.jump) { this.cancel(); return; }
    if (anchor) this.restore(anchor);
  }

  componentDidMount() {
    const { positions, tabKey, readingPreview, jump } = this.props;
    this.watchSplit();
    this.offClose = window.notes?.onBeforeClose(() => this.savePosition());
    const saved = positions.get(tabKey) ?? (this.props.mode === "split" && readSplitPosition(tabKey));
    if (!saved) return;
    positions.delete(tabKey);
    readingPreview.current = saved.preview;
    if (!jump) this.restore(saved.anchor);
  }

  restore(anchor) {
    this.cancel();
    const mode = this.props.mode;
    const pane = this.scroller(mode, this.usesPreview(mode));
    if (!pane) { this.frame = requestAnimationFrame(() => this.restore(anchor)); return; }
    if (anchor.start) { pane.scrollTop = 0; return; }

    const preview = this.props.preview.current;
    const view = this.usesPreview(this.props.mode) ? null : this.props.editor.current;
    this.pending = anchor;
    const pos = view && editorPosition(view, anchor.line, anchor.fraction);
    const targetY = () => this.top(mode, pane) + anchor.offset;
    if (view) {
      // Ask CodeMirror to materialize the target before measuring its character.
      view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: targetY() - pane.getBoundingClientRect().top }) });
    }
    const align = () => {
      const measured = view?.coordsAtPos(pos);
      const top = view ? measured?.top ?? view.documentTop + view.lineBlockAt(pos).top : previewTop(this.blocks(), anchor);
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
    const inputPane = this.props.header.current.closest(".document-pane");
    if (mode === "split") inputPane.addEventListener("focusin", this.cancel, options);
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"])
      inputPane.addEventListener(event, this.cancel, options);
    schedule();
  }

  cancel = () => {
    cancelAnimationFrame(this.frame);
    this.resize?.disconnect();
    this.rendered?.disconnect();
    this.events?.abort();
    this.pending = null;
  };
  savePosition() {
    const { positions, tabKey, mode, readingPreview } = this.props;
    const anchor = this.capture(mode);
    if (!anchor) return;
    const position = { anchor, preview: readingPreview.current };
    positions.set(tabKey, position);
    if (mode === "split") writeSplitPosition(tabKey, position);
  }
  componentWillUnmount() {
    this.stopSplit?.();
    this.offClose?.();
    this.savePosition();
    this.cancel();
  }
  render() { return this.props.children; }
}
