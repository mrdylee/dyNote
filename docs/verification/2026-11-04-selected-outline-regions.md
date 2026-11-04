# Drag-selected normal and journal editing

The requested UI offers two modes per dragged region: normal editing and journal editing with Bullet Threading included. Journal mode converts selected prose paragraphs into Markdown bullet blocks; soft lines remain continuations. Existing lists, headings and literal code keep their content. Normal mode removes the region behavior while retaining the resulting Markdown and list structure.

Use a regular document's editor: drag text, choose the mode in **구간 편집**, then click **선택 구간에 적용**. Each region persists in paired Markdown comments that are hidden in Live Preview/read views and visible in source mode. Selected list parents include their descendants; a region's logical root cannot outdent into an unselected parent. Selections crossing existing region boundaries are refused. Source edits, conversion and mode removal use the existing undo/save pipeline.

## REA reference

REA controlled browser evidence `ev_cfa5df3a0abb69e530499576cece65a462427dc95d7259cc4ca9731d592bbd4e` executed the declared three-level Tab scenario on https://app.logseq.com/ using synthetic text and a fresh temporary browser profile. The result reports complete requested actions/captures, zero page errors and owned-browser cleanup. The screenshot at scale 1 shows a 30px step between the three bullet centers. The local native fixture independently measures centers at x=359,389,419 CSS px: exactly 30px per level.

Portable evidence is retained in ignored `output/verification/rea-logseq-selected-regions.json`; the exported reference screenshot is `output/playwright/outline-regions/logseq-rea-reference.png`, with SHA-256 verified against its REA artifact receipt. This is a tested web reference, not a claim of complete desktop Logseq equivalence. Selection-scoped mode controls and persistence are independently implemented in Dynote.

## Fresh verification

- Focused region/journal/live-preview tests: 40 passed.
- Full `npm test`: 389 passed, zero failures/skips.
- `npm run build`: passed; existing large-bundle advisory remains.
- `scripts/verify-outline-regions.mjs`: 9 grouped native checks passed. Real mouse drags cover the whole requested span; both mode choices are present; selected/outside blocks stay independent; 30px prefixes, Tab/undo, per-region removal, paragraph conversion, read/source/live mode changes, exact save/restart and zero renderer errors are verified.
- Existing `scripts/verify-journal-threading.mjs`: 14 grouped checks passed, zero renderer errors. Includes H1/H2 circles, active ancestry, checkboxes, continuation, indentation, folding, wrapping/scrolling and byte-exact restart.
- Existing `scripts/verify-journal-outline.mjs`: 9 grouped checks passed, zero renderer errors. Includes existing keyboard, completion, legacy prose, templates and deterministic AI edit-context behavior. No account/model request was made.
- Native screenshots/receipts: ignored `output/playwright/outline-regions/` and `output/playwright/journal-threading/`.
- Local source review, Node syntax checks and `git diff --check` passed. Existing unrelated working-tree changes were preserved.

The tests first exposed absent region behavior, then detected a block-decoration boundary swallowing the first line's style, a logical-root outdent escape and an incorrectly grouped crossing selection. The native drag test also detected toolbar height changing from 43px to 66px on a mode transition during dragging, moving the text under the pointer. Boundary inclusivity, scoped outdent, full-selection containment and fixed toolbar guidance correct these cases; the final native scenario asserts the toolbar height stays constant throughout each drag.

All native runs used synthetic temporary vaults and profiles. This validates the local macOS source build; no public release or replacement of `/Applications/Dynote.app` is included.
