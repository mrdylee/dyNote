# Native workflow verification

2026-10-27. Branch: `feat/native-plugin-features`. This is the navigation/journal slice of the approved eleven-plugin/core portfolio; it is not complete Obsidian plugin feature parity.

## Implemented and checked

- NAV-01: persistent per-vault recent files (50, ordered unique paths) and document bookmarks; successful rename/delete reconciliation. Recent Files exclusion rules and bookmark groups are not included yet.
- CMD-01: native command palette on Cmd/Ctrl+P, query/keyboard execution, separate document switcher on Cmd/Ctrl+K. Other portfolio commands will join as implemented.
- JOURNAL-01: calendar with explicit creation action, five period families, configurable folder/file format/template and locale week semantics, chronological existing-note navigation. It covers core Calendar/Periodic Notes workflows; Diarian ratings/timestamps/on-this-day/import/conversion remain open.
- TEMPLATE-01: date/time/title and relative date replacements, selection insertion as one editor undo transaction, original CRLF preservation. Full original template grammar is not claimed.
- Exclusive vault open-or-create preserves existing files and serializes concurrent calls; native sender/vault/path protections remain enabled.

## Evidence

`node --test tests/native-workflows.test.mjs tests/vault.test.mjs tests/preload.test.mjs tests/security.test.mjs`: 20 passed. These cover default naming, leap/invalid dates, locale versus ISO week-year, historical date/current time templates, existing-note next/previous, navigation ordering/reconciliation, concurrent exclusive creation and existing security regressions.

Actual Mac Electron verification: `scripts/verify-native-workflows.mjs`, using a temporary profile/vault and the project's Electron executable. It verified:

1. Open commands by keyboard, choose calendar, configure a template/folder and create a dated note.
2. Persist CRLF template bytes; edit/save and reopen without applying the template again.
3. Navigate recent files; bookmark and restart; confirm bookmark and journal preferences persist.
4. Insert a template in the real editor and undo it in one step.
5. Rename/delete the bookmarked file and verify the navigation entries change accordingly.
6. Open a second vault using the same profile and verify bookmarks, recent files and preferences are isolated.
7. Keep Cmd/Ctrl+K document switching distinct from commands; no renderer page errors.

`npm test`: 165 passed, zero failed. `npm run build`: successful; existing large-bundle warning remains.

Ignored output: `output/playwright/native-workflows.json`, `native-journal.png`; unit/build logs in `output/research/`. Windows runtime and packaged-artifact execution are not established by these Mac source-app tests.

## Native editor tools slice

OUTLINE-01 representative source and runtime behavior now matches the controlled original Outliner observations: subtree up/down, indent/outdent, fold/unfold. Commands and Alt+Up/Down are available; Tab/Shift+Tab prefer subtree indentation when applicable. Text edits are one undo step and use existing SaveQueue/revision checks. Fenced examples and YAML list-looking content are excluded. Drag handles, multi-item selection operations and broader compatibility remain unverified.

DIAGRAM-01: native Mermaid dialog supplies twenty independently authored editable diagram families, inserts at the editor selection and distinguishes an existing Mermaid fence. All twenty samples parse with the installed Mermaid parser. This does not claim that every original plugin element preset has been reproduced.

`node --test tests/outliner.test.mjs tests/diagram-tools.test.mjs`: 5 passed. `scripts/verify-editor-tools.mjs` executed actual Mac Electron subtree move/one-step undo, fold/unfold with original disk bytes, twenty-family selection, Mermaid insertion/undo and SVG rendering. No renderer page errors. Evidence: ignored `output/playwright/native-editor-tools.json` and `native-editor-tools.png`.

## Native mindmap slice

Original controlled Markmind execution successfully converted synthetic `Map.md` into separate `Map-rich.md`. The generated document is `tests/fixtures/markmind-rich.md`; it contains no private notes/settings. Markmind uses `mindmapview`, whereas Enhancing Mindmap used `mindmapView` in the controlled run. The fixture temporarily disabled/re-enabled only synthetic plugin instances to select the intended implementation.

MAP-01/02 implemented: parse basic heading/list hierarchy and original rich flat-node JSON; rename/add child/add sibling/delete subtree; collapse/expand; native undo/redo; rich drag coordinate persistence; safe separate-file basic/rich conversion. Basic edits preserve frontmatter, body prose, block IDs and CRLF. Rich edits preserve unknown properties/arrays/styles; malformed/cyclic data reports an error and offers Markdown editing. Deleting rich subtrees with unsupported decorations/relationships is rejected to avoid dangling references.

`tests/mindmap.test.mjs`: 5 passed, including original generated rich fixture, edits/conversions, coordinate validation, malformed/cyclic data and decorated-tree preservation. `scripts/verify-mindmap-tools.mjs` verified actual Mac Electron basic edit/save/undo, rich drag persistence and unknown fields, conversion/source preservation, collision refusal and invalid-rich fallback. No renderer page errors. Output: ignored `output/playwright/native-mindmap.json`, `native-mindmap.png`.

Remaining Markmind/Enhancing features include richer layout/presentation, node clipboard and exports, decorated relationship editing, PDF/EPUB annotation integration, licensed original functions and external AI/translation/GROBID services. Those are not established by this slice.

## Native PDF link slice

PDF-01 read/navigation implemented: selectable PDF.js text layer, numeric page/zoom controls, page and selected-text wiki link copying, incoming text-range restoration, existing PDF annotation rectangle navigation, and Markdown backlinks. Attachment paths and fragments travel separately so a literal `#` in a valid filename remains readable. Original PDF bytes are unchanged by this slice.

Original PDF++ runtime in the isolated fixture selected `page` on the second page and copied `manual.pdf#page=2&selection=0,7,0,11` inside its default callout format. Dynote emits the same page/selection target schema without requiring the original callout preset. Original continuous-view `getState()` reported page 1 while the copied target correctly identified page 2; do not use the first visible page as the selected text's page.

`tests/pdf-links.test.mjs`: 4 passed, covering path/fragment preservation, strict numeric range validation, relative backlinks/fence exclusion and hash-bearing filenames. Actual `scripts/verify-pdf-links.mjs` checked page 2 selection restoration, trusted clipboard output, zoom cancellation, backlink return, original annotation navigation, encoded hash filename navigation and byte-for-byte PDF preservation. No renderer page errors. Output: ignored `output/playwright/native-pdf-links.json`, `native-pdf-links.png`.

Whole suite: 179 passed, zero failed. Build successful. PDF annotation creation/editing, page manipulation, outlines/labels, rectangular selection and Markmind annotation formats remain open; this is not full PDF++ parity.
