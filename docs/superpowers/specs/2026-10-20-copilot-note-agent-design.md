# Copilot note agent

User authorized implementation on 2026-10-20: inspect VS Code Copilot with REA, enrich the right panel, and let it write the center document.

## Evidence and scope

Installed VS Code 1.142.0 / Copilot Chat 0.70.0 shows Agent/Ask, current-file context, attachment selection and model selection. REA receipt `ev_e3ffafb46952f78b99123d5cfaa2a145c45e28524e68bc50fdd27398f21981ef` has partial coverage: the large extension bundle exceeded its worker heap. Bounded static inspection separately found editor snapshots, references, structured edits, search tools and undo feedback. Local evidence: `../../../../research/vscode-copilot-20261020/REPORT.md`. Implement independently; do not copy the extension.

## Behavior

Copilot gains a document Agent mode alongside existing Ask and replacement modes. It sees the current editor snapshot (including unsaved text), or only the selected text when that scope is selected. Up to five explicitly attached Markdown notes can provide additional context. Optional vault search/read access is off by default.

Four bounded custom tools read notes, search permitted notes, draft an existing-note change (replace/append/prepend), and draft a new Markdown note. No shell, arbitrary disk access, built-in tools or plugins. Tool results are reference data; writing tools only stage proposals. Each request has bounded reads, calls and draft sizes. Cancellation prevents further proposals.

The panel shows progress and multiple proposals. A user reviews before/after, then applies or discards. Existing-note changes retain exact original-content and disk revision checks. Selected-text proposals cannot expand their scope. New notes use exclusive atomic creation and cannot overwrite files. Current editor changes enter normal undo history. Opening a different note in Agent mode preserves the conversation and proposals. Each new turn re-captures current context.

Assistant replies render safe Markdown without HTML or remote images. Codex retains its existing Ask/edit scope. Terminal commands, VS Code extensions, web browsing, autonomous writes, persistent sessions and full agent parity are outside this change.

## Verification

Test access boundaries, stale proposals, CRLF preservation, cancellation, request budgets, create collisions, and native SDK custom-tool dispatch. Exercise the actual Electron application with a temporary vault, including apply/undo, attachments, file switching and external conflicts. Build/install on this Mac and inspect its panel. Account-backed inference is reported separately from deterministic transport tests.
