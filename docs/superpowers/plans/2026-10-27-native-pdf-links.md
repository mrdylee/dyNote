# Native PDF Links Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans by default for continuous inline implementation. Use superpowers:subagent-driven-development only when the user explicitly requested subagents or parallel agent work. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Preserve and roundtrip PDF page/text/annotation links with selectable text and Markdown backlinks.

**Architecture:** Pure PDF fragment/link helpers and existing Markdown resolver feed the PDF.js viewer. A narrow trusted clipboard IPC copies user-requested text; file bytes remain read-only.

**Tech Stack:** Existing PDF.js6, React, MarkdownIt and Electron clipboard; Node tests and actual Electron runtime.

---

### Task 1: Test fragments and backlink semantics

Files: `core/pdf-links.mjs`, `tests/pdf-links.test.mjs`, `core/markdown-extensions.mjs`.

- [x] Write failing tests for `parsePdfFragment`, `pdfWikiLink`, `pdfBacklinks`: 1-based page, four nonnegative integer selection offsets, annotation IDs, invalid numeric data, fenced-code exclusions and relative-path resolution.
- [x] Render a wiki PDF link and a Markdown PDF link with `#page=2&selection=0,0,0,5`; verify data-attachment retains the escaped fragment and normalized base path. Preserve existing attachment/image behavior.
- [x] Run `node --test tests/pdf-links.test.mjs`; implement pure helpers and retain fragments in renderer rules; rerun.

### Task 2: Read-only PDF text and navigation

Files: `src/PdfViewer.jsx`, `src/App.jsx`, `src/styles.css`.

- [x] Add a PDF.js TextLayer above the canvas, selectable text, numeric page control and zoom. Cancel both rendering tasks on page/document changes.
- [x] Capture selected text-item indexes/offsets and copy a compatible wiki link. On incoming fragment, open its page, validate text range against rendered items, restore selection and scroll it into view. Match existing annotation IDs and show their viewport rectangle.
- [x] Preserve fragments through rendered-link and editor-link handling while sending only the base file path to native readAttachment. List resolved Markdown backlinks and allow note/PDF-fragment navigation.

### Task 3: Trusted clipboard and actual roundtrip

Files: `electron/main.mjs`, `electron/preload.cjs`, `tests/preload.test.mjs`, `scripts/verify-pdf-links.mjs`, synthetic `tests/fixtures/link-target.pdf`.

- [x] Expose `copyText` through existing sender/vault validation, bounded string input and Electron clipboard. It must not mark vault files dirty or permit arbitrary native actions.
- [x] Launch actual Dynote with synthetic Markdown linking to PDF page 2. Assert canvas/text/page state; create a browser text selection, copy link, inspect clipboard, reopen it from Markdown, and verify selected text plus source bytes.
- [x] Verify existing annotation fragment navigation and backlink return. Run whole tests/build and record remaining PDF editing/annotation-creation scope.
