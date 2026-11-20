# Document Tabs Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for continuous inline implementation.

**Goal:** Background Copilot documents, destination saving, folder menus, and confirmed tab drag transfers with link return animation.

**Architecture:** Keep generated documents outside vault notes in a temporary disk store and mounted tab panels. Reuse existing Vault writes, file transfer validation, workspace tabs and CodeMirror transactions.

**Tech Stack:** React, Electron IPC, Node test, Playwright Electron.

- [x] Add behavior tests for temporary storage and Vault folder creation. Run `node --test tests/document-drafts.test.mjs tests/vault.test.mjs`; verify missing behaviors fail.
- [x] Implement `electron/document-drafts.mjs`, IPC/preload methods and `Vault.createFolder`, preserving exclusive creation and path validation.
- [x] Replace the blocking Copilot modal with mounted temporary tab panels in `src/App.jsx` and `src/CopilotDocument.jsx`. Keep request ownership per draft, persist content and preserve it on save failure. Save through `api.createNote` without global flush; reject only a pending edit at the destination.
- [x] Add root/folder/file context actions through `SpaceTrees`, `FileTree` and App. Reveal created folders and preserve other dirty state.
- [x] Give tabs both tree and tab-link drag types. Reuse tree transfer flow with Ctrl copy and a confirmation for every move. Preserve cross-vault copy link checks and make source removal recoverable.
- [x] Add tab-only body drop handling in `DocumentWorkspace`, insert using a CodeMirror transaction or append in read mode, and animate a cloned tab back to its source after successful insertion. Respect read-only and reduced-motion states.
- [x] Build and run focused Electron regression with a temporary profile and controlled AI events: background completion, tmp file, failed/valid save with other vault drafts, folder menus, move cancel/confirm, Ctrl copy, link insertion and animation. Run `npm test`, `npm run build`, relevant existing transfer tests; inspect git diff and report verified scope.
