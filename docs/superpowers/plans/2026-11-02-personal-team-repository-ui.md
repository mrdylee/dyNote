# Personal and Team Repository UI Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for continuous inline implementation. No subagents are requested.

**Goal:** Make personal/team folder and Git separation understandable during setup, editing and Git connection.

**Architecture:** Persist purpose metadata beside existing vault registry settings. Reuse vault selection and per-vault Git configuration. Keep current-space metadata guarded by vault identity. Existing notes, repository settings and access permissions are unchanged.

**Tech Stack:** Existing React, Electron IPC, Node test runner and native Electron/Playwright scripts; no dependencies.

---

### Task 1: Purpose metadata and separation

**Files:** `tests/vault-registry.test.mjs`, `electron/vault-registry.mjs`.

- [x] Add real temporary-folder tests. Legacy `list()[0].purpose` must be `null`. `select(personal,'personal')`, `select(team,'team')`, restart and select-without-purpose must preserve both assignments and existing note bytes. `setPurpose(root,'other')` and nested opposite-purpose roots must reject without changing settings bytes. Forgetting an inactive root removes only its metadata.
- [x] Run `node --test tests/vault-registry.test.mjs`; observe expected failures for the missing purpose behavior.
- [x] Add validated purpose storage to registry load/list/save/select/forget and a registered-folder `setPurpose`. Check canonical ancestor/descendant paths against opposite-purpose entries before saving. Keep legacy selection semantics.
- [x] Repeat the focused command and require every test to pass.

### Task 2: IPC and space UI

**Files:** `electron/main.mjs`, `electron/preload.cjs`, `src/App.jsx`, `src/VaultSettings.jsx`, `src/GitSettings.jsx`, `src/styles.css`, `scripts/verify-vault-spaces.mjs`.

- [x] Add native regression before UI changes: in a disposable legacy vault assert the current-space control says unclassified; select personal purpose and assert it survives restart. Stub only the native folder picker to select a second team folder. Assert separate purpose identities, nested rejection, exact note bytes and separate Git config. Exercise real IPC and existing Git services with local bare remotes, never a live account.
- [x] Run `DYNOTE_PLAYWRIGHT_MODULE=/Users/james_black/.npm/_npx/31e32ef8478fbf80/node_modules/playwright/index.mjs node scripts/verify-vault-spaces.mjs` and observe the missing UI failure.
- [x] Forward optional purpose through pick-vault and selectVault, preserving it during Git clone. Add purpose mutation IPC and the preload method; use existing exclusive mutation guard.
- [x] Add guarded registry metadata loading in App, persistent current-space badge/control, and settings callbacks. Keep flush-before-switch behavior. Do not rebuild note state when only purpose changes.
- [x] Add two purpose connection cards, purpose selectors, local paths and Git-settings entry in VaultSettings. Retain existing open/forget behavior. Label current space/path/configured remote in GitSettings, explain separate repos and label-versus-visibility distinction, and expose space management.
- [x] Add scoped responsive CSS; use text/icon labels as well as color. Re-run native regression, inspect screenshots and fix actual layout defects.

### Task 3: Regression and final package

**Files:** affected existing native scripts, `README.md`, local verification output.

- [x] Update existing native settings scripts only where labels intentionally changed. Run registry/Git focused unit tests, `npm test`, `npm run build`, syntax checks and `git diff --check`.
- [x] Run native space, settings/history, Git workspace and journal checks. Test failure preservation, purpose persistence, saved-editor switching and current-space Git addresses in fixtures.
- [x] Build `DYNOTE_PACKAGE_OUT=/private/tmp/dynote-vault-spaces-package npm run package:mac`. Verify exact packaged source/bundle files and strict deep signature; run native space and impacted regressions on that executable.
- [x] Review the final diff for scope and false privacy claims. Commit only this task's files, retaining unrelated local changes. No remote push/release.
- [x] If the actual installed app is saved and idle, preserve journal hashes, back up the bundle, stage/verify, quit normally and replace atomically with rollback retained. Relaunch and verify UI, provider choice, unchanged notes and no inferred personal/team purpose. If unsaved work is present, retain the prepared package without discarding it.

Completion: all implementation, review and final-package checks passed. The conditional local-install step retained the verified package because the actual app is running and the Mac is locked; no user work was discarded. See `docs/verification/2026-11-02-personal-team-repository-ui.md`.
