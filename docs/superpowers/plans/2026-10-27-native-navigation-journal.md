# Native Navigation and Journal Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans by default for continuous inline implementation. Use superpowers:subagent-driven-development only when the user explicitly requested subagents or parallel agent work. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deliver the first tested native slice: persistent navigation, commands, calendar and five periodic note families with templates.

**Architecture:** Pure date/template/navigation functions sit beside existing core services. A native journal component uses existing create/save IPC, with exclusive open-or-create supplied by Vault. App integration preserves SaveQueue and vault identity.

**Tech Stack:** React, Electron, CodeMirror 6, Node test runner, Moment date formatting compatible with observed original formats.

---

### Task 1: Capture original and requirement fixtures

Files: `docs/verification/obsidian-plugin-inventory.md`; ignored `output/research/obsidian-native-fixture/`.

- [x] Load the eleven installed program files and manifests in the isolated synthetic Obsidian profile. Record actual version, loaded IDs and commands without reading personal notes/settings.
- [x] Execute original daily/calendar/recent commands; record created paths and active file. Capture weekly/quarterly/yearly defaults from exact installed program source. Distinguish static findings from executed cases.

### Task 2: Test date, template and navigation semantics

Files: create `tests/native-workflows.test.mjs`, `core/periodic-notes.mjs`, `core/navigation.mjs`; modify `package.json` and lockfile only for the date dependency.

- [x] Write tests before implementations: `periodicNote('daily', '2026-10-27', prefs)` gives `Daily/2026-10-27.md`; week/year boundaries use explicit locale; malformed dates/path traversals reject; bracket literals and nested folders format correctly.
- [x] Verify quarterly start, leap day and same period paths. Template `{{title}} / {{date:YYYY-MM-DD}} / {{time:HH:mm}}` uses supplied clock; CRLF remains unchanged.
- [x] Verify `visit`, `bookmark`, `rename`, `remove` actions maintain ordered unique paths and independent storage keys; reconcile deletes missing documents.
- [x] Run `node --test tests/native-workflows.test.mjs` and observe missing-feature failures. Implement exported pure functions to satisfy each case; rerun.

### Task 3: Exclusive open-or-create

Files: modify `core/vault.mjs`, `electron/main.mjs`, `electron/preload.cjs`, `tests/vault.test.mjs`, `tests/preload.test.mjs` as needed.

- [x] Test `Promise.all([vault.openOrCreate('Daily/2026-10-27.md','first'), vault.openOrCreate('Daily/2026-10-27.md','second')])` returns the same revision/content; disk contains the first content. Existing note must not be modified.
- [x] Run the vault test, verify the missing method fails, then implement serialized `openOrCreate` through the same validated-path reader and exclusive create path. Expose only the narrow IPC call and retain sender/vault checks.
- [x] Rerun vault/preload/security tests; check malformed and symlink paths are still rejected.

### Task 4: Native panels and command entry points

Files: create `src/JournalPanel.jsx`, `src/NavigationPanel.jsx`; modify `src/App.jsx` and `src/styles.css`.

- [x] Add per-vault navigation hydration and persistence; recent documents update on actual open and rename/delete only after mutation success.
- [x] Add command modal with query, keyboard choice/Enter, disabled actions and Escape. Keep document switcher on Cmd/Ctrl+K, commands on Cmd/Ctrl+P.
- [x] Journal panel: date/month navigation, period selector, configured folders/formats/templates and existing-note list. Missing dates show a create action; existing dates open without modification. Previous/next move among existing notes.
- [x] Template insertion dispatches one CodeMirror transaction at the selection; read-only/busy/draft restrictions remain respected. Every asynchronous result checks originating vault ID before updating UI.

### Task 5: Verify actual behavior and record remaining portfolio

Files: create `scripts/verify-native-workflows.mjs`, `docs/verification/native-workflows.md`; update README and portfolio status.

- [x] Launch real Dynote using a disposable profile and synthetic two-note vault. Open palette via keyboard; execute recent/journal commands; create a dated note from a template; edit it; reopen same date; verify disk content remains edited.
- [x] Bookmark a note, restart app, verify recents/bookmarks and date preferences persist. Test second-vault isolation and rename/delete reconciliation. Assert no renderer errors.
- [x] Run `npm test` and `npm run build`. Record test totals and runtime screenshots. Mark only completed requirements as verified; all remaining eleven-plugin/core portfolio tasks stay open.
