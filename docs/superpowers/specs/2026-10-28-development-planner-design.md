# Development planner

User approved implementation, review, fixes and deployment on 2026-10-28.

## Outcome

A polished native workspace lets the user paste/drop/select a PPT screenshot, extract milestones with a vision-capable Copilot model, review the image beside editable cards, and register selected items. Manual entry remains available. Registered items persist in ordinary Markdown in the selected vault. Link/BMS/PACK and CV/DV/PD/PV are suggestions, never hard-coded process semantics.

## Interaction and data

- A calm warm-white workspace, ink headings, restrained teal/lavender accents, generous spacing, keyboard accessible controls and a responsive side inspector. Main views: Today, Timeline and Evidence. Empty states are real, never fictional project data.
- Paste/drop/file selection accepts PNG/JPEG/WebP. When already connected, paste automatically sends that image to a vision-capable Copilot model, as disclosed on the drop zone. If disconnected, keep the image for sign-in and explicit Analyze. Extraction returns items with title, target, stage, start/end ISO dates or empty strings, literal source text, optional normalized bounding box, explicit tasks and uncertainty. Missing years are never invented. Review can resolve dates or deliberately keep an undated item.
- The source image is stored using the existing attachment importer. Cards retain its path/hash and evidence text. Review and saved detail display the source; boxes are approximate AI locations. Duplicate source items are skipped, never silently overwritten.
- One ordinary planner Markdown note stores validated structured frontmatter and readable Markdown summaries/links. Revision checks and existing recovery apply. Invalid board metadata is shown as an error, never replaced with an empty board. Existing notes/editor drafts are flushed before writes. Only the current board's content is changed. Save failure retains the local draft.
- Tasks explicitly present in the capture and AI recommendations are distinct. Brainstorming takes an explicit question plus the selected milestone, returns alternatives with rationale/tradeoffs/tasks, and allows adopt/defer. Only adoption adds recommended tasks. Persist decisions and tasks; support toggling readiness, editing dates, and undoing a saved change.
- Evidence consists of requirement/design/implementation/test/result note links with the note revision observed at linking, and explicit result status unknown/pass/fail. Missing links and changed linked notes are visible, but linked documents do not imply passed tests. Users may return to earlier work; no forced linear V-model stage lock.
- Near-term, overdue, blocked and undated work surfaces in Today; timeline aligns targets on a common date scale. Date edits are available in the inspector; drag rescheduling must have undo and preserve duration.

## ubCode evaluation

Evaluate an isolated public/synthetic example (3 requirements, 2 designs, 3 tests) using real ubCode where installation/licensing permits. Check a missing connection and a changed requirement. Document actual commands, results and limits. This release does not imply embedded ubCode execution: native evidence links work without it. Integration remains an explicitly documented evaluated route unless a working bridge is verified.

## Acceptance

1. Unit tests cover strict dates, missing years, malformed model responses, bounded inputs, duplicate handling, board roundtrip, evidence changes and undo persistence.
2. Copilot image requests are actual SDK blob attachments, capability checked and bounded; no local paths or unrelated vault contents are sent.
3. Real desktop tests use an owned synthetic vault to exercise paste, review/edit/select, register, reload, duplicate, manual add, task/decision edits, evidence navigation, timeline and restart. Mock inference establishes deterministic UI behavior; a separate synthetic account-backed vision probe establishes image recognition if connected.
4. Visually inspect screenshots at desktop sizes; fix overflow, small targets, contrast, errors and missing feedback. Keyboard paths and reduced motion remain usable.
5. Full tests/build, review/fix, Mac/Windows packaging, packaged Mac runtime and source byte checks, archive checksums, published release asset verification. Preserve intentional local HANDOFF.md. Report Windows runtime limitations honestly.
