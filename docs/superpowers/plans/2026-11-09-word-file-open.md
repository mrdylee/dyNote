# External Word File Open Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for continuous inline implementation. Steps use checkbox tracking. No subagents are requested.

**Goal:** Open a DOCX from the File menu/button or an Explorer drop in a temporary read-only preview without changing a vault or the original.

**Architecture:** Add a main-process temporary-document service that calls the existing Word converter. Expose narrowly scoped picker/drop/read/default-app IPC operations. Render a separate dialog with the existing sanitized WordPreview component.

**Tech Stack:** Electron, React, Node file-system APIs, existing Mammoth/JSZip/Yauzl conversion, Node tests and native Playwright verification.

## Task 1: Temporary Word service

Files: `core/external-word-documents.mjs`, `tests/external-word-documents.test.mjs`.

- [x] Write tests against `new ExternalWordDocuments(directory)`, `open(source)`, `read(id, revision)`, `sourcePath(id)` and `dispose()`.
- [x] Assert `Buffer.equals(original)` for source and temporary copy, `read(id, first.revision) === null`, updated text after atomic source replacement, and an empty cache directory after `dispose()`.
- [x] Verify `.md`, `~$*.docx`, relative paths, symlinks, missing files, malformed DOCX, unknown IDs and files over 25 MiB fail without changing the source.
- [x] Run `node --test tests/external-word-documents.test.mjs`; confirm the missing implementation fails.
- [x] Implement regular-file validation, bounded reads, stable source revisions, private ID-to-source mapping, temporary copies, conversion and cleanup using existing `readWordContent(bytes, true)`.
- [x] Re-run the test file and existing `tests/word-documents.test.mjs`; commit the service and tests.

## Task 2: Native picker, menu and drop entry points

Files: `electron/main.mjs`, `electron/preload.cjs`, `src/useExternalWordDocuments.jsx`, `src/App.jsx`, `src/styles.css`.

- [x] Add native menu item `dynote-open-file`, label `파일 열기…`, accelerator `CmdOrCtrl+O`; send `notes:open-file` to the renderer.
- [x] Add `choose-external-word`, `open-external-word`, `read-external-word` and `open-external-word-source` IPC handlers. They validate the sender, use the temporary service and never mark a vault dirty.
- [x] Expose picker/read/default-app methods and `openDroppedWord(file)`; resolve `webUtils.getPathForFile(file)` in preload and reject an empty path.
- [x] Add an independent dialog whose title is the filename, with temporary-copy status, existing WordPreview, refresh, original default-app open and close controls.
- [x] Register a window-level capture handler that consumes a single native DOCX drop before editor handlers. Non-Word drops/internal tree drags continue unchanged. Reject mixed/multiple Word drops explicitly.
- [x] Wire the visible `파일 열기` button and menu listener to the same picker handler. Permit the dialog on the no-vault screen. Ignore stale async preview results and refresh the visible external document on main-window focus.
- [x] Dispose app-owned temporary copies before normal quit; retain source paths only for opaque IDs selected through the picker/drop.

## Task 3: Native regression and documentation

Files: `scripts/verify-external-word-open.mjs`, `scripts/verify-journal-release.mjs`, `README.md`.

- [x] Add a native test that stubs the picker result, clicks both menu and visible button, and checks cancellation preserves the current view.
- [x] Use `setInputFiles` on a test-only DOM input to obtain a disk-backed File; dispatch its drop and verify the preview through the real preload path resolver. A JS-created File must be rejected.
- [x] Replace the source externally, emit window focus and assert updated preview text. Stub only `shell.openPath` and assert the original absolute path is handed off.
- [x] Assert source bytes and the selected vault stay unchanged by opening/preview. Add the scenario to the native release runner.
- [x] Run the full unit suite, build, package verification, existing Word runtime test and new external-file runtime test. Review the final diff and record actual results.
- [x] Document menu/button/drop usage, the 25 MiB/single-DOCX scope, temporary lifetime and original default-app behavior.

## Verified locally

- Full unit suite: 460 passed, no failures or skips.
- Production build and Apple Silicon package completed. Packaged source verification matched 291 source/bundle files. Dependency audit reported zero vulnerabilities.
- Both source and packaged native tests passed menu/button opening, cancellation, editor drop, mixed-file rejection, non-Word event pass-through, original-path handoff, refresh and normal-exit cleanup.
- Existing packaged Word list/body search and saved-color regression tests passed.
- Actual Word editing and Polarion re-upload remain outside the completed tests. Cross-platform release CI runs the full native suite before publishing.
