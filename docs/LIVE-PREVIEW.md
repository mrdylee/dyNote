# Live Preview phase 1

Status: local development source on `feat/live-preview`, based on `1f4994d`. The existing v0.3.0 release and packages do not contain this feature.

## Use

Run `npm run build` and `npm start`, open a Markdown note, then choose the sparkle **Live Preview** button between reading and source editing. Click formatted text to edit its Markdown. Cmd/Ctrl-click a link, or put the cursor inside the link and press Cmd/Ctrl-Enter to open it. Click an image to reveal its source. Click a task checkbox to update the file; normal undo/redo applies. Source editing is still the pencil button, and split/reading views remain available.

The same CodeMirror instance remains mounted when switching between source, Live Preview and split views. It retains selection and undo history; source/live transitions anchor the visible text when typography changes. Reading view still unmounts the editor, as before.

## Supported scope

- ATX and setext headings, bold, italic, strike, inline code, unordered/ordered lists.
- Inline Markdown links and wiki links/aliases, existing wiki autocomplete, local document and heading navigation, attachment/external link routing through the existing application boundary.
- Undoable task checkboxes, including read-only protection.
- Resolved local PNG/JPEG/GIF/WebP image widgets, clipboard and file-drop import through the existing attachment API. Remote/missing images and SVG remain source text.
- Source remains authoritative. Copying a selection copies Markdown, including syntax hidden by the preview.

Tables, reference-style links, document embeds, PDF, math, Mermaid and callouts do not gain inline widgets in this phase. Frontmatter, code and HTML stay literal. This is not complete Obsidian editor parity. Native OS IME composition, especially Windows Korean IME, requires target-platform acceptance testing.

## Implementation and review

`src/live-preview.mjs` independently implements CodeMirror decorations and widgets from public APIs. Wiki syntax participates in the Markdown parser rather than scanning rendered HTML. A StateField provides decorations directly. A range index records reveal boundaries for both hidden and active syntax; selection-only changes query the old and new selections and update affected replacements. During composition, existing ranges map through edits and rebuild after composition ends. The composition timer is cleaned up on destruction. No raw HTML is injected and no Obsidian implementation code is copied.

The earlier REA/runtime comparison is retained outside this product repo at `../research/live-preview-2026-10-19/REVIEW.md`. The reference `JingHao-Leon/open-obsidian` at `d660144` uses a textarea plus separate preview, so its editor was not reused for this feature. Existing SaveQueue, attachment path validation, custom image protocol and external-URL allowlist remain in use.

The local review added regression cases for UTF-8 BOM frontmatter, empty wiki aliases, setext headings and frontmatter-aware heading offsets. Source/live toggling does not replace the document or rebuild EditorView. Live/source modes also avoid generating an unused full reading preview.

Review fixes preserve each file's LF/CRLF convention when serializing editor changes, while keeping CodeMirror offsets normalized internally. Uniform CRLF, BOM+CRLF and LF files are checked byte-for-byte after checkbox changes, undo, new lines and reopening. Mixed line endings normalize to the first newline convention when edited. Heading navigation accepts visible inline text and its slug, including bold, code, links and encoded Korean fragments; original heading source and existing rendered anchor IDs remain supported.

## Validation

On 2026-10-19, **83 tests passed**, the production build succeeded, and the original runtime harness plus the review regression harness passed with **zero page/console errors and zero HTTP(S) requests**. The existing Vite chunk-size advisory remains. The original [verification report](verification/live-preview-runtime.json) and [review-fix results](verification/live-preview-review-fixes.json) list the checks and evidence limits.

The same fully parsed fixtures and 20 selection-only transactions per case were measured before and after the review fix on this host:

| Document characters | Before median / p95 | After median / p95 |
| --- | --- | --- |
| 46,890 | 2.84 / 6.66 ms | 0.093 / 0.460 ms |
| 478,890 | 27.68 / 46.55 ms | 0.082 / 0.188 ms |
| 1,458,890 | 92.50 / 149.82 ms | 0.095 / 0.275 ms |

These measurements exclude DOM rendering, vault indexing, typing and OS input latency. Text edits, parser updates, attachment refreshes and read-only changes still rebuild decorations; the optimization applies to selection-only changes. The regression test compares selection cost against full rebuild cost and checks incremental output against a fresh render for nested spans, boundaries, distant jumps, multiple ranges and document edits.

Commands:

```sh
npm test
npm run build
# Use an installed Playwright module; the repository does not add a runtime dependency.
DYNOTE_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/verify-live-preview-runtime.mjs
DYNOTE_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/verify-live-preview-review.mjs
node scripts/benchmark-live-preview.mjs
```

The runtime harness creates an isolated profile and synthetic vault. It checks actual Electron rendering, selective syntax reveal, local image decoding, Korean text insertion, source/live selection and undo/redo, Markdown copy, checkbox autosave, image source editing, wiki links, heading offsets, synthetic composition lifecycle, clipboard/drop imports, exact disk content after reopening, and long-document scroll anchoring. It asserts no page/console errors and no HTTP(S) requests. Screenshot and machine-readable report are written to `output/playwright/live-preview.png` and `output/playwright/live-preview-runtime.json`.

Evidence applies to an Apple Silicon macOS development build. Chromium IME composition was also exercised with `Input.imeSetComposition` through ㅎ → 하 → 한, committing 한글 and undoing it inside bold text. This and the synthetic composition checks do not establish native OS IME behavior. Windows execution and a new packaged release are not part of this verification.
