# Document workspace and journal Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans by default for continuous inline implementation. Use superpowers:subagent-driven-development only when the user explicitly requested subagents or parallel agent work. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Three independent document panes, dated journal startup, source-preserving confirmed classification, and weekly verified update downloads.

**Architecture:** Shared document buffers and SaveQueue stay in App. A workspace hook manages visible paths and per-document mode; individual panes own editor/selection/preview refs. Classification and download writes run in the main process with revision and integrity checks.

**Tech Stack:** React, CodeMirror, Electron, MarkdownIt, Node test runner and isolated Playwright.

## 1. Workspace and journal
Files: `core/document-workspace.mjs`, `core/journal-start.mjs`, `src/useDocumentWorkspace.jsx`, `src/DocumentWorkspace.jsx`, `src/JournalFeed.jsx`, `src/App.jsx`, `src/styles.css`, `tests/document-workspace.test.mjs`.
- [x] Add failing assertions for `workspaceAction`: open A, add B/C, reject D, focus existing B, close B, reconcile missing paths. State is `{paths,active,modes}`; actions open/add/close/reconcile/reset/mode.
- [x] Run `node --test tests/document-workspace.test.mjs`, record missing exports; implement unique paths and maximum three with flat horizontal layout.
- [x] Test `journalPreferences(null,[])` defaults daily folder to Journal, existing settings including empty folder persist, existing dated root notes retain root convention. Startup last-document restoration uses existing navigation history.
- [x] Add runtime assertions in `scripts/verify-journal-workspace.mjs` before UI: startup feed creates no file; explicit date creation, drag to three panes, focus context, independent edits saved to correct files, close/reopen retains content.
- [x] Run runtime script against old build to observe missing feed failure. Implement hook replacing App setActive/setMode. Use per-pane refs, path-aware link callbacks, internal drag MIME, edge preview and resize separators. Preserve external file import and structured viewers.
- [x] Show today and 14 earlier journal entries with load more; explicit creation uses existing periodic templates. Settings choose journal or recent document. Same-vault refresh reconciles paths without resetting layout; flush before reload.
- [x] Build and run focused tests and isolated runtime assertions.

## 2. Confirmed classification
Files: `core/journal-classification.mjs`, `core/note-composer.mjs`, `tests/journal-classification.test.mjs`, `src/ClassificationReview.jsx`, `electron/main.mjs`, `electron/preload.cjs`, `src/App.jsx`.
- [x] Write real filesystem failing tests: preview writes nothing; source byte equality after apply; repeat has no duplicate; stale source/target rejects; image paths rebased; two sections append to same target; illegal paths and source destination rejected; code-fence headings excluded.
- [x] Run `node --test tests/journal-classification.test.mjs`; implement missing exports after observing failure.
- [x] Parse non-overlapping heading sections excluding YAML. Suggest existing folders by local title/tag/text overlap with explicit reasons; unmatched sections need user destination. Return sourcePath/from/to/title/targetPath/reason. Export existing relocation helper with identity redirect default. Include necessary reference definitions before rebasing excerpts.
- [x] `JournalClassifier.preview(input)` captures disk revision, validates selections and targets, returns input/revision/changes. `apply(input,revision)` recomputes and calls Vault.applyDocumentChanges; never writes source. Source path and excerpt digest markers in destination prevent exact duplicate copies; changed excerpts append explicitly labelled versions only after confirmation, preserving manual edits.
- [x] Add IPC with vault and sender checks, exclusive apply lock and Git backup integration. Review allows editing destinations, excluding items, full excerpts and preview then confirm. Any changed choice invalidates preview; flush and reject unresolved AI drafts before actions.
- [x] Extend runtime test: saved journal offers proposals, preview/exclusion leaves disk unchanged, apply preserves original and copies only selected text. Run focused tests and build/runtime.

## 3. Weekly updates
Files: `core/update-information.mjs`, `core/update-manager.mjs`, `tests/update-manager.test.mjs`, `src/UpdateSettings.jsx`, `src/App.jsx`, `electron/main.mjs`, `electron/preload.cjs`.
- [x] Write failing tests for compatible release selection before highest version, seven-day boundary, manual bypass, failure retry after one hour, disabled auto-check, concurrent single-flight, valid SHA256 download, mismatch/truncation/missing digest refusal.
- [x] Run `node --test tests/update-manager.test.mjs`; extend releaseInformation with optional platform/arch retaining current API tests. Validate repository URLs, archive naming, size and digest.
- [x] Manager persists enabled/download/prerelease and check times atomically, normalizes clock rollback, streams to .part in cache with size limit, verifies SHA256 then renames. Revalidate cached files after restart; never accept renderer-provided URL/path. Failed checks/downloads stay retryable.
- [x] Add get/settings/check/download/show IPC, hourly elapsed-time timer and resume check. Broadcast state to renderer. Settings offer weekly auto check, background download, manual check, prerelease, last check/progress/errors and ignored-version behavior.
- [x] ZIP packages are explicitly manual install: ready notice says download verified and offers containing folder. No silent app replacement, installer publishing or signing credentials. Missing trusted digest offers official release link instead of verified readiness.
- [x] Runtime verify persisted options and controls using isolated profile; no actual user update install.

## Final review
- [x] `npm test`, `npm run build`, `git diff --check`.
- [x] Run isolated journal/workspace/classification/settings runtime, inspect console errors and screenshots.
- [x] Inline review focused editor/AI context, same-vault save state, original journal preservation, stale previews, and download-versus-install wording. Record verified results and platform limitations. Preserve unrelated HANDOFF.md. No publishing or user installation.

검증 근거: `docs/verification/2026-10-30-journal-workspace-review.md`. 드래그 취소, 숨겨진 문서 컨텍스트, 참조 링크 충돌, 업데이트 설정 경합과 기존 옵션 승계도 추가 검증했다.
