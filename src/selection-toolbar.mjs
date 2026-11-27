import { StateEffect, StateField } from "@codemirror/state";
import { keymap, showTooltip } from "@codemirror/view";
import { textSizeOptions } from "../core/text-size-options.mjs";

const dismiss = StateEffect.define();

export function selectionToolbar(apply, colors) {
  function create(view) {
    const dom = document.createElement("div");
    dom.className = "selection-format-menu";
    dom.setAttribute("role", "toolbar");
    dom.setAttribute("aria-label", "선택 영역 미니 서식");
    const button = (label, text, action) => {
      const el = document.createElement("button");
      el.type = "button";
      el.textContent = text;
      el.title = label;
      el.setAttribute("aria-label", label);
      el.onmousedown = event => event.preventDefault();
      el.onclick = () => apply(view, action);
      dom.append(el);
    };
    const select = (label, options, change) => {
      const el = document.createElement("select");
      el.setAttribute("aria-label", label);
      el.add(new Option(label, ""));
      el.options[0].disabled = true;
      for (const [name, value] of options) el.add(new Option(name, value));
      el.onchange = () => {
        change(el.value);
        el.value = "";
      };
      dom.append(el);
    };
    button("선택 굵게", "B", "bold");
    select("글자색", colors, color => apply(view, "apply-color", color));
    select("크기", textSizeOptions.map(option => [option.label, option.id]), id => apply(view, id));
    button("선택 노란 형광펜", "형광펜", "highlight");
    button("선택 형광펜 지우기", "지우기", "clear-highlight");
    dom.onkeydown = event => {
      if (event.key === "Escape") {
        event.stopPropagation();
        view.focus();
        view.dispatch({ effects: dismiss.of(null) });
      }
    };
    return { dom };
  }

  function tooltip(state) {
    const range = state.selection.main;
    if (state.readOnly || range.empty) return null;
    // A native right-click can select the newline and put the toolbar over the insertion point.
    const line = state.doc.lineAt(range.from);
    if (range.to <= line.to + 1 && !line.text.trim()) return null;
    return { pos: range.head, above: true, create };
  }
  const field = StateField.define({
    create: tooltip,
    update(previous, tr) {
      if (tr.effects.some(effect => effect.is(dismiss))) return null;
      if (tr.docChanged || !tr.startState.selection.eq(tr.state.selection) || tr.startState.readOnly !== tr.state.readOnly)
        return tooltip(tr.state);
      return previous;
    },
    provide: field => showTooltip.from(field)
  });
  return [field, keymap.of([{ key: "Escape", run(view) {
    if (!view.state.field(field)) return false;
    view.dispatch({ effects: dismiss.of(null) });
    return true;
  } }])];
}
