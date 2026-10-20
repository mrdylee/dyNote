# Copilot composer and diagrams implementation plan

> Execution: superpowers:executing-plans inline; REA's independent worker investigates shipped VS Code only.

**Goal:** Enter sends, Shift+Enter adds a line, compact Agent/model controls sit below the prompt, and completed Mermaid answers render safely.

**Architecture:** Keep the existing panel/controller and reviewed document writes. Reuse DiagramPreview with an opt-in class and rendering toggle; render diagrams only after completion to avoid repeated parsing while streaming. Auto remains a real model choice supplied by GitHub. Live document editing is an investigation deliverable, not enabled in this change.

**Stack:** React, Electron, MarkdownIt, DOMPurify, Mermaid, deterministic Electron runtime tests.

- [x] Add `scripts/verify-copilot-composer.mjs`: isolated vault and mocked IPC model responses; Enter/Shift+Enter, composition/keyCode229, repeated Enter, disabled send, lower-row geometry, valid and invalid Mermaid, safe SVG and Markdown tables. Run against current build and confirm the Enter test fails.
- [x] Modify `src/CopilotPanel.jsx`: common send guard (including pending ref), composition-aware Enter handler; move mode/model selectors below textarea, keep scope/attachment access compact; use DiagramPreview for assistant answers with rendering enabled only when complete.
- [x] Modify `src/DiagramPreview.jsx` only to accept className and renderDiagrams (defaults preserve document rendering). Modify scoped Copilot CSS for compact layout and diagram sizing; no new dependencies.
- [x] Run `npm test`, `npm run build`, composer runtime and existing agent runtime; inspect 1050x700 layout and screenshot. Fix failures before packaging.
- [x] Record REA live-edit findings separately with evidence boundaries, update `docs/COPILOT.md`, package Mac, run packaged composer smoke, install recoverably and verify UI. Commit the reviewed changes locally; no publication.
