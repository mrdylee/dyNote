# Canvas and Bases Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for inline execution. No subagents were requested.

**Goal:** Add usable local Canvas and Bases editors without weakening existing save/recovery boundaries.

**Architecture:** Add focused format modules and extend Vault through explicit structured-document APIs. Connect React Flow and a worker-based Bases evaluator to the existing App/save queue.

**Tech Stack:** React, Electron, YAML, React Flow 12.12.0, obsidian-bases-expression 0.3.0-rc.4, node:test.

### 1. Review and format/storage contracts

- [x] Review `core/vault.mjs`, `core/links.mjs`, `core/security.mjs`, `src/saveQueue.mjs`, `electron/main.mjs`, `src/App.jsx`; run `npm test` (40/40), `npm audit` (0).
- [ ] Add `tests/structured.test.mjs`: assert `Vault.createDocument` exists; create `.canvas`/`.base`, edit with a revision, reject stale writes, preserve unknown JSON, move a referenced note and trash/restore a structured file. Run `node --test tests/structured.test.mjs` and observe the missing feature failure.
- [ ] Create `core/canvas.mjs`, `core/bases.mjs`, and `core/documents.mjs`; add `createDocument`/`saveDocument`, `snapshot.documents`, relocation and recoverable writes to `core/vault.mjs`. Keep `save` restricted to `.md`.
- [ ] Add tests for Korean Base filtering/formulas/grouping, invalid config and property edits preserving comments/body. Run them red before adding the engine and YAML patching.
- [ ] Run `npm test`; commit the tested format/storage layer.

### 2. Native integration and editors

- [ ] Extend preload/main with `create-document`/`save-document`, retaining sender/vault checks.
- [ ] Create `src/CanvasEditor.jsx` using React Flow custom cards, JSON-preserving serialization, undo/redo and existing safe file/external open callbacks.
- [ ] Create `src/BasesView.jsx` and `src/bases.worker.mjs`; run data queries in a cancellable Worker, render table cells and edit note properties through the save queue. Preserve configuration source and display unsupported settings.
- [ ] Connect document tree/tabs, creation modal, draft tracking, move/trash and close flush in `src/App.jsx`; add focused styles in `src/styles.css`. No unrelated refactor or graph redesign.
- [ ] Verify native UI on a temporary vault: create/edit/reopen both formats, resize/move/connect cards, edit a Base property and independently read the Markdown; move a referenced note and confirm the Canvas path.

### 3. Delivery and review

- [ ] Review the diff against the spec, add regressions for discovered faults, and run `npm test`, `npm run build`, `npm audit`, `git diff --check`.
- [ ] Update README, THIRD_PARTY_NOTICES and verification records with exact support/limits.
- [ ] Package Mac arm64 and Windows x64, compare packaged sources and checksum ZIPs. Windows runtime remains untested unless a Windows host is available.
- [ ] Commit verified work on the feature branch. Report local artifacts, review findings and limitations without claiming a new GitHub release.
