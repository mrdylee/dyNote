# Development Planner Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for continuous inline implementation.

**Goal:** Ship the approved capture-to-plan and developer evidence workflow with reviewed UI and verified release artifacts.

**Architecture:** A separate Planner React workspace uses pure board functions and existing vault save/recovery APIs. The existing Copilot controller gains bounded image blob support. The board is Markdown/frontmatter, with image attachments and explicit note evidence links.

**Tech Stack:** React, Lucide, YAML, Electron, GitHub Copilot SDK, node:test, Playwright.

## Tasks

1. `core/planner.mjs`, `tests/planner.test.mjs`: test then implement calendar validation, model JSON parsing, item validation, duplicate registration, YAML board roundtrip, evidence review and duration-preserving reschedule. Test leap-day validity, missing year preservation, invalid end-before-start, duplicates from the same source and changed evidence revisions. Run `node --test tests/planner.test.mjs` (red then green).
2. `core/copilot.mjs`, `electron/copilot-controller.mjs`, `tests/copilot.test.mjs`: test then add optional image payload `{mimeType,data}` with one image maximum, strict base64/media/size validation, model vision metadata and capability rejection. Forward as SDK `{type:'blob',data,mimeType,displayName}`; text requests stay unchanged. Run `node --test tests/copilot.test.mjs`.
3. `src/Planner.jsx`, `src/planner.css`, `src/App.jsx`: implement the workspace and narrow navigation integration. Use `api.importAttachment`, existing AI events/cancel, and onSave backed by revision-checked create/save APIs. Controlled review fields retain edits on failure. Grouped timeline and Today are projections of the same board. Inspector edits tasks, decisions and evidence. All writes go through an explicit save/registration action with undo.
4. `scripts/verify-planner.mjs`: launch a synthetic owned Electron profile. Use deterministic mocked inference only at the controller boundary; test real UI and vault writes. Exercise import/review/selection/duplicate, manual entry, decision adoption, dates, evidence, undo, restart and isolation. Save screenshots and JSON evidence under `output/playwright/planner/`. Separate live vision probe uses only generated synthetic imagery.
5. `docs/verification/ubcode-planner.md` and isolated example under `examples/ubcode-planner/`: inspect installation and license route, run actual CLI check/impact on a synthetic example; record findings without claiming an unimplemented bridge.
6. Review diff against spec; fix discovered issues with focused tests. Run `npm test`, `npm run build`, actual UI checks and visual inspection. Record concrete evidence in `docs/verification/development-planner.md`.
7. Prepare next available prerelease version and release notes, package both platforms, verify package source match and Mac runtime, archive/checksum; commit/tag/push and publish GitHub prerelease, then download/verify public assets. No unrelated changes or HANDOFF.md inclusion.

Canonical changing task state lives in claude-mem work_state, not this plan.
