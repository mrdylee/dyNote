# Original Obsidian Plugin Runtime Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans by default for continuous inline implementation. Use superpowers:subagent-driven-development only when the user explicitly requested subagents or parallel agent work. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Import and run original Recent Files and Calendar downloads inside Dynote with actual commands, views, persistence and lifecycle verification.

**Architecture:** Local program storage plus a per-vault controller owns isolated plugin windows. A dedicated preload connects a separately bundled DOM compatibility runtime to narrowly scoped host actions. Main renderer lists status and commands without evaluating plugin code.

**Tech Stack:** Electron, existing Vault, React, Vite multi-page build, moment, Node test runner, existing Playwright Electron verifier.

### Task 1: Program storage and evidence

Files: core/plugin-store.mjs, tests/plugin-store.test.mjs; ignored output/research/rea-plugin-import.

- [x] Write tests for byte-identical import of manifest/main/CSS, invalid IDs, symlink inputs, absent optional CSS, same-vault persistence and second-vault isolation. Use mkdtemp, real files and SHA256. `new PluginStore(directory).import(folder)` returns manifest; `.list(vaultId)`, `.setEnabled(vaultId,id,enabled)`, `.program(id)`, `.loadData(vaultId,id)` and `.saveData(vaultId,id,data)` define the storage interface.
- [x] Run `node --test tests/plugin-store.test.mjs` and confirm missing implementation failure.
- [x] Implement strict ID validation, regular-file acquisition, atomic program-directory publication and JSON writes. Import only program files, never data.json. Reject invalid JSON and missing main.js.
- [x] Run the focused tests until all pass. Export complete retained REA evidence and source facts.

### Task 2: Compatibility runtime and owned Electron windows

Files: electron/plugin-controller.mjs, electron/plugin-preload.cjs, src/plugin-runtime.mjs, src/plugin-dom.mjs, src/plugin-main.mjs, plugin.html, vite.config.mjs; tests/plugin-runtime.test.mjs.

- [x] Add tests for original CommonJS Plugin loading, unsupported module failure, commands removed on unload, view creation, event cleanup and data roundtrip. Use real JSDOM and synthetic source snippets; use exact downloaded sources in actual runtime verification rather than committing them.
- [x] Observe the focused runtime failures. Implement only observed APIs, with separate DOM helpers and original module loader. Original sources stay unchanged.
- [x] Controller authenticates each IPC sender to its owned window and captured vault; reads/creates notes through Vault, persists state/data through PluginStore, and publishes command/status events to main. Plugin window retains sandbox/context isolation/no Node and denies navigation/popups. Lifecycle closes on vault change/quit; UI close hides the runtime.
- [x] Build separate plugin.html entry whose CSP permits eval only in this isolated runtime. Keep index.html CSP unchanged.
- [x] Run storage/runtime tests and production build.

### Task 3: Product integration

Files: electron/main.mjs, electron/preload.cjs, src/PluginSettings.jsx, src/App.jsx, src/styles.css.

- [x] Add plugin-list/import/enable/show/command endpoints to existing authenticated main IPC. Import dialog selects a folder, checks the vault again after the dialog, and imports only program files.
- [x] Add a Plugins settings tab with exact installed names/versions, limited compatibility notice, enable/disable, open original view/settings and visible errors.
- [x] Subscribe to original commands and merge them into the existing command palette. Pass the current note state to enabled plugins and route plugin open requests through existing openNote/flush handling.
- [x] Validate enabled persistence and isolation without changing existing native recent/calendar commands.

### Task 4: Actual downloads and regression

Files: scripts/verify-original-plugins.mjs, docs/verification/native-plugin-support.md, docs/verification/original-plugin-runtime.md, README.md.

- [x] Verifier accepts downloaded fixture directories via environment/path; uses a fresh profile/vault and mocks only native folder selection. Test original recent/settings/exclusion/restart, actual Calendar rendering/date navigation/create confirmation, commands, unload/reload, unsupported module, data/vault isolation and renderer security.
- [x] Run actual Electron verifier and inspect screenshots. Compare imported source SHA256 to download receipts.
- [x] Run `npm test`, `npm run build` and `git diff --check`. Document exact verified versions and platform limits. Leave changes locally reviewable; publishing is outside this request.
