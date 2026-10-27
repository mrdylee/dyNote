# Native Mindmap Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans by default for continuous inline implementation. Use superpowers:subagent-driven-development only when the user explicitly requested subagents or parallel agent work. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement basic and rich native mindmap editing from the actual original formats.

**Architecture:** Pure parsers and surgical source transformations feed a React Flow view. SaveQueue persists Markdown; exclusive create makes conversions separate files and preserves originals.

**Tech Stack:** Existing YAML, React Flow, React, Node tests and Electron runtime.

---

### Task 1: Parse original formats and protect content

Files: `core/mindmap.mjs`, `tests/mindmap.test.mjs`, `tests/fixtures/markmind-rich.md`.

- [x] Capture the controlled Markmind conversion output as the rich fixture. Test basic headings/list parents while ignoring frontmatter/fences; rich fixture must yield Root -> First -> Child and Root -> Second by ID.
- [x] Test `editMindmap(source,id,action,value)` rename/add-child/add-sibling/delete updates only intended text/tree. Preserve unrelated YAML/body prose, CRLF and block IDs. Rich edits preserve unknown properties, style/auxiliary arrays and all unmodified nodes.
- [x] Test malformed/cyclic rich nodes reject without returning replacement content; rich move changes only finite coordinates; conversion hierarchy/text survives basic -> rich -> basic while source remains untouched.
- [x] Run `node --test tests/mindmap.test.mjs` and observe missing-feature failure; implement the minimal pure parser/editor/converter and rerun.

### Task 2: Native editor and integration

Files: `src/MindmapEditor.jsx`, `src/App.jsx`, `src/styles.css`.

- [x] Use parsed nodes/parents in React Flow, with fit/zoom/pan and selected-node name input. Native buttons rename, add child/sibling, delete subtree and collapse/expand. Keep a view-local undo/redo stack and route all source changes through onChange.
- [x] Render basic hierarchy with computed positions; rich uses stored finite coordinates and persists drag-end changes. Preserve unknown rich data on every write. Disable mutations while busy/read-only.
- [x] Add command palette and view segment entry points; invalid data displays an error with a Markdown-return button. New mindmap uses the existing exclusive document creation path with basic frontmatter.
- [x] Conversion buttons create a separate `-rich.md`/`-basic.md` with Vault.create, flush pending edits first, retain source and reject existing targets.

### Task 3: Actual format and editor roundtrip

Files: `scripts/verify-mindmap-tools.mjs`, `docs/verification/native-workflows.md`.

- [x] Launch actual Electron with synthetic basic and original-generated rich notes. Rename/add a child, save, reopen and assert exact node relationships.
- [x] Drag a rich node and assert persisted coordinates change while unknown style/auxiliary fields remain. Convert to a separate basic file and assert source bytes stay unchanged.
- [x] Verify undo and invalid-rich fallback. Run whole tests/build and record limitations, including original rich decorations and external/licensed services.
