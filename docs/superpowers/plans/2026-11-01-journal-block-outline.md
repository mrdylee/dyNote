# Journal-only block outline implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. Track changing status in work_state_write. The user explicitly requested REA analysis, brainstorming, implementation, verification and deployment.

**Goal:** Make daily journals convenient hierarchical block notes while retaining plain Markdown and existing AI edit review.

**Architecture:** Seed newly created daily journals with a Markdown bullet. Enable a small CodeMirror extension only for paths recognized by the existing daily-journal preferences. Reuse existing subtree indentation, movement, folding, save queue and AI proposal review. Keep ordinary documents and user templates unchanged.

**Tech stack:** React, CodeMirror 6, Electron, Node tests, native Playwright scenarios, existing desktop packaging and GitHub Actions.

## Decisions and evidence

- User confirmed Tab indentation and hierarchical blocks, then limited changes to journals. Their intent is to provide parent/child context for later AI organization; do not add unsolicited automatic AI calls or categorization.
- REA official Logseq web demo: `ev_cd422e51df0273da84b4eab82daa1b46ff9787c4c878058efb7d9d739c0a6024` observes Enter siblings, Tab children, Shift+Tab roots and Shift+Enter continuation. `ev_961c02d68a8a7188ae9ab5535a5b214f5d432f358710c13114f79f586da76c5a` observes Enter on an expanded parent inserting a first child without reparenting existing children.
- Latest official desktop 2.0.2 is a DB version. Its authenticated download and partial REA static findings are separate from web runtime facts; the 16 MB main bundle exceeded the selected analysis heap. Do not copy Logseq code or introduce its DB.
- Default daily content becomes `# DATE\n\n- `. Existing journal files/templates are never automatically rewritten. Other periodic notes retain their current defaults.
- Add journal-only block guidance, an explicit add-block action for existing prose journals, indentation guides and existing fold controls. Keep Enter/Tab behavior outside journals unchanged.
- AI context retains raw Markdown hierarchy. Verify this and proposal application with synthetic parent/child notes. This does not prove better model understanding or remove existing AI context limits.

## Tasks

1. Add failing command regressions in `tests/journal-outline.test.mjs`: sibling/child Enter, split block, empty nested outdent, Shift+Enter continuation, first-root Tab no-op, subtree indent/undo, literal YAML/fences/code/read-only/composition exclusions. Use real CodeMirror state and history.
2. Add native journal scenario with cross-platform modifier keys. It must fail before implementation: new journal bullet/focus, Enter/Tab/Shift+Tab, visible hierarchy, parent/child folding, old prose unchanged until explicit block addition, normal-document behavior, custom templates, raw AI context/proposal preservation, exact save/restart. Adjust the previous journal-large-file fixture's expected default bullet intentionally.
3. Create `src/journal-outline.mjs`; reuse `runOutlineCommand` and Markdown commands where they match observed behavior. Keep its new keymap ahead of Markdown's high-priority Enter binding. Add only the parent/child and soft-line behavior needed for journals. Use visible-range decorations rather than rebuilding a separate document model.
4. Pass journal identity through `src/App.jsx` and `src/DocumentWorkspace.jsx` into `src/Editor.jsx`; use a compartment so switching paths/modes respects journal scope and retains undo/selection. Add scoped CSS and short user-facing keyboard guidance. Preserve all prior changes.
5. Run focused tests (observe RED, then GREEN), full unit suite, production build and diff check. Run the native scenario and existing journal, editor, large-file and AI proposal checks. Capture new native behavior under REA process observation with synthetic data only; record exact evidence and limits.
6. Prepare version 0.13.0 release notes including already-installed but unpublished fixes. Build/verify Mac package and source-byte/signature integrity. Add a narrowly triggered release workflow for Mac arm64 and Windows x64 with native platform checks; publish only after both succeed.
7. Review all cumulative source/test/release changes and exclude handoffs, ignored output, user data and credentials. Commit the reviewed source and push the release branch without force. CI creates the release tag only after both platforms pass. Verify CI plus downloaded public checksums. Back up and normally quit/update/relaunch the local Mac app while preserving the user's notes and provider choice.

## Verification boundaries

Do not claim full Logseq parity, copied implementation, live model-quality improvement, public publication before download verification, or Windows runtime validation from cross-packaging alone. Local notes are never sent for a test.
