import React from "react";
import { createRoot } from "react-dom/client";
import { fileForElement } from "./file-location.mjs";
import App from "./App.jsx";
import "./styles.css";
import "./journal-outline.css";

// Subframe context menus reach Electron without bubbling through the main document.
let clickedFile = null;
window.addEventListener("contextmenu", event => { clickedFile = fileForElement(event.target); }, true);
window.dynoteContextFile = (subframe, point) => subframe
  ? fileForElement(point ? document.elementFromPoint(point.x, point.y) : document.activeElement)
  : clickedFile;

createRoot(document.getElementById("root")).render(<App />);
