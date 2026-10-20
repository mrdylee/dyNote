# Remove Dynote Codex integration — 2026-10-20

Removed the provider selector, Codex controller/RPC implementation, preload and
main-process IPC endpoints, Codex-only tests/probes and active usage guide.
Copilot is now the sole panel service. Existing saved provider preferences are
ignored, while the Copilot model preference remains in use. Historical design
and verification records describe earlier builds.

Verification:

- `npm test`: 139 passed. The new preload test first reproduced the exposed
  Codex API, then passed after removal while checking Copilot/document dispatch.
- Mac build/package passed; existing bundle-size warning remains.
- Packaged Copilot runtime regression passed: connection/runtime startup,
  streaming, selection-only edits, CRLF/undo, cancel and disk conflicts.
- Packaged Agent regression passed: a persisted `codex` preference survives a
  cold restart but opens Copilot; no service selector or Codex renderer API is
  present. Attachments, new notes, reviewed edits, undo and conflicts passed.
- Package verification matched 204 source/bundle/license files and confirmed
  Codex runtime modules and IPC code are absent. See `copilot-only-package.json`.

Installed the verified Mac build at `/Applications/Dynote.app`; the previous app
is retained in `output/installed-before-copilot-only-20261020/`. Native UI
inspection after restart confirmed the Copilot account/model, Agent mode,
saved document and removal of the provider selector. Restored the unsent prompt.
Installed ASAR SHA256:
`3db730ea55d111b6c240f0047239df40c4a2da271287695272a51a882aef5eb4`.

This removes the integration from Dynote. No external Codex installation or
account credentials were modified. The build is unpublished; Windows execution
was not tested.
