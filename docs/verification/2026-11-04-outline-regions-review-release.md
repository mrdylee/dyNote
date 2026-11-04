# v0.15.0 review and release verification

The user authorized review, fixes and public deployment. Review was performed locally against the final parser, editor scope/selection/history, connector geometry and release workflow. Unrelated pre-existing files are excluded from the release commit.

## Findings and fixes

1. A drag ending exactly at the start of the next list item captured that unselected sibling and its children. Lezer iteration now respects the exclusive selection end. The new regression failed before the fix and passes afterward.
2. A malformed outer region containing multiple nested groups could activate a later inner group. The parser now tracks the full nesting depth and leaves the entire malformed group literal. The new regression failed before the fix and passes afterward.
3. Imported Markdown with four spaces or tabs displayed 60px between hierarchy levels because visual width followed raw whitespace. Width and the offscreen ancestor fallback now use actual list depth. Native bullet centers changed from `[359,419,479]` to `[359,389,419]`, while the original Markdown bytes remained unchanged.

An additional EOF-body deletion/removal regression passed without a production change. Earlier feature checks cover complete line/subtree selection, overlapping-region refusal, code/metadata boundaries, BOM/CRLF/EOF preservation, undo, stable toolbar height during drag, and the logical region-root outdent guard.

## Local verification

- Focused parser/editor regressions: 43 passed, zero failures/skips. Region tests: 19.
- Complete unit suite: 392 passed, zero failures/skips.
- Dependency audit: zero vulnerabilities at all severities.
- Production build and Mac arm64 package succeeded. The existing bundle-size advisory remains.
- Mac packaged-source verification matched 279 source/bundle files and passed strict deep ad-hoc signature verification. App version: 0.15.0.
- All 12 native Mac package scenarios passed, including 9 selected-region groups and 15 threading groups, without renderer errors. These cover real mouse dragging, independent regions, prose conversion, scoped Tab/undo, 30px spacing, heading alignment, task paths, folding/scrolling/resizing, source/read/live views, exact saves/restart, existing journals, Git and deterministic AI-provider flows.
- Final manifests and the release workflow were parsed and checked. Both Mac arm64 and Windows x64 jobs must pass tests, audit, packaging, exact source comparison and native scenarios before the publish job runs. The package-verification JSON receipts are published alongside the runtime archives and SHA-256 files.

Local evidence is retained under ignored `output/playwright/`, `output/verification/v0150-package-mac.json` and `/private/tmp/dynote-v0150-review/`. Public-release evidence is recorded after CI and re-download verification; local source/package success alone is not a public deployment claim.

## Boundaries

Mac uses ad-hoc signing and is not Apple-notarized. AI scenarios use deterministic fixtures, not live account authentication or paid model inference. Windows x64 runtime is validated by native Windows CI, not by local Mac execution. The installed application and user notes/accounts are not replaced by this publication task.
