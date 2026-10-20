# Daily backup and settings implementation plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: superpowers:executing-plans. Inline execution, no subagents.

**Goal:** Keep local saves independent while adding daily Git backup, persistent vault settings, and safe calendar-based restore.

**Architecture:** Extend the existing Git controller with persisted daily scheduling and retry state. Add a small vault registry and Git-history reader; perform snapshot replacement through the Vault write queue. Settings tabs call narrow, validated Electron IPC.

**Tech Stack:** Existing Node/Electron, React, node:test, Git subprocesses and Playwright Electron harness. No new dependencies.

## 1. Scheduling and retry

- [x] Extend `tests/git-backup.test.mjs` with an injected clock and real temporary Git: same-day ticks/restarts do not create another automatic commit, next-day late backup runs, missed previous day catches up, offline retry pushes the recorded commit without adding new edits, manual sync remains possible. First run must fail.
- [x] `core/git-backup.mjs`: normalize daily config, accept binary Git output for later blob reads, provide `sync(config, {commit, onCommit})` with the callback persisted before network upload.
- [x] `electron/git-controller.mjs`: derive local day keys, poll once per minute, check daily due state, persist commit day/pending SHA, migrate old success timestamp, enqueue catch-up without awaiting network on startup. Restore operations share this queue.
- [x] `node --test tests/git-backup.test.mjs` must pass after implementation.

## 2. Persistent vault selection

- [x] `tests/vault-registry.test.mjs`: legacy root migration, atomic selection, repeated opens, forgetting a non-active item without deleting files, missing selected path remains selected.
- [x] Add `electron/vault-registry.mjs`; update `electron/main.mjs` startup to preserve app-data location and expose unavailable-vault state instead of demo fallback.
- [x] Add registered-vault list/select/forget IPC. Existing folder picker and Git clone remember selected root via the registry.

## 3. Git history and snapshot restoration

- [x] `tests/git-history.test.mjs`: month/day records, supported-file snapshot, current tree fingerprint, binary bytes, removal of newer notes, untouched unsupported files and HEAD, stale-preview refusal, symlink/foreign commit/staged-work refusal. Run red before implementation.
- [x] Add `core/git-history.mjs` with fixed-argument log/tree/blob queries, full-SHA and ancestor validation, month limits, restore preview and execution.
- [x] Add Vault capture/apply snapshot methods in `core/vault.mjs`, serialized by the existing queue. Save a full recovery copy first, validate each target, compare revisions, apply atomic per-file replacements, and roll back own applied changes on failure when safe.
- [x] Verify synthetic history restoration changes only the intended files, leaves Git history unchanged and preserves the pre-restore files outside the vault.

## 4. Settings UI and desktop wiring

- [x] Add native settings menu/accelerator and preload subscription. Rename the existing settings entry to Settings.
- [x] Add settings navigation, `src/VaultSettings.jsx`, `src/GitHistory.jsx`; move existing font/Git panels into the tabs. Replace interval input with daily schedule explanation and latest daily/remote status.
- [x] Calendar has previous/next month, marked enabled backup days, record choice, changed-file preview, explicit restore confirmation and a recovery path on success.
- [x] Flush local drafts before switching vault or preparing restoration. Prevent app edits and other mutations during confirmed restore; refresh model afterward.

## 5. Verify and document

- [x] Run `npm test` and `npm run build`. Update settings runtime harness for the new UI and daily behavior; add actual Electron vault/calendar/restore checks.
- [x] Use only isolated profiles/vaults/bare remotes. Verify both same-day restart and seeded previous-day startup at runtime without changing the system clock.
- [x] Inspect screenshots and final diff. Update current README and `docs/FONTS-GIT.md`, keep historical release evidence unchanged.
- [x] Commit the verified local implementation and report what is implemented versus published/installed.


## Verification outcome

2026-10-20: 113 Node tests passed, production build passed (existing chunk-size warning). Both Electron harnesses passed against the packaged macOS arm64 app, including the minimum window size, native settings menu, local save/daily backup, offline retry, persistent vault selection and restore/recovery contents. A re-enable status regression and case-only restore collision were reproduced and corrected. Runtime evidence is in `docs/verification/daily-settings-runtime.json` and `vault-history-runtime.json`. Windows native execution and publication are outside this completed local change.
