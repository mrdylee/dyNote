# Font preferences and Git backup implementation plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for continuous inline implementation. No subagents. Steps use checkboxes for tracking.

**Goal:** Persist installed-font preferences and provide configurable automatic Git backup of the open vault.

**Architecture:** Validated font preferences feed CSS variables and a standalone settings component. A Git service handles scoped repository operations; an Electron controller owns per-vault settings, serialized scheduling and status IPC. Existing local SaveQueue remains authoritative.

**Tech Stack:** React, Electron, Chromium Local Font Access, Node child_process, system Git, node:test and the existing Playwright Electron harness.

## 1. Font behavior
- [ ] Add `tests/preferences.test.mjs`: malformed stored values fall back, numeric bounds are enforced, quoted family names remain one CSS value, unrelated permissions remain denied.
- [ ] Run `node --test tests/preferences.test.mjs` and confirm missing implementation fails.
- [ ] Add `core/font-preferences.mjs`, trusted font permission predicate in `core/security.mjs`, `src/FontSettings.jsx`, preferences state in `src/App.jsx`, scoped CSS variables and graph label updates. Settings must not alter note content.
- [ ] Run the focused tests and an Electron probe that enumerates installed fonts, applies two distinct families, verifies computed CSS and reload persistence.

## 2. Git operations
- [ ] Add `tests/git-backup.test.mjs` using temporary work/bare repositories, isolated author settings and `https://backup.test/notes.git` rewritten to the bare path. Assert remote content equals local Markdown after sync; secret/unsupported files stay untracked; a second unchanged sync adds no commit.
- [ ] Add failure cases: staged changes, remote ahead, invalid URLs/branches, ancestor repository, symlink, offline push/retry and empty-folder clone.
- [ ] Run the tests to confirm missing service fails, implement `core/git-backup.mjs` using argv-only Git subprocesses, and rerun until green.

## 3. Settings, scheduling and UI
- [ ] Add controller tests for per-vault persistence, reconnect, paused timers, serialized operations and visible retry state. Implement `electron/git-controller.mjs` with atomic app-data persistence.
- [ ] Add trusted IPC routes/subscriptions in `electron/main.mjs` and `electron/preload.cjs`; add `src/GitSettings.jsx`. Expose repository, branch, author and interval fields; connect/clone/sync/disconnect actions and a distinct status-bar indicator.
- [ ] The manual Git action flushes local drafts first. Clone switches vault only after successful completion. The main-process timer backs up saved disk content and survives closing the settings dialog.

## 4. Review and verification
- [ ] Run `npm test`, then `npm run build` sequentially.
- [ ] Add/run `scripts/verify-settings-runtime.mjs`: enumerate actual local fonts; save/reopen; exercise Git settings and automatic saved-note upload to the synthetic remote; verify disconnect and local save independence.
- [ ] Run the existing Live Preview runtime harness. Inspect screenshots and the final diff; fix any reproduced regression.
- [ ] Document configuration, authentication, automatic backup limits and measured verification in `docs/FONTS-GIT.md`; commit locally and report current publication status accurately.
