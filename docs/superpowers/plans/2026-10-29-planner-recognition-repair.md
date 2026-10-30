# Planner Recognition Repair Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for continuous inline implementation. No subagents are requested. Canonical task status lives in claude-mem work_state_write.

**Goal:** Preserve large recognition responses, expose incomplete/merged source rows, and show real progress until editable review and save succeed.

**Architecture:** Retain existing bounds and legacy single-batch parser. Add bounded multi-batch parsing plus an independent row audit and local coverage reconciliation. Extend only the Planner request/review UI and its targeted verification scripts.

**Tech Stack:** React, Electron IPC, existing Copilot SDK, Node tests and Playwright Electron.

### 1. Parsing and coverage RED/GREEN
Files: core/planner.mjs; tests/planner-capture-review.test.mjs.
- Write assertions that 99 generated valid rows survive as two review pages of 60/39, while the single-batch parser still rejects 61.
- Assert 501, >128KiB input and an invalid final row fail visibly.
- Assert audit labels CV/DV/PD/PV detect a missing CV and merged PD/PV, retain an unmatched initial CV, and replace a previously merged candidate with separate audited PD/PV rows.
- Assert missing audit groups/labels fail, and audit context over 64KiB is rejected rather than truncated.
- Run node --test tests/planner-capture-review.test.mjs and observe expected failures before implementation.
- Implement parseCaptureBatches, captureReviewPage, parseCaptureAudit and captureAuditContext; rerun targeted tests.

### 2. Desktop request/review RED/GREEN
Files: src/Planner.jsx; src/planner.css; scripts/verify-planner-review.mjs.
- Extend real Electron fixtures to return the existing 99-row shape, then an audit grouped by target with source labels. Assert no more than 60 review controls at once, page 2 contains the final row, and all 99 persist after explicit source confirmations.
- Emit a delta before each done; assert phase/elapsed/activity text updates.
- Supply missing and merged labels; assert visible warnings and disabled registration until acknowledgement. Assert audit error/cancel retains initial candidates and does not schedule another pass.
- Implement the two-pass request lifecycle, progress and acknowledgements. Keep old request ID and unmount guards.
- Run the regression on a development build, then the installed-format package.

### 3. Integration and review
Files: existing scripts/verify-planner.mjs and verify-planner-capture.mjs; docs/verification/planner-capture-size.md.
- Update deterministic transports to model both extraction and audit, and acknowledge tested source rows explicitly before saving.
- Run npm test, npm run build, targeted desktop scripts and git diff --check. Review only task changes; preserve all concurrent editor work and HANDOFF.md.

### 4. Supplied image and local delivery
- Run the user's JPEG in an isolated vault through two actual Copilot requests; check atomic LCS CV/DV/PD/PV, explicit Pack dates, unresolved warnings, review pages and Markdown save.
- If the independent full-image audit still omits those visible anchors, revise the audit to row-scoped extraction before claiming completion; report AI uncertainty honestly.
- Package into a separate temporary output, verify strict macOS signature, source/bundle bytes and packaged regressions.
- Quit saved old user app, back it up, install and launch the tested local app. Preserve settings, real notes and OS security settings. Do not push, publish, merge or include supplied private image/results in git.
