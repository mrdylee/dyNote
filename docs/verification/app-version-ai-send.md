# App version and AI send availability

2026-10-29 user scope: expose note-app version; diagnose prompt send control remaining disabled. Clarification: default AI context is the currently visible note.

## Actual observation and reproduction

CUA inspected the installed Mac app. Account was authenticated, Auto model selected and prompt nonempty, but the saved temporary vault did not exist and no current note was loaded. The send control was disabled without a composer-level explanation. This is distinct from earlier historical credential-store failures.

The isolated real Electron reproduction uses a nonexistent vault path and deterministic status/send IPC. Before the fix it reproduced disabled send and failed because Copilot 전송 상태 did not exist. No live prompt was submitted to a service.

## Changes

- Titlebar shows package version and opens Dynote 정보 with explicit current version. Existing updates page remains available.
- Send eligibility now supplies the same actionable explanation to the composer and disabled-button description/title: checking/auth/vault/busy/apply/drafts/model/current-note/selection/input states. Missing-vault action uses the existing folder picker; it never guesses or recreates a missing folder.
- Fresh connections use Auto only when the server explicitly advertises auto; valid explicit choices survive refresh. Other models still require selection.
- Ask can read current note while pending write drafts exist. Agent/Edit retain draft and recovery guards; auth, vault and valid context are still required.
- Default scope remains current document; a note switch captures the newly visible note. Explicit selection scope retains stale-selection and content-size protection.

## Verification

Five unit regressions in tests/copilot-send-state.test.mjs pass. Fresh full suite:269 passed,0 failed,0 skipped; build and git diff --check passed.

scripts/verify-ai-send-state.mjs passed five actual Mac source-app UI groups: missing-vault reason; picker recovery/Auto/current-note switching; Ask versus Agent pending draft protection with original bytes preserved; auth/model failure/recheck/prompt preservation; exact package version UI. Zero renderer errors. Transport is deterministic, not a live account/model test.

Existing composer regression passed Enter/Shift+Enter/IME229, no duplicate sends, completed Mermaid/table/sanitization and narrow-window layout. Its throwaway runner preserves host environment and writes its receipt to ignored output rather than replacing historical verification files.

Receipts: output/playwright/ai-send-state.json/png and copilot-composer-regression.json; /private/tmp/dynote-ai-send-final-tests.log, dynote-ai-send-final-build.log, dynote-ai-send-final-runtime.log, dynote-ai-send-composer-regression.log.

This turn changes source; installed-app replacement and publication were not performed. The actual user vault remains disconnected until the user opens their real notes folder. No credential/password/clipboard reads or security-setting changes. Concurrent editor/color/Planner work was preserved.
