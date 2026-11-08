# Planner automatic drafts implementation plan

> **For agentic workers:** Use inline execution with `superpowers:executing-plans`. Do not delegate. Canonical progress is tracked with work_state_write.

**Goal:** A captured schedule saves as AI drafts without requiring dates, detailed fields or per-row confirmations.

**Architecture:** Reuse existing board persistence, source attachments, selection, duplicate detection and undo. Add a draft status for AI results. After a successful independent audit, save the returned items through the latest existing registration callback. Keep the editable review on cancellation, audit failure or storage failure, with an enabled one-click draft-save fallback.

**Tech Stack:** React, Electron, existing Markdown/YAML board and Node tests.

## Design and boundaries

- AI already fills title, target, stage and any readable dates. Unknown dates and optional details stay empty; do not infer dates or invent tasks.
- `draft` distinguishes saved AI output from confirmed schedules. Existing planned/active/blocked/done items retain their status.
- Source-row audits remain automatic. Their warnings are advisory and never require checkboxes to permit saving.
- Manual schedule save requires only its existing title. Existing validation of malformed dates and conflicting files remains.
- Existing 103-item personal review must survive activation. Do not restart or discard it; preserve it before any installed-app replacement.

## Steps and checks

1. Add a unit regression: parse an undated captured row, assert `status === 'draft'`, round-trip via writeBoard/readBoard, and assert dates/tasks remain empty. Run `node --test tests/planner.test.mjs` and observe the missing draft status failure.
2. Add an Electron regression using synthetic IPC: complete capture/audit with undated rows and assert the board file appears without any field input or source-row checks. Verify an audit cancellation leaves a saveable draft and a simulated write failure preserves the result for retry. Run it before the implementation to observe the missing autosave.
3. Extend only the existing status normalization and capture status. In Planner, remove mandatory source confirmation state, register through a latest callback ref after the audit, retain fallback review on write failure, and label optional details clearly. Run the new tests to green.
4. Adapt existing Planner verification scripts to automatic draft persistence. Run the full unit suite, production build, relevant packaged UI checks and diff check. Verify 99 rows, duplicate imports, unknown dates, source retention, cancellation/error fallback and revisions.
5. Package and verify source equality/signature. Preserve the actual pending 103-item review before activation; otherwise keep a ready package without discarding work. Record actual installation state and evidence.
