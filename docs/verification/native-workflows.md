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

## Native Git workspace and update information

GIT-01 slice: changed/staged file status, per-file staging/unstaging, safe tracked-file diff, staged commit, explicit fetch and clean fast-forward pull, local branch list/create/switch/merged-only delete. Git operations reuse disabled hooks/interactive credential protections, reject parent/worktree repositories and excluded staged files, and serialize through GitController. Native mutations hold the exclusive vault-operation lock. Branch changes require automatic backup to be off. Initial-index unstage uses cached-only removal and preserves newer worktree bytes.

`tests/git-workspace.test.mjs`: 6 real-repository tests covering stage/diff/commit/unstage, excluded staging, branch validation, local bare-remote fetch/pull, dirty/divergent pull preservation, parent repository rejection and unmerged branch protection. Actual `scripts/verify-git-workspace.mjs` confirmed status/stage/diff/commit through the UI and Git HEAD, local branch changes, and dirty-file refusal without byte loss. No renderer page errors. External SSH/HTTPS authentication and Windows runtime are not established by local Git remotes.

The controlled original Obsidian fixture now has its own standalone synthetic `.git` and no remote. Original Git commands staged `Fixture.md` (`M ` in actual index status) and opened the Git view. Earlier read-only plugin startup had displayed the enclosing research repository's branch; no original Git mutation was exercised until the standalone fixture repository was initialized.

UPDATE-01: explicit Dynote release check, current/latest version, plain-text release notes, beta selection, ignored-version restore and canonical official release/asset links. No startup request or automatic installer. `tests/update-information.test.mjs`: 4 passed for version ordering, channel/draft filtering, malformed identifiers, safe URLs and inert text.

Actual `scripts/verify-update-information.mjs` made one successful public GitHub release request through the main process. Subsequent controlled-feed UI checks separately verified inert release text, ignore/restore persistence, channel persistence and honest failure state. Controlled-feed results are not live release evidence. No assets were downloaded or installed. Output: ignored `output/playwright/native-git-workspace.json`, `native-updates.json` and screenshots.

Remaining Git scope: partial-hunk staging, blame, remote/upstream management, merge-conflict workflows and deliberately destructive/raw commands. Update information is complete for the defined native slice; automatic platform installation is not implemented.

## Journal details and core word count

JOURNAL-02: native timestamp insertion with current clock/target-day behavior, selectable 1–5 daily rating, past same-day journal list, configurable stamp formats and existing next/previous period commands. Rating edits preserve unrelated YAML/comments/body, and malformed structured rating values do not crash the dialog. Editor commands discard stale document targets and insert stamps as one undo transaction. Periodic navigation is calculated only while the palette is open and memoized across query typing.

Original Diarian used Korean Moment locale and emitted `— 10/27/2026 11:22 오후 —` followed by two newlines in a non-dated empty note. Original core statistics counted the synthetic mixed Korean/English/emoji Markdown as 4 words/24 UTF-16 characters, unchanged after YAML was added. Native statistics exclude YAML accordingly.

Runtime verification found an ESM/CommonJS date-instance mismatch: Node tests registered Korean/UK locales on one Moment instance while the renderer imported another. Native imports now consistently use `moment/moment.js`, shared with locale registration. Actual Electron now verifies both Korean timestamps and the UK week-year boundary `2021-01-01` -> `2020-W53.md`.

`tests/journal-details.test.mjs`: 4 passed. Actual `scripts/verify-journal-details.mjs` checked timestamp/one-step undo, rating normalization and save/reopen, original word/character fixture, past-day navigation and next-existing-daily command. `scripts/verify-native-workflows.mjs` also passed the added renderer week-year regression and all prior navigation/journal cases. No renderer page errors. Ignored output: `native-journal-details.json` and screenshots under `output/playwright/`.

Diarian bulk import/date conversion and alternate journal/calendar views remain open. Mixed-language segmentation beyond the original fixture is native behavior, not a claim of identical counting in every language.

## Native audio and web viewer

CORE-AUDIO: explicit microphone start, stop/save/cancel, active modal/app-close guard, stale/late stream cleanup, local WebM attachment and note embed, Blob audio playback. WebM/WAV/MP3/Ogg/M4A signatures are validated under the existing 25MB attachment bound; trash/restore retains bytes. Audio permission is limited to the exact main note frame and audio-only requests; camera/unknown/subframes/remote pages remain denied. Packaging includes macOS microphone usage text; actual packaged OS consent remains unverified.

Actual `scripts/verify-audio-runtime.mjs` used Chromium's synthetic audio device flags, never a physical microphone. It verified app/modal close guard, cancel without file creation, a saved 13,499-byte WebM sample with EBML header, Markdown link persistence and audio metadata loading without autoplay or speaker playback. No renderer errors. This is software-input proof, not physical microphone/Windows proof.

CORE-WEB: explicit HTTP/HTTPS URL entry opens an isolated native child window. Its separate in-memory session has no note preload/bridge or Node integration, sandbox/context isolation stay enabled, remote permissions/downloads/popups and non-web navigation are denied. The main note renderer's network blocking stays in place. Main-child lifecycle listeners are cleaned up.

Actual `scripts/verify-web-viewer.mjs` loaded only a local HTTP fixture and verified remote `window.notes`/`require` absent, microphone denial, actual separate session object and sandbox preferences, file navigation/popup/download prevention, fixed actual hostname title and child close preserving the note window. The title test caught and corrected an Electron event-target mismatch: page title prevention belongs to BrowserWindow. No external accounts/sites were opened.

Ignored evidence: `output/playwright/native-audio.json`, `native-web-viewer.json` and screenshots. These add basic recording/playback and reading-window functionality; audio editing/transcription and a full browser/download manager are not implemented.

## 2026-10-28 Composer and Page Preview

CORE-COMPOSER: previewed selection/heading extraction to a new file, append/prepend merge into an existing document, observed source-property precedence and array union, relative-link rebasing, incoming Markdown/Canvas heading/block redirects, and recoverable source removal. Source YAML is retained during extraction. Eight tests cover original merge output, CRLF/aliases/fences, collisions/stale revisions, oversized result refusal, Canvas references, rollback on a later write failure and an unrelated sparse 600MB PDF. The latter stays untouched and is not read/copied into recovery. Document revision checks include supported attachment paths, not unrelated attachment bytes. Multi-file changes have rollback and recovery copies; no power-loss atomicity claim.

CORE-PREVIEW: resolved reading/live note links show delayed sanitized read-only Markdown, bounded nested embeds, and an explicit Open action. Document/modal/vault changes cancel pending previews. External/unresolved/ambiguous targets do not preview.

Original controlled Obsidian execution: `note-composer.mergeFile(target,source,'append')` completed, removed source, retained target/source body order, used source scalar properties, and combined tags in target/source order. Original Mermaid toolbar and Update Tracker manager also opened in the isolated research profile. Original core audio generated an M4A file from Chromium's synthetic audio device; native recording uses WebM and supports reading validated M4A. No private microphone recording or personal note data was used.

Actual Electron `scripts/verify-note-composer.mjs` passed read-only hover/open, real keyboard selection extraction, no-write preview, refusal after external target modification, successful refreshed merge/incoming-link rewrite, heading-with-children extraction/source YAML preservation, and recovery bytes. `scripts/verify-graph-drag.mjs` passed again after App integration, including held physics, changed arrangement on release and cancel/lost capture. Full suite: **204 passed, zero failed/skipped**. Production build successful with the existing large-chunk warning. These checks are macOS source-app evidence; Windows, packaged microphone consent and complete advanced plugin parity remain unverified.

## 2026-10-28 Persisted PDF annotations

PDF-EDIT extends PDF-01 with native Highlight creation from text-selection rectangles, Unicode comment/color editing, supported annotation removal, annotation location/link copying, explicit no-write preview and source-revision guarded save. Existing unrelated annotations survive. Saved PDF bytes change only after explicit save; the previous PDF is copied outside the vault before replacement. The existing 25MB bound is unchanged. Encrypted/signature-bearing documents are refused for this rewrite workflow. Markmind sidecars, arbitrary annotation types, PDF outline/page/label editing remain outside this slice.

Original PDF++ actually wrote Highlight `10R` into the owned synthetic PDF after enabling its editing setting and setting a synthetic author. Palette `yellow` resolved to RGB 255/208/0 with opacity 0.2. `tests/fixtures/pdf-plus-highlight.pdf` contains only generated test text and controlled annotations. Native PDF.js-parsed subtype/geometry/quad points/color/opacity match this observed fixture. Six real-file tests cover save/reload, exact recovery, edit/delete preserving other annotations, malformed inputs/stale bytes, a signature field, and marked-encrypted input rejection.

Actual Electron `scripts/verify-pdf-editing.mjs` passed: incoming text selection -> preview -> highlight save -> reopen -> Unicode memo/color edit -> annotation link clipboard -> refusal after external modification -> reopening/refreshed deletion -> original annotation retained, exact original PDF recovery. `scripts/verify-pdf-links.mjs` passed again, including hash-containing filenames and unchanged bytes for read-only navigation. The UI cannot apply an operation planned from a stale opened PDF. Source app on macOS only; no Windows or packaged-app claim.

## Final regression pass, 2026-10-28

Whole suite: **210 passed, zero failed/skipped**. Production build successful; large-bundle warning remains. Eleven actual native workflow scripts passed on the final build: navigation/journal, editor tools, mindmaps, PDF links, PDF editing, Git workspace, update information, journal details, synthetic audio, isolated web viewer, and note composition/hover. Graph drag also passed after Composer integration. Logs are local ignored `output/research/final-tests.log`, `final-build.log`, `final-native-runtime.log`, `final-runtime-suite.log`; individual runtime receipts/screenshots are under `output/playwright/`.

Review found the calendar grid still used Sunday headings while the configured locale could use Monday week boundaries. An actual UI regression first failed (`일` versus `Mo`); JournalPanel now explicitly applies the chosen locale to weekday headings and leading empty cells. The January 2021 renderer check verifies Monday headings, four padding cells, and the matching 2020-W53 weekly path. Optional Composer/PDF backend modules load only when invoked, avoiding new eager PDF/parser loading at app startup. No measured Windows startup improvement is asserted.

Local review checked sender/vault validation, Git serialization/exclusive mutations, source revision guards, source-safe preview, scoped recovery, stale PDF geometry refusal, readonly/sanitized hover, unchanged unrelated bytes, and explicit remaining portfolio gaps. No remote push, new package/release or complete plugin equivalence claim accompanies this branch.
