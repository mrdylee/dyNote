# Copilot implementation review — 2026-10-20

## Scope

Right-hand Copilot chat using the user's GitHub subscription, runtime model
selection, explicit note/selection context, reviewed edit application and undo.
No publication or change to Git backup timing.

## Follow-up: desktop keychain failure

The installed application reported that the system credential store was
unavailable after GitHub sign-in. SDK 1.0.23's `buildRuntimeEnv()` forcibly adds
`COPILOT_DISABLE_KEYTAR=1` in `empty` mode. Dynote used that mode, then correctly
refused the SDK's plaintext fallback. The earlier startup and OAuth-URL probes
did not exercise credential persistence and therefore missed this defect.

The client now uses the SDK's desktop mode, with the previous restricted
session defaults explicitly set and installed plugins cleared for both login
and chat. No macOS keychain settings were changed; plaintext fallback remains
rejected.

- A regression using the real SDK environment builder failed before the fix
  and passed after it. The full Node suite now passes **142 tests, 0 failures**.
- Native SDK probe with disposable synthetic data: old mode returned
  `storedInKeychain: false`; the fixed mode returned `true` and read back the
  value. Both synthetic entries were deleted. Restricted session creation
  and the plugin-options update also succeeded.
- Mac packaging passed; **205 source/bundle/license files** match the archive.
  Reports: `copilot-keychain.json` and `keychain-fix-package.json`.
- Replaced `/Applications/Dynote.app` with the verified build, preserving the
  previous bundle in `output/installed-before-keychain-fix-20261020/`.
  Vault settings were unchanged; the existing vault opened normally.
- Live installed application completed GitHub sign-in and displayed the
  connected account and model selector. Login completion restarts the SDK
  client before refreshing account/model state. The user then selected a
  model and received a real Copilot answer. No transcript or credentials were
  recorded in these reports.
- A full application restart was not performed after login because the user
  was actively chatting. No Windows execution or new GitHub release is claimed.

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

The initial transport fixture did not prove account authorization or actual
model responses; the keychain follow-up above now confirms both in the
installed Mac app. Entitlement and quota edge cases remain unverified.
Native Windows runtime, signing and notarization are unverified/not performed.
No new release was published.
