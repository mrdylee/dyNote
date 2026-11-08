# Journal writing and large Markdown verification

## Changes

- Periodic journal open/create enters the existing Write editor and consumes a one-time command that puts the cursor at the end and focuses it after the editor is writable. The journal feed still creates no file until the user starts a record. Later saves/dialogs do not repeat the focus command.
- Markdown no longer has an application-defined 8 MiB limit in Vault read/create/save/batch changes, note composition or journal classification. Canvas/Bases, plugin and image limits remain scoped to their existing formats.
- UTF-8 validation, BOM/CRLF preservation, path/symlink protection, stale-revision rejection, atomic writes and recovery copies remain intact.
- AI providers remain optional alternatives. The selected provider alone supplies the shared AI session; no Claude installation/login was added or requested for document operations.

## Evidence

- Before implementation: five focused tests failed at the existing Markdown size guards. The corrected public-DOM focus check also failed against the previous installed package with the editor unfocused.
- After implementation: all 350 unit tests passed, zero failures/skips. Production build and `git diff --check` passed. Vite retains its existing chunk-size advisory.
- New native Electron checks passed on source and final Mac package: initial journal typing without an editor click; appending to an existing journal; later dialog focus retained; a 9,438,761-byte UTF-8/BOM/CRLF Markdown edit/save/restart with exact disk contents.
- The final package additionally passed eight existing journal workspace groups and six editor-tool groups, including pane modes, refresh, classification, restart settings, list commands/undo, folding and Mermaid. Total: 17 final-package groups, no renderer errors.
- Unit regressions also cover large-file creation/open-or-create, large batch writes, greater-than-8-MiB merge/classification, exact recovery bytes and retained structured-file/type guards.

## Local installation

Final package: `/private/tmp/dynote-journal-large-package/Dynote-darwin-arm64/Dynote.app`. All 278 packaged source/build/license files byte-match the workspace. Strict deep signature verification passed. ASAR SHA256: `4df94d49e4c8e5ffdeec03b696a794a260fdaad4b9cf560021616fbafe004fd6`.

Backed up the previous app to `/Users/james_black/Library/Application Support/Dynote Install Backups/2026-11-01-journal-large-_8fv3z9j/Dynote.app`, then replaced `/Applications/Dynote.app` after normal quit from a saved/idle state. Normal native launch retained the user's vault and selected Codex account/model. The existing size warning disappeared and the visible file count increased from 509 to 510. The formerly excluded 8,651,685-byte Markdown retained its original SHA256; no user note was edited for verification.

Receipts and native reports are under ignored `output/verification/journal-large-{package,install}.json` and `output/playwright/`. No public release or Windows runtime verification was performed. Removing the fixed byte cap does not remove machine memory or rendering constraints.
