# Copilot composer and live-edit review — 2026-10-20

Implemented and installed locally on macOS; no GitHub publication in this task.

## Implemented

- Enter sends; Shift+Enter adds a newline on both desktop platforms. IME `isComposing` and keyCode 229, held Enter, empty input and pending requests are guarded. The send button and keyboard share the same eligibility check.
- The prompt and compact Agent/Ask/Edit + model selectors share a bordered composer. Auto is the existing GitHub-provided model, not a second automation setting.
- Markdown tables and completed Mermaid code fences display in replies. Mermaid uses the existing strict renderer and sanitized SVG; links, foreignObject and images are removed. Partial streaming responses remain code; invalid diagrams remain readable source.
- Prompt clearing compares the original input so trailing Shift+Enter newlines do not leave a completed request in the input, while newly typed follow-up text is preserved.

## Validation

- Before the change, the new composer runtime test failed waiting for plain Enter to start a request (old behavior required Ctrl/Cmd+Enter).
- `npm test`: 139 passed, zero failed.
- `npm run build`: passed; existing large-chunk advisory remains.
- `scripts/verify-copilot-composer.mjs`: passed from source and from the packaged Mac executable. Tests Shift+Enter, Enter, synthetic composition/keyCode229, duplicate/empty send, final/streaming/invalid Mermaid, safe markup, tables and layout at 1050x700. No page errors. Synthetic vault stays unchanged.
- `scripts/verify-copilot-agent-runtime.mjs`: passed existing attachment, reviewed apply/create, selection boundaries, CRLF, undo, stale draft and external-change checks.
- Model transport in UI tests is deterministic IPC, not a live model call. Actual Windows execution and native OS Korean IME behavior were not tested; composition-event guards were tested in Electron on Mac.
- Package's 204 source/bundle/license files matched the checkout; installed ASAR SHA-256 matches the package. See `copilot-composer-package.json`.
- `/Applications/Dynote.app` was replaced after normal quit, with old installation retained under `output/installed-before-composer-20261020/Dynote.app`.
- Installed UI opens the same vault and saved document, reconnects the existing account, shows Agent and Auto below input, and shows the new keyboard hint. Unsent prompt restored without sending it. User documents were not edited by this verification.

## REA investigation: live center-editor edits

Observed installed VS Code 1.142.0 UI: context above prompt, Agent and Auto model controls below it. No request was sent in the user's VS Code workspace.

A focused REA investigation of the installed workbench found the static flow:

`textEditGroup → unseen batches → per-document queue → modifiedModel.pushEditOperations → checkpoint → Keep/Undo`

Keep copies the edited text to the baseline; Undo restores baseline text. This code applies edits before Keep. User changes have separate rebasing logic; pending-stream autosave is suppressed, while final edits may save before Keep. These are static observations, not a runtime guarantee for overlapping typing or cancellation.

Evidence:
- Workbench SHA-256 `74de4ceb93610658c5eb15b64b228d085f25c9c95d6ec8b002f791df7be4614c`.
- REA parent `ev_0367d51b20bed82359192284d63df7980a8af637e8471292c5eccd16c6dc4cd9`.
- REA summary `ev_451410b932ea8e37c50ccb5c613a97e894a6735950ae1d14f4daadde4d9316cd`.
- Six exact declarations (51,941 bytes) extracted from the installed bundle were parsed successfully. External dependencies and dynamic relationships remain outside this focused analysis. No target code was executed or copied into Dynote.
- Full local report and provenance: (`/Users/james_black/work/project/REA/research/vscode-copilot-live-edit-20261020/REPORT.md`).

Dynote feasibility: yes, using a request-scoped original/revision + streamed draft, ordered editor transactions, and Keep/Undo. First implementation should stop further AI writes if the user types or the disk revision changes, preserving both versions. Hold pending drafts out of Git backup until accepted; cancellation/error/shutdown need explicit pending-draft handling. Current SDK note tools return complete proposal arguments; progressive provider edit events or a bounded edit stream must be investigated/tested before claiming token-by-token edits. Replaying a finished answer would not implement actual live editing.

**Live document mutation is not enabled by this change.** User requested investigation for this item; current reviewed apply workflow remains active.
