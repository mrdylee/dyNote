# Copilot implementation review — 2026-10-20

## Scope

Right-hand Copilot chat using the user's GitHub subscription, runtime model
selection, explicit note/selection context, reviewed edit application and undo.
No publication or change to Git backup timing.

## Checks and fixes

- Full Node suite: **128 passed, 0 failed**, including 15 Copilot tests.
- `npm run build`: passed; existing large-bundle advisory remains.
- Pinned SDK 1.0.23 / runtime 1.0.100: real startup, unauthenticated status,
  provider enumeration, GitHub OAuth authorization URL creation and cancellation
  verified in isolated profiles. The authorization URL was validated without
  completing browser login or collecting any token.
- Packaged macOS arm64 / Electron 44.9.0: actual runtime startup and UI checks
  passed at 1050×700. Chat answers were deterministic test transport responses.
- Selected-context test proves only `selected 원문` is sent from a CRLF document;
  reviewed application and editor undo preserve its original bytes.
- Stale in-memory edits disable application. External disk edits remain intact
  when applying a proposal; the existing revision check reports a conflict.
- Cancellation retains the question. Switching notes clears chat. Remounting the
  editor clears stale selections before another request can be sent.
- Narrow-window toolbar wrapping was fixed; the composer remains visible.
- Verified empty SDK tool exposure, rejected permission requests, disabled
  configuration/skill/hook discovery and exclusion of ambient Git/API tokens.
- Temporary request sessions are deleted after completion/cancellation.
- Cross-platform packaging now installs the target runtime in an isolated
  temporary directory with lifecycle scripts disabled. Executables/native SDK
  libraries are unpacked from app.asar.
- Mac and Windows packages match **203 current source/bundle/license files**.
  Correct native runtime files are present in both. The Windows runtime is a
  PE32+ x86-64 executable; this is an artifact check, not Windows execution.
- `git diff --check`: passed.

## Artifacts and limits

Local output directory: `output/copilot-20261020/`.
The package version remains 0.4.1; these are new, unpublished development builds,
not replacements for the existing GitHub v0.4.1 release.

`copilot-runtime.json` records packaged execution; `copilot-package.json` records
archive hashes and source matches. Screenshots are under `output/playwright/`.

Live GitHub account authorization, actual model responses, account entitlement
and quota behavior require a user-authenticated check. They are **not** proven
by the transport fixture. Native Windows runtime, signing and notarization are
also unverified/not performed. No new release was published.
