import React from "react";
import { createRoot } from "react-dom/client";
import { fileForElement } from "./file-location.mjs";
import { EditorView } from "@codemirror/view";
import { undoDepth, redoDepth } from "@codemirror/commands";
import { availableBulletFormats } from "./editorCommands.mjs";
import App from "./App.jsx";
import "./styles.css";
import "./journal-outline.css";

// Subframe context menus reach Electron without bubbling through the main document.
let clickedFile = null;
window.addEventListener("contextmenu", event => { clickedFile = fileForElement(event.target); }, true);
window.dynoteContextFile = (subframe, point) => subframe
  ? fileForElement(point ? document.elementFromPoint(point.x, point.y) : document.activeElement)
  : clickedFile;

window.dynoteEditorContext = point => {
  const target = point ? document.elementFromPoint(point.x, point.y) : document.activeElement;
  const content = target?.closest('.code-editor .cm-content[contenteditable="true"]:not([aria-readonly="true"])');
  const view = content && EditorView.findFromDOM(content);
  if (!view || view.state.readOnly) return null;
  const position = point && view.posAtCoords(point, false);
  return { markdownEditor: true, bulletFormats: point && position == null ? [] : availableBulletFormats(view, position),
    canEditorUndo: undoDepth(view.state) > 0, canEditorRedo: redoDepth(view.state) > 0 };
};

createRoot(document.getElementById("root")).render(<App />);
