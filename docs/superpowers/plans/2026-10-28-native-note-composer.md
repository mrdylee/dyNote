# Native Note Composer Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans by default for continuous inline implementation. Use superpowers:subagent-driven-development only when the user explicitly requested subagents or parallel agent work. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add previewed selection/heading extraction, recoverable note merging and safe link-hover previews.

**Architecture:** Composer plans source/target/incoming-link changes from Vault.documentSnapshot and applies them through the serialized, revision-checked Vault.applyDocumentChanges. Recovery copies only affected documents, preserving unrelated attachment bytes without reading them. React modals show changes before apply; a separate hover component reuses read-only sanitized Markdown.

**Tech Stack:** Existing Vault/knowledge/link/metadata modules, YAML, React and CodeMirror.

---

### Task 1: Composition tests and core service

Files: `core/note-composer.mjs`, `tests/note-composer.test.mjs`.

- [x] Test merge against the observed source-wins scalar/tag-union fixture, preserving target body and rewriting incoming/outgoing links. Preview must not mutate files; apply removes source only after retaining recovery bytes.
- [x] Test selection/heading extraction to a new path, preserving source YAML/CRLF and replacing with a canonical link/embed. Rebase relative attachments and redirect moved heading/block references while leaving unrelated source references and fenced examples intact.
- [x] Test existing/case-colliding destinations, invalid paths/ranges, stale source/vault revisions and oversized resulting notes reject without overwriting.
- [x] Run the failing tests before implementing Composer.preview/apply and heading/range helpers; rerun after implementation.

### Task 2: Native preview/apply UI

Files: `electron/main.mjs`, `electron/preload.cjs`, `src/ComposerDialog.jsx`, `src/App.jsx`.

- [x] Expose narrow preview/apply calls with sender/vault validation and Git-controller serialization. Apply holds the exclusive vault lock and reloads the resulting snapshot.
- [x] Add selection/heading/merge commands. Flush current notes before preview, capture revision/selection/heading data, show every affected path plus before/after snippets. Editing parameters clears preview; apply uses the exact reviewed input.
- [x] Disable actions for pending AI edits/read-only/busy states; show recovery result and reject duplicate targets clearly.

### Task 3: Read-only hover component

Files: `src/NoteHover.jsx`, `src/App.jsx`, `src/styles.css`.

- [x] Delegate hover from resolved reading/live note links, delay preview, position within viewport and cancel on leave/document/modal/vault changes. External/unresolved/ambiguous links do not preview.
- [x] Render sanitized existing Markdown with readonly tasks and remote media restrictions. Open action navigates to the correct note; hover content cannot toggle another document's tasks.

### Task 4: Actual runtime and regressions

Files: `scripts/verify-note-composer.mjs`, `docs/verification/native-workflows.md`.

- [x] Launch actual Electron with synthetic notes, hover a link/open preview, select text and extract to a new file through preview/apply, then merge and verify source removal/metadata/links and recovery.
- [x] Modify a file after preview and verify apply is refused with original edits preserved. Run full tests/build and existing graph-drag runtime because App integration changed.
