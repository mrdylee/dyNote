# Development planner review — 2026-10-28

Reviewed extraction/SDK boundaries, persistence, stale responses, source retention, duplicate handling, evidence semantics and the actual desktop flows. Review was local; no independent reviewer is claimed.

## Findings resolved before release

- Persisted boards lacking items or IDs could normalize to empty or unstable data: reject them with a visible error.
- Re-importing a capture after correcting its date could create a duplicate: use source hash/text and target/stage identity before fallback manual identity.
- Switching from a modified inspector could discard edits: require save or explicit close first; block switching during save/inference.
- Generated-summary cleanup could swallow whitespace outside its boundary: remove only its own separator newlines.
- Full editor chrome reduced the capture workspace: hide surrounding note panels/tabs while the planner is active, compact the capture header, keep the registration control reachable.
- Research examples could be bundled by the packager: exclude examples and assert exclusion during package verification.

## Evidence

- `npm test`: 228 passed, no failures/skips. New tests cover dates, missing years, model validation, board corruption/roundtrip, duplicate handling, evidence changes, duration-preserving rescheduling and actual SDK image attachment/capability checks.
- `npm run build`: passed; existing large-chunk warnings remain.
- `scripts/verify-planner.mjs`: 10 grouped checks passed in real macOS Electron with a synthetic vault and deterministic inference transport. Actual clipboard paste and file import, editable/selective recognition review, duplicate preservation, adopt/defer, manual add, drag+undo, restart, checkbox completion, dirty-inspector protection, external-write conflict retention, evidence change/navigation, real vault switch and 1050px overflow checks. No renderer errors.
- `scripts/verify-planner-vision.mjs`: existing authenticated Copilot, actual `gpt-6.1-sol` vision request on a synthetic image. Known dates were correct, missing year remained undated, and a real brainstorming request returned distinct candidate alternatives. This is a narrow fixture, not a broad OCR accuracy claim.
- Desktop screenshots inspected at 1440×960 and compact 1050×760. Local evidence: `output/playwright/planner/` (ignored).
- Actual ubCode results are recorded separately in [ubcode-planner.md](ubcode-planner.md).

## Remaining product limits

One screenshot per request; no PPTX parser, bulk import, automatic dependency scheduling or formal process enforcement. Current evidence links refer to whole notes, not a requirement-ID traceability graph. Result status is user-recorded, not automatic test execution. The inspector uses explicit Save and does not persist unsaved drafts across navigation/forced termination. Source attachments remain after discarded recognition. Recognition quality depends on the selected model and source legibility.

Package/runtime/publication verification belongs in [release-0.9.0.md](release-0.9.0.md).
