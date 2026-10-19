# Live Preview Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans by default for continuous inline implementation. Use superpowers:subagent-driven-development only when the user explicitly requested subagents or parallel agent work. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add the approved first phase of inline Markdown Live Preview without changing stored Markdown or breaking existing editor behavior.

**Architecture:** A CodeMirror syntax extension recognizes wiki links; a StateField directly provides selection-aware decorations and widgets. A Compartment in the existing Editor toggles live/source rendering. Existing vault URLs, navigation and SaveQueue remain authoritative.

**Tech Stack:** React, CodeMirror 6, Electron, Node test runner, existing Electron runtime verification harness pattern.

---

## 1. Decoration model and tests
- [x] Add `tests/live-preview.test.mjs` with failing state tests: inactive syntax hides, active/nested syntax reveals, code/frontmatter/HTML/table exclusion, Markdown/wiki link labels, local raster images only.
- [x] Implement `src/live-preview.mjs`: wiki grammar, syntax range collection, marks/replacements, checkbox/image widgets, composition mapping and link events. Reuse `attachmentUrl` and `resolveLink`.
- [x] Run `node --test tests/live-preview.test.mjs`; verify raw source identity, checkbox undo, read-only and composition transitions.

## 2. Editor and UI integration
- [x] Update `src/Editor.jsx` with a live/source Compartment, fresh context/navigation callbacks and composition-safe refresh.
- [x] Update `src/App.jsx` with Live Preview mode, link routing and preview render gating. Keep source/split/read available.
- [x] Add scoped styling in `src/styles.css`; keep existing source layout unchanged.
- [x] Test actual EditorView source/live switching: selection/history/document identity and widget behavior.

## 3. Runtime validation and review
- [x] Add `scripts/verify-live-preview-runtime.mjs`, using a temporary profile/vault and the existing Electron launch approach. Exercise editing, toggles, checkbox undo, local image load, link navigation, paste/drop, persistence and reopening; record errors and screenshot under `output/playwright`.
- [x] Run `npm test`, `npm run build`, then the runtime harness against the built app. Inspect the screenshot and fix failures.
- [x] Review diff for source integrity, hidden syntax cursor behavior, unsafe URLs, listener/timer cleanup and unexpected changes. Document evidence and platform limits in `docs/LIVE-PREVIEW.md`.
- [x] Leave verified work on `feat/live-preview`; no release publication in this task.
