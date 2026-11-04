# Drag-selected Outline Regions Implementation Plan

> Execute inline using Superpowers test-first implementation and completion verification. No subagents, commit, publication or installed-app replacement are requested. Preserve all prior working-tree changes.

**Goal:** Use REA-derived 30px nesting and a per-selection normal/journal mode choice with Bullet Threading included in journal mode in regular Markdown documents.

**Architecture:** `core/outline-regions.mjs` owns paired comment parsing, surgical marker edits and a narrowly scoped Markdown rendering rule. `src/outline-regions.mjs` owns CodeMirror region state, hidden/atomic preview boundaries, policy lookup and undoable commands. Reuse `src/journal-outline.mjs` for scoped commands, decorations and measured threads. `src/Editor.jsx` supplies a small regular-document toolbar.

**Tech stack:** Existing React, CodeMirror, MarkdownIt, Node test runner and native Electron/Playwright scenarios. No new dependency.

- [x] Add failing unit tests for region pairing, unified modes, malformed/nested/fenced/YAML exclusions, create/normal-mode removal, overlap refusal, CRLF and EOF byte preservation, source rendering, per-region command scoping, clipped subtree behavior and undo.
- [x] Implement pure region parsing/edits and hide only valid marker pairs in `core/markdown-extensions.mjs`.
- [x] Implement the CodeMirror state and region commands; reuse existing transaction and history conventions. Preserve unrelated ordinary-document behavior.
- [x] Generalize journal command/decorating scope; use measured 30px prefixes and retain the existing journal defaults. Enable keyboard policy and threading together.
- [x] Add regular-document selection controls and clear paragraph-conversion guidance. Keep current mode when moving inside a region and disable edits during read-only/composition.
- [x] Add a synthetic native drag-selection scenario for two independent regions, unified modes, hidden markers, ordinary text outside, commands, remove/undo, exact save/restart and screenshots. Run RED before connecting the UI.
- [x] Run focused and full unit tests, production build, new native region scenario, existing journal/threading scenarios, syntax/diff checks and local code review. Record the REA evidence and fresh verification limits.
