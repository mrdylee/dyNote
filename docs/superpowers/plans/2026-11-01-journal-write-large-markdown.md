# Journal writing and large Markdown implementation plan

> **For agentic workers:** Execute inline with superpowers:executing-plans. Track changing task status in claude-mem work_state_write.

**Goal:** Start a journal in the focused Write editor and remove the arbitrary 8 MiB Markdown file limit.

**Architecture:** Keep existing periodic-note creation and editor modes. Use the existing editor-command channel to focus the end of a journal after creation/opening and consume the command once. Exempt Markdown from Vault size guards and remove Markdown composition/classification guards; retain validation and limits for other formats.

**Tech stack:** React, CodeMirror, Electron, Node tests and existing Playwright Electron verification scripts.

## Scope and assumptions

- “오늘 기록 시작” and periodic-note open/create actions should enter edit mode with the cursor at the end, ready for typing. Do not create a file merely by opening the journal feed.
- Existing manual document modes stay unchanged. The focus request must not steal focus again during later saves or dialogs.
- Remove the Markdown byte cap, rather than replace it with another arbitrary number. Finite memory and rendering cost still apply.
- Retain UTF-8 decoding, path/symlink checks, revision conflicts, recovery copies and atomic writes. Retain Canvas/Bases, plugin and image limits.
- AI providers are optional alternatives. No Claude installation or login is required for journal/file work.
- Preserve all existing uncommitted changes and user data. No public release or Git push is in scope.

## Implementation and verification

1. Add failing Vault tests using UTF-8/BOM/CRLF Markdown above 8 MiB: existing-file snapshot, creation/open-or-create, save with exact recovery, and batch changes. Retain non-string and structured-file guard checks. Run `node --test tests/vault.test.mjs` and inspect expected size failures.
2. Replace the merged-result rejection regression with a greater-than-8-MiB roundtrip/recovery check. Add a classification result crossing 8 MiB while preserving the source. Run `node --test tests/note-composer.test.mjs tests/journal-classification.test.mjs` and inspect expected size failures.
3. Add `scripts/verify-journal-write-large-markdown.mjs` using an isolated vault/profile. Start a fresh journal and assert editor focus/end selection before typing without a click. Verify saved text, reopen behavior, focus retention and a large-file edit/save/restart. Run against the current build to reproduce missing focus.
4. Modify only the relevant guards in `core/vault.mjs`, `core/note-composer.mjs`, `core/journal-classification.mjs`; request and consume end focus once through the existing editor command in `src/App.jsx`. Update README's obsolete size-limit statement.
5. Run focused tests, `npm test`, `npm run build`, `git diff --check`, the new native script and existing journal/editor regressions. Inspect exact disk bytes and renderer errors.
6. Package to a disposable directory, verify source/bundle bytes and signature, run the native script on that final package, then safely back up/update the local Mac installation after a normal quit. Preserve profile/auth/notes. Record results and any actual limit observed.
