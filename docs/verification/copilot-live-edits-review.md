# Copilot live edits — 2026-10-20

## Evidence and scope

The design follows the installed VS Code REA investigation and the subsequent
synthetic-workspace GUI trial. Their reports are in the parent workspace under
`research/vscode-copilot-live-edit-20261020/REPORT.md` and
`research/vscode-copilot-runtime-20261020/REPORT.md`.

Dynote now previews each completed Agent tool operation before the response
finishes. Repeated operations on a path build on the preceding draft. This is
not token-by-token streaming or full VS Code edit-session parity.

Pending content is a renderer overlay with a vault-keyed local journal, outside
the vault and Git. Keep saves via the existing revision or exclusive-create API.
Undo discards pending content without adding discarded AI text to editor history.
User typing stops AI application; conflicting versions can be saved separately.
The original and AI comparison is a read-only text comparison, not per-hunk diff.

## Local review and fixes

- Preserve the request's original revision on a first-batch disk conflict.
  Using the newly observed disk revision would incorrectly authorize overwriting
  an external change.
- Preserve a first-batch create collision as a recoverable draft rather than
  losing the proposal when the collision check throws again.
- Serialize incoming batches and synchronously lock Keep/Undo/recovery actions.
- Merge only affected saved notes into renderer state; preserve unrelated edits.
- Exclude both streamed updates and their discard from editor undo history.
- Allow pending new notes to open through normal file navigation.
- Keep pending drafts accessible when the right panel closes; guard vault
  switching, reload, move, trash and restore through the existing flush boundary.

## Verification

- `npm test`: 145 passed, 0 failed.
- `npm run package:mac`: succeeded; existing large-chunk warning remains.
- Packaged Electron live-edit script: 13 scenarios passed, no page errors.
  Includes repeated edits before completion, CRLF, Keep/Undo, Stop, selection,
  user typing, tab switch, restart, disk conflicts before/after the first batch,
  create collision, model error, immediate flush, pending-request guard and panel close.
- Existing Agent attachment/safe-Markdown/multiple-document script: 4 checks passed.
- Existing Ask/Edit runtime script: 7 checks passed; native SDK startup succeeded.
- Composer script: 3 checks passed, including Enter, Shift+Enter, simulated IME
  events, sanitized Mermaid and layout at 1050×700.
- Actual Copilot Auto model, synthetic text only: two cumulative edit tool calls
  arrived before `done`, retained a stable proposal ID and preserved original text.
  This model probe writes no vault files.
- Mac package archive matched 204 source/bundle/license files and included the
  native SDK runtime. Installed archive hash and backup location are recorded in
  `copilot-live-edits-package.json`.

Runtime JSON reports are adjacent to this file. The pending-edit screenshot is
`output/playwright/copilot-live-edits.png` in the local checkout.
Tests used disposable profiles/vaults. The actual-model probe used the existing
connected account with only synthetic context.

## Limits

Windows native execution and native Korean IME typing were not verified.
The local journal has a 2 MiB cap and is not a Git backup. Editing overlapping
AI/user changes cancels further AI application instead of automatically rebasing.
No push or GitHub release is part of this change.
