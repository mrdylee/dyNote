# Aside-style right-hand table of contents

## Reference and evidence

The user requested the **On this page** design visible in Aside, with a choice between the outline and Copilot. The current Aside window showed https://docs.aside.com/changelog/native; the reference is the help website's outline.

Craft Anything 0.5.0 captured the public page in a fresh browser profile after the user approved script execution. Approval applied only to that analysis invocation; global settings were not changed. The browser was closed after capture.

- Open evidence: `ev_5b382ff77e4aeb51dfe66ded5b5f637c7fdf79d4d10bc3f455d9c1f3759a5c14`
- Capture evidence: `ev_46d2719e1f5669004f031529b62d7c399f95b09c3d56fdb97567ac1d4db1718e`
- Local artifacts: `output/aside-outline/capture/`, `output/aside-outline/evidence.json`, `output/aside-outline/investigation.cany/`

Observed in the captured rendered HTML: `nd-toc`, an independent scroll area, wrapping links, an SVG hierarchy rail with 8px depth changes, and blue (`#0284c7`) active styling. Capture covers one public-page state, not every interaction or breakpoint. The implementation reproduces the visual pattern using Dynote's existing parsed Markdown headings.

## Implementation

- Right panel choices: **목차**, **Copilot**, **문서 정보**. Outline is the initial default; the selected tab is saved as `dynote.rightTab`.
- The outline has a curved hierarchy rail, wrapped labels, a scroll-following active marker and its own scroll area. A toolbar button opens it directly.
- Existing properties and backlinks remain in document info; switching tabs leaves the mounted Copilot session and composer intact.
- Heading clicks preserve the current Markdown view. Edit, live and split views navigate the editor by source line, including repeated heading text. Read view resolves the matching occurrence across H1–H6, excluding embedded-note headings.
- Split view follows the editor; it does not introduce synchronized scrolling between source and preview.
- The outline targets an open Markdown document. Journal feed, graph, planner, mindmap and non-Markdown viewers display the empty-state hint.

## Verification

Validated in development Electron 44.9.1 on macOS arm64 with temporary test profiles and synthetic Markdown files.

- `npm run build`: passed; existing large-chunk advisory remains.
- `node --test tests/knowledge.test.mjs tests/document-workspace.test.mjs tests/copilot-edits.test.mjs`: 19 passed.
- `scripts/verify-table-of-contents.mjs`: 11 check groups passed, including formatted/repeated/deep headings, fenced-code exclusion, click and scroll highlighting, preserved modes, Copilot drafts, tab persistence, empty state, reopening, minimum window width and unchanged source bytes. No renderer errors.
- `scripts/verify-live-preview-review.mjs`: 22 checks passed, covering heading links and LF/CRLF/BOM editing and undo. No renderer errors or remote requests.
- `git diff --check`: passed.

UI scripts used `DYNOTE_PLAYWRIGHT_MODULE=/tmp/dynote-real-copilot-ui/node_modules/playwright/index.mjs` because Playwright is not a repository dependency.

Screenshot: `output/playwright/table-of-contents.png`. Reports: `output/playwright/table-of-contents.json` and `output/playwright/live-preview-review.json`.

No release, installed-app replacement, Windows runtime validation or live AI request was performed. Pre-existing update-folder and Sticky Note changes in this worktree were preserved.
