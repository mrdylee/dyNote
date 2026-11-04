# Journal bullets and Bullet Threading

> Execute inline with Superpowers planning, systematic debugging, test-first implementation and verification-before-completion. The user confirmed Bullet Threading. Preserve unrelated working-tree changes.

**Goal:** Match Logseq heading/bullet alignment in daily-journal Write mode and show the focused block's ancestor path.

**Design:** Keep plain Markdown and the existing journal-only CodeMirror extension. Use a small CSS circle inside the existing bullet widget. Use CodeMirror's measured layer API for rounded connectors between actual rendered bullet centers. Resolve ancestry from the Markdown syntax tree, not indentation guesses. Keep source mode and ordinary documents unchanged.

**Reference:** REA controlled Logseq browser scenario `ev_80275886e591f72e01f70a8dc16bace17d9c8accab4bf0cfef844119959022e5` completed all declared actions with zero page errors. Its DOM records heading control sizes 28px/24px; the screenshot shows small circles aligned with H1/H2. This establishes the tested web appearance, not complete desktop parity. The upstream Bullet Threading plugin highlights the active block and its ancestor path: https://github.com/pengx17/logseq-plugin-bullet-threading.

## Implementation and checks

- [x] Add `scripts/verify-journal-threading.mjs` using a temporary profile and synthetic vault. Observe failures for heading circle dimensions and missing ancestor connectors before changing production code.
- [x] Extend `src/journal-outline.mjs` with focused ancestor line classes and a measured connector layer. Preserve journal commands, parser exclusions, selection, undo and saved bytes. Refresh on cursor/focus/document/viewport/geometry changes.
- [x] Scope circle and connector styles to journal live preview in `src/styles.css`. Keep circles small and center them on the heading's first text row. Retain normal-document rendering.
- [x] Pass native checks for H1/H2/body dimensions, correct ancestry, cursor changes, continuation, indentation/undo, folding, wrapping, scrolling, source mode, ordinary documents and exact save/restart.
- [x] Run focused journal/live-preview unit tests, full `npm test`, `npm run build`, existing native journal-outline scenario and `git diff --check`. Inspect screenshots and record results under `docs/verification/2026-11-04-journal-bullets-threading.md`.

No release, installation or provider/account changes are included in this UI task.
