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

`src/live-preview.mjs` independently implements CodeMirror decorations and widgets from public APIs. Wiki syntax participates in the Markdown parser rather than scanning rendered HTML. A StateField provides decorations directly; selection reveals the relevant range. During composition, existing ranges map through edits and rebuild after composition ends. The composition timer is cleaned up on destruction. No raw HTML is injected and no Obsidian implementation code is copied.

The earlier REA/runtime comparison is retained outside this product repo at `../research/live-preview-2026-10-19/REVIEW.md`. The reference `JingHao-Leon/open-obsidian` at `d660144` uses a textarea plus separate preview, so its editor was not reused for this feature. Existing SaveQueue, attachment path validation, custom image protocol and external-URL allowlist remain in use.

The local review added regression cases for UTF-8 BOM frontmatter, empty wiki aliases, setext headings and frontmatter-aware heading offsets. Source/live toggling does not replace the document or rebuild EditorView. Live/source modes also avoid generating an unused full reading preview.

## Validation

On 2026-10-19, **80 tests passed**, the production build succeeded, and all runtime harness assertions passed with **zero page/console errors and zero HTTP(S) requests**. The existing Vite chunk-size advisory remains. The retained [verification report](verification/live-preview-runtime.json) lists the checks and evidence limits. A focused 46,890-character / 1,000-section fixture measured selection-only decoration transactions at approximately 3.73 ms p95 across 60 samples on this host; this excludes rendering, vault indexing and OS input latency.

Commands:

```sh
npm test
npm run build
# Use an installed Playwright module; the repository does not add a runtime dependency.
DYNOTE_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/verify-live-preview-runtime.mjs
```

The runtime harness creates an isolated profile and synthetic vault. It checks actual Electron rendering, selective syntax reveal, local image decoding, Korean text insertion, source/live selection and undo/redo, Markdown copy, checkbox autosave, image source editing, wiki links, heading offsets, synthetic composition lifecycle, clipboard/drop imports, exact disk content after reopening, and long-document scroll anchoring. It asserts no page/console errors and no HTTP(S) requests. Screenshot and machine-readable report are written to `output/playwright/live-preview.png` and `output/playwright/live-preview-runtime.json`.

Evidence applies to an Apple Silicon macOS development build. Korean text injection and synthetic composition events do not establish native IME behavior. Windows execution and a new packaged release are not part of this verification.
