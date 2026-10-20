# Copilot live edits implementation plan

> Execute inline with superpowers:executing-plans. No delegated implementation.

**Goal:** Show each completed Agent edit in the center document with Keep/Undo and durable pending drafts.
**Architecture:** Cumulative backend proposals; a small renderer edit-session hook owns a vault-keyed journal and serialized batch application; App renders overlay notes, Editor decorates pending ranges, Panel starts/ends sessions and keeps its existing Ask/Edit paths.
**Stack:** React, CodeMirror, Electron, existing vault revision API, localStorage journal, node:test and deterministic Electron tests.

- [ ] Extend `tests/copilot-agent.test.mjs` for sequential append/read/replace on the same path and immutable baseline. Fail first, then modify `core/copilot-agent.mjs` to retain cumulative drafts, stable proposal IDs and original targets; update tool/system descriptions.
- [ ] Add `src/copilotEdits.mjs` with pure cumulative draft validation/change-range helpers and tests. Add `src/useCopilotEdits.jsx` for journal, ordered staging, current-state/revision checks, keep/discard/recovery and interruption. Preserve draft state on failures.
- [ ] Integrate into `src/App.jsx`: effective overlay model; normal raw file save stays separate; lifecycle guards; center pending banner/compare; keep through revision checked APIs. Update `src/Editor.jsx` for changed-line decoration without stealing chat focus.
- [ ] Update `src/CopilotPanel.jsx` to begin a session after flushing, route Agent proposals immediately and finish after queued batches. Cancel/error retain drafts. Disable new send while unresolved drafts exist. Retain reviewed Edit mode.
- [ ] Add `scripts/verify-copilot-live-edits.mjs` with controlled event batches in a disposable vault. Assert visible edits before done, disk unchanged, Keep/Undo/stop, selection, conflicts, restart and panel close.
- [ ] Run unit/build/runtime checks, local code review, Mac package/runtime/install checks, update user docs and evidence, local commit. No push/publication.
