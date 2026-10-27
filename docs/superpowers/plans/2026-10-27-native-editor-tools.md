# Native Editor Tools Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans by default for continuous inline implementation. Use superpowers:subagent-driven-development only when the user explicitly requested subagents or parallel agent work. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add subtree-safe Outliner commands and native Mermaid authoring with real editor undo verification.

**Architecture:** Pure text transformations handle subtree boundaries; CodeMirror adapters dispatch one transaction and folding effects. A small Mermaid component supplies original editable snippets and uses the current editor insertion path.

**Tech Stack:** Existing CodeMirror6, React and Mermaid12; Node test runner and actual Electron runtime.

---

### Task 1: Pure Outliner operations

Files: `core/outliner.mjs`, `tests/outliner.test.mjs`.

- [x] Write failing cases for `outlineEdit(text, offset, action)` returning `{content, offset}`. Input `- Parent\n  - Child\n- Sibling\n` must move the entire first subtree down, matching the original runtime output. Test inverse move, indent/outdent, nested descendants, root boundaries, EOF without newline and CRLF.
- [x] Test `outlineRange(text, offset)` returns the selected subtree range and folding span; fenced code and YAML contents produce null. Reject moving across unrelated paragraph boundaries.
- [x] Run `node --test tests/outliner.test.mjs`, confirm missing capability, implement line-preserving transformations and rerun.

### Task 2: Mermaid snippets and insertion

Files: `core/diagram-tools.mjs`, `tests/diagram-tools.test.mjs`, `src/MermaidTools.jsx`.

- [x] Test a catalog with twenty distinct families; run each original sample through `mermaid.parse` with a test DOM. Test outside-fence insertion yields one fenced block, inside-fence insertion yields body only and selected text is replaced once.
- [x] Implement the minimal catalog and `diagramInsertion(text, from, code)`; provide family selection and an editable code textarea.
- [x] Rerun parser tests with all families before UI integration.

### Task 3: CodeMirror and command integration

Files: `src/editorCommands.mjs`, `src/Editor.jsx`, `src/App.jsx`, `src/styles.css`.

- [x] Expose subtree move/indent/outdent/fold/unfold through command palette and editor bindings. Prefer subtree Tab/ShiftTab when a list operation is valid; preserve existing Tab behavior elsewhere.
- [x] Add folding service/gutter for nested lists. Block transformations on read-only documents; use a single undoable transaction and restore caret within the moved subtree.
- [x] Add native Mermaid command/dialog; capture editor selection before modal focus and restore it on insertion. Use existing save and rendering paths.

### Task 4: Actual editor verification

Files: `scripts/verify-editor-tools.mjs`, `docs/verification/native-workflows.md`.

- [x] Launch Dynote with a temporary profile containing the original synthetic list. Execute move-down, assert text and disk match original output, undo once and assert exact original.
- [x] Indent/outdent descendants; fold/unfold and assert saved bytes unchanged. Open Mermaid tools, insert one sample, undo once and confirm no snippet remains. Insert again and verify preview contains Mermaid SVG without renderer errors.
- [x] Run `npm test` and `npm run build`; record evidence and outstanding portfolio requirements accurately.
