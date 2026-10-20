# Copilot document Agent verification — 2026-10-20

## Implemented

Copilot's right panel defaults to Agent document work. It can read the current
unsaved Markdown document or selection, read explicitly attached references,
search/read other vault notes when enabled, and stage existing/new-note changes.
Each proposal is reviewed and applied separately. Existing changes use editor
undo and the save queue's revision protection; new files use exclusive creation.
Progress, formatted answers and searchable attachments are visible in the panel.
Codex keeps its previous Ask/edit capabilities.

## REA and UI basis

Installed VS Code 1.142.0, built-in Copilot Chat 0.70.0 were inspected.
Agent/Ask selection, current-file context and attachment picking were observed
in the UI. REA selected package.json, dist/extension.js and dist/diffWorker.js.
The 19.7 MB main bundle exceeded its 1536 MiB analysis worker heap, so semantic
coverage is partial. Bounded static inspection independently verified editor
snapshots, reference propagation, create/edit contracts and undo feedback.

- Artifact digest: `b8cb717bbfe798ce8aaffd0e3dae35bba61d97f65b7c346eb2d6120a68f32443`
- REA receipt: `ev_e3ffafb46952f78b99123d5cfaa2a145c45e28524e68bc50fdd27398f21981ef`
- Summary: `ev_65e3979a7b96bef0830e7025492ab793850092b2d63304b8590b1de7cdf28ae0`
- Local detailed evidence: `research/vscode-copilot-20261020/REPORT.md`,
  `static-excerpts.json`, `rea-summary.json` under the parent REA workspace.

No VS Code implementation code was copied into Dynote.

## Checks completed

- `npm test`: 151 passing tests. Agent access scopes, selection containment,
  unseen-file edits, path traversal, limits, cancellation and create collisions
  are covered along with the existing regression suite.
- `npm run build`: passed; existing bundle-size warning remains.
- `node scripts/verify-copilot-tools.mjs`: real native SDK offered exactly four
  Dynote tools; native read/edit dispatch passed, no inference/account required.
- `scripts/verify-copilot-agent-live.mjs`: actual connected Copilot Auto model
  read synthetic text and called the edit tool to append a checklist. No vault
  file was sent or written by this probe.
- `scripts/verify-copilot-agent-runtime.mjs`: passed against the packaged Mac
  application with a disposable profile and deterministic model transport.
  Actual note tools, IPC, editor and disk storage were exercised: attachments,
  no writes before review, multiple proposals, note switching, center-editor
  apply, CRLF, selected-text containment, undo, new-note creation, stale typing,
  external-disk conflict and safe Markdown. No renderer exceptions.
- Existing Copilot UI regression passed against development Electron. Existing
  Codex UI regression passed against the new packaged Mac app.
- Package comparison matched 206 source/bundle/license files and included the
  native Copilot runtime. SHA is recorded in `copilot-agent-package.json`.

## Installed result

The verified artifact in `output/note-agent-20261020/` was installed at
`/Applications/Dynote.app`. The previous app was preserved under
`output/installed-before-note-agent-20261020/`. Installed app.asar matches
`31c84565b3cebf8684f2a99b3863420a2fdf6a4335bde49a8fa7c28ee2b394d8`.

After restart, native UI inspection confirmed the same vault and saved notes,
the existing signed-in account and Auto model, Agent mode, reference picker,
and disabled-by-default vault access. The user's unsent question was restored.

This remains an unpublished 0.4.1 development build. Windows was not executed.
The agent is bounded note assistance, not all of VS Code Copilot: it has no
terminal, debugger, arbitrary workspace tools, extension ecosystem or
autonomous file writes. Existing-note edits can be undone in the editor; new
note removal uses the normal vault trash action.
