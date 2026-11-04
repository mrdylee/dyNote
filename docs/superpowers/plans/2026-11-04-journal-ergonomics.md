# Journal editing ergonomics implementation plan

> **For agentic workers:** Use superpowers:executing-plans for continuous inline implementation. Steps use checkbox syntax.

**Goal:** Fix journal layout movement, add tree trash menus, default Markdown to Live Preview, and explain classification; publish v0.15.1 after review and verification.

**Architecture:** Keep the existing App/FileTree/workspace and file recovery flow. Add one small pure tree-folder policy shared by renderer and main; validate physical folder paths before calling Electron system trash. Render a bounded tooltip overlay in the stable classification row.

**Tech Stack:** React, CodeMirror, Electron, Node tests and native Playwright scenarios.

- [x] Add `scripts/verify-journal-ergonomics.mjs` using isolated synthetic vaults. Reproduce current read/source defaults, banner geometry changes through three autosaves, missing hover/focus help, and missing tree menus. Run against the public v0.15.0 app and retain failing evidence before implementation.
- [x] Add meaningful unit regressions in `tests/document-workspace.test.mjs` and `tests/file-tree.test.mjs`: first open/add/reset defaults live; explicit modes persist; default/custom folder protection includes ancestors without blocking siblings/documents. Run with `node --test tests/document-workspace.test.mjs tests/file-tree.test.mjs` and observe failures.
- [x] Update `core/document-workspace.mjs`, `src/useDocumentWorkspace.jsx`, `src/DocumentWorkspace.jsx` and Markdown creation/feed overrides in `src/App.jsx` to apply live defaults without overriding explicit modes. Verify focused tests plus native creation/focus/save behavior.
- [x] Update `src/App.jsx` and `src/styles.css` for the stable journal classification row and accessible hover/focus help. Keep classification preview/apply semantics intact. Verify editor geometry before/after typing/save and popup visibility/geometry at wide and narrow widths.
- [x] Add `core/file-tree.mjs` protection predicates; update tree rows and a dismissible keyboard-accessible DOM context menu in `src/App.jsx`. Route files through existing `prepareFile`. Add a guarded `trash-folder` main/preload operation, explicit folder confirmation and system-trash feedback; check vault identity, path validity, every directory component, configured/default protection and mutation serialization. Verify cancel/file undo/folder deletion/nested contents/unrelated files and direct IPC rejection of protected/outside/symlink paths.
- [x] Review the diff for stale state, deletion boundaries, multiple panes, keyboard dismissal and mode retention. Run focused tests, `npm test`, `npm audit --audit-level=moderate`, `npm run build`, new native scenario and existing region/thread/journal suites. Fix reproduced issues and document boundaries.
- [ ] Bump package manifests/README to 0.15.1, add release notes, and adapt the reviewed two-platform workflow to `release/journal-ergonomics-v0.15.1`. Include the new scenario on both OSes. Package and verify local Mac source/signature, commit only this task's paths, push the authorized release branch, and require both native CI jobs before public publication.
- [ ] Re-download all seven public assets; validate tag/commit, GitHub digests/SHA files, ZIP CRC/paths, Mac DMG/signatures and ASAR identities against CI. Run the new scenario against the public Mac app and retain a final receipt under ignored output/verification. Preserve all pre-existing dirty files.
