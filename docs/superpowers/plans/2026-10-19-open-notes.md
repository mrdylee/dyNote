# Open Notes Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for continuous inline implementation. No subagents were requested. Steps use checkbox syntax for tracking.

**Goal:** Deliver a runnable independent desktop Markdown notebook with safe local saves and connected-note navigation.

**Architecture:** Electron main owns the selected directory and exposes narrow operations through a sandboxed preload. React/CodeMirror renders independent UI. Pure knowledge and filesystem modules carry regression tests.

**Tech Stack:** Electron, React, Vite, CodeMirror 6, markdown-it, DOMPurify; Node's built-in test runner and temporary filesystem fixtures.

---

### Task 1: Establish project and red filesystem/knowledge tests

**Files:** `package.json`, `tests/vault.test.mjs`, `tests/knowledge.test.mjs`.

- [x] Install exact current package releases; use the lockfile for repeatability.
- [x] Write filesystem tests before implementation. Required contract:
  ```js
  const store = await Vault.open(root, recoveryRoot);
  const snapshot = await store.snapshot();
  const saved = await store.save('한글.md', '새 내용', snapshot.notes[0].revision);
  assert.equal(saved.content, '새 내용');
  await assert.rejects(store.save('../outside.md', 'x', saved.revision));
  ```
  Use a temporary real folder for each test. Verify backups by reading their bytes, simulate another editor with `writeFile`, and simulate symlinks with `symlink`.
- [x] Write knowledge tests: resolve `[[../Guide|별칭]]` from `area/Note.md`, ignore fenced code and inline code, flag duplicate basenames, compute incoming edges, and block remote image tokens.
- [x] Run `npm test`; record failure caused by absent feature modules.

### Task 2: Implement filesystem boundary

**Files:** `core/vault.mjs`, `tests/vault.test.mjs`.

- [x] `Vault.open(root, recoveryRoot)` canonicalizes both paths. Snapshot recursively reads regular non-hidden `.md` files, refuses symlinks, and returns `{ name, notes, warnings }`; each note has `{ path, content, revision }`.
- [x] `save(path, content, expectedRevision)` enforces a selected-root relative `.md` path, reads with no-follow, checks SHA-256, writes a private backup, writes a unique temporary sibling, then renames. Return the saved note. A promise queue serializes creates/saves without poisoning subsequent operations after a failure.
- [x] `create(path)` uses exclusive creation; does not replace an existing note. `recoveryRoot` is never interpreted from renderer input.
- [x] Run `node --test tests/vault.test.mjs`. Require all cases to pass before proceeding.

### Task 3: Implement knowledge behavior

**Files:** `core/knowledge.mjs`, `tests/knowledge.test.mjs`.

- [x] Add a markdown-it wikilink rule returning escaped token attributes. Resolution order: path relative to source, root path, unique basename; ambiguous names remain unresolved. Strip only heading/block fragments from resolution targets.
- [x] Use parser tokens to extract links/tags/headings without treating fenced code as relationships. Build incoming/outgoing arrays and graph edges from the same resolved links.
- [x] Search all query terms, rank title hits first, and return a bounded highlighted-text snippet as data rather than HTML.
- [x] Markdown rendering disables raw HTML, emits image placeholders, and marks internal links using data attributes. DOMPurify provides a second renderer-side layer.
- [x] Run `node --test tests/knowledge.test.mjs` and the full suite.

### Task 4: Connect the desktop shell

**Files:** `electron/main.mjs`, `electron/preload.cjs`, `core/demo.mjs`, `index.html`, `vite.config.mjs`, `tests/security.test.mjs`.

- [x] Create a synthetic eight-note example vault in app data and load it on first launch. Do not use any existing personal vault.
- [x] Add bridge functions `snapshot`, `pickVault`, `createNote`, `saveNote`, `showRecovery`, and `openExternal`. Return `{ ok: true, value }` or `{ ok: false, error }` rather than leaking platform stack traces.
- [x] Validate each sender is the main frame at `notes://app/index.html`; check all arguments again in main. Only a native picker may change the selected root.
- [x] Serve bundled UI through a path-checked custom protocol. Deny network, new windows, navigation, permissions and arbitrary files. External URLs require an explicit bridge call and http/https/mailto validation.
- [x] Configure sandbox, context isolation, no Node integration and CSP. Test path/URL predicates independently.

### Task 5: Build the UI and saving lifecycle

**Files:** `src/App.jsx`, `src/Editor.jsx`, `src/Graph.jsx`, `src/styles.css`, `src/main.jsx`, `src/saveQueue.mjs`, `tests/saveQueue.test.mjs`.

- [x] Test queue behavior first: edits arriving during a save are retained and saved against the returned revision; failed saves keep drafts and reject flushing.
- [x] Implement a per-path draft queue, debounced persistence, close-time flushing, and dirty/conflict status. Folder changes require a successful flush. A failed flush must leave the selected root unchanged.
- [x] Build a light three-pane layout: folder tree/search left; tabs/editor/preview middle; outline/backlinks right. Include keyboard note switcher and visible save status.
- [x] CodeMirror supports Markdown, history, search, line numbers, wrapping and Korean composition. Never recreate the editor on every keystroke.
- [x] Render previews through DOMPurify. Internal links open notes; unknown links offer safe creation; ambiguous links stay unresolved. Preview does not execute plugins or load images.
- [x] Basic SVG graph shows computed edges, selected note, clickable labels, pan and zoom. Backlinks use the same relationship model.
- [x] `npm test && npm run build` must succeed.

### Task 6: Verify the deliverable and document limits

**Files:** `README.md`, `docs/REA-EVIDENCE.md`, `LICENSE`, `release/` (ignored).

- [x] Launch the built Electron app and use native UI automation to edit/save/reopen a synthetic note, find it through search, follow a wikilink and inspect graph mode. Verify disk content after UI saves. Native picker interaction was also verified against a dedicated temporary folder.
- [x] Run `npm audit --json`; resolve actionable direct dependencies, report any remaining build-only findings with conditions.
- [x] Run `npm run package:mac`, open the packaged app and verify its window. Leave Windows/Linux unverified until built on those systems.
- [x] Document start/package commands, recovery location, image/plugin/ZIP limits, unsigned app status, and partial REA coverage. Link the existing evidence receipts; do not copy the proprietary reference artifact into the project.
- [x] Review changes against every spec criterion; rerun only checks affected by subsequent fixes. Commit local verified work on a feature branch. Do not publish, push or create a release.
