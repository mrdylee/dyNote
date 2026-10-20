# Graph Controls Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans by default for continuous inline implementation. Use superpowers:subagent-driven-development only when the user explicitly requested subagents or parallel agent work. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the requested graph control panel and functioning filters, groups, display settings and replay.

**Architecture:** Extend core graph selection with typed nodes and a bounded query matcher. Keep Pixi batched rendering and the WASM worker; feed appearance changes independently of topology. Store normalized per-vault options.

**Tech Stack:** React, Pixi 8, Electron, Node test runner, Playwright, existing AssemblyScript worker.

## 1. Model and preferences
Files: core/graph.mjs, core/graph-options.mjs (new), tests/graph.test.mjs, tests/graph-options.test.mjs (new).
- [ ] Add failing assertions for A→B, A→missing, A→image, A→tag and orphan C, with each visibility toggle and filtered orphan removal; test aliases, unsafe URLs and ambiguous paths.
- [ ] Run `node --test tests/graph*.test.mjs`; confirm failures identify missing behavior.
- [ ] Build graph using existing note.links and createLinkIndex/resolvePath, namespace synthetic nodes, preserve direct graph API for existing tests. Select types before local traversal, then query and orphan filtering.
- [ ] Add query matcher (AND, quoted strings, file/path/tag and negation), ordered group color selection, timestamp replay order, and saved option normalization. Test malformed saved values and Unicode.
- [ ] Rerun graph unit tests to passing.

## 2. Panel and renderer
Files: src/Graph.jsx, src/graph-renderer.mjs, src/styles.css, src/App.jsx, scripts/verify-graph-controls.mjs (new).
- [ ] Add real Electron fixture containing linked notes, an orphan, tag, missing target, PNG and PDF. Assert right settings panel exists (fails before implementation).
- [ ] Pass documents/attachments and openFile into Graph; synthetic tag click filters and missing target click reports without filesystem writes.
- [ ] Replace top controls with scrollable right panel: Filter/Groups/Display/Forces, typed checkboxes, range inputs with outputs, reset/close/reopen and reorderable group rows. Keep local graph direction and picker.
- [ ] Renderer receives colors/arrow flag/text threshold separately, uses batched edge triangles including arrowheads, updates hit testing to respect replay visibility, and shows chronological node/edge reveal with finite RAF lifetime.
- [ ] Run fixture through real notes://app; assert controls change model/worker/render output, settings survive graph reopen and vault scope, replay completes, zero console errors.
- [ ] Run existing graph runtime test and all unit tests plus production build.

## 3. Review and publish
Files: docs/research/obsidian-graph-controls-2026-10-20.md, docs/verification/graph-controls-review.md, README.md, package.json/package-lock.json.
- [ ] Review full diff against spec, inspect paths and lifecycle, correct defects and repeat affected checks only.
- [ ] Record observed Obsidian GUI and retained REA evidence without private vault details. Document supported search subset and remaining compatibility limits.
- [ ] Bump minor version to 0.6.0, build Mac and Windows, verify package content, run packaged graph fixture.
- [ ] Zip packages, SHA256SUMS, commit reviewed source, tag v0.6.0 and atomically push source/tag.
- [ ] Publish prerelease to mrdylee/dyNote, verify uploaded assets and hashes through public API. Record screenshot for user.
