# Font preferences and Git backup implementation plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for continuous inline implementation. No subagents. Steps use checkboxes for tracking.

**Goal:** Persist installed-font preferences and provide configurable automatic Git backup of the open vault.

**Architecture:** Validated font preferences feed CSS variables and a standalone settings component. A Git service handles scoped repository operations; an Electron controller owns per-vault settings, serialized scheduling and status IPC. Existing local SaveQueue remains authoritative.

**Tech Stack:** React, Electron, Chromium Local Font Access, Node child_process, system Git, node:test and the existing Playwright Electron harness.

## 1. Font behavior
- [x] Add `tests/preferences.test.mjs`: malformed stored values fall back, numeric bounds are enforced, quoted family names remain one CSS value, unrelated permissions remain denied.
- [x] Run `node --test tests/preferences.test.mjs` and confirm missing implementation fails.
- [x] Add `core/font-preferences.mjs`, trusted font permission predicate in `core/security.mjs`, `src/FontSettings.jsx`, preferences state in `src/App.jsx`, scoped CSS variables and graph label updates. Settings must not alter note content.
- [x] Run the focused tests and an Electron probe that enumerates installed fonts, applies two distinct families, verifies computed CSS and reload persistence.

## 2. Git operations
- [x] Add `tests/git-backup.test.mjs` using temporary work/bare repositories, isolated author settings and `https://backup.test/notes.git` rewritten to the bare path. Assert remote content equals local Markdown after sync; secret/unsupported files stay untracked; a second unchanged sync adds no commit.
- [x] Add failure cases: staged changes, remote ahead, invalid URLs/branches, ancestor repository, symlink, offline push/retry and empty-folder clone.
- [x] Run the tests to confirm missing service fails, implement `core/git-backup.mjs` using argv-only Git subprocesses, and rerun until green.

## 3. Settings, scheduling and UI
- [x] Add controller tests for per-vault persistence, reconnect, paused timers, serialized operations and visible retry state. Implement `electron/git-controller.mjs` with atomic app-data persistence.
- [x] Add trusted IPC routes/subscriptions in `electron/main.mjs` and `electron/preload.cjs`; add `src/GitSettings.jsx`. Expose repository, branch, author and interval fields; connect/clone/sync/disconnect actions and a distinct status-bar indicator.
- [x] The manual Git action flushes local drafts first. Clone switches vault only after successful completion. The main-process timer backs up saved disk content and survives closing the settings dialog.

## 4. Review and verification
- [x] Run `npm test`, then `npm run build` sequentially.
- [x] Add/run `scripts/verify-settings-runtime.mjs`: enumerate actual local fonts; save/reopen; exercise Git settings and automatic saved-note upload to the synthetic remote; verify disconnect and local save independence.
- [x] Run the existing Live Preview runtime harness. Inspect screenshots and the final diff; fix any reproduced regression.
- [x] Document configuration, authentication, automatic backup limits and measured verification in `docs/FONTS-GIT.md`; commit locally and report current publication status accurately.

## 5. User clarification: editable minutes, default 10
- [x] Replace preset intervals with a whole-minute number input; default to 10 and keep the URL empty until the user connects a repository.
- [x] Add tests for defaulting, custom intervals, timer conversion and persisted settings.
- [x] Run full tests/build and verify the packaged app: empty URL/default 10, invalid input, actual one-minute upload, arbitrary 17-minute setting and restart persistence.
- [x] Update user documentation, verification evidence and local commit; leave actual note remotes unconfigured.
