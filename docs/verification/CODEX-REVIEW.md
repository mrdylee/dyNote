# Codex integration review — 2026-10-20

## Verified

- Node test suite: **141 passed, 0 failed**, including 13 Codex cases.
- Production build and macOS arm64 packaging succeeded.
- Installed native CLI: **0.144.5**. Real startup, isolated account lookup, model
  discovery, ephemeral thread creation, browser authorization URL creation and
  cancellation passed without completing account login.
- Real native runtime was exercised against a local synthetic Responses backend.
  Streaming/completion passed. The effective tool list contains `update_plan`
  and `request_user_input`, with no file, shell, browser, image, connector,
  agent or skill tools. Server execution/approval requests are rejected.
- Initial native probe exposed orchestrator skills despite ordinary feature
  flags. Added explicit orchestrator MCP/skills disable settings, then repeated
  the real protocol probe successfully.
- Local code review found and fixed a login completion race during browser
  opening and account-error credential redaction. Regression tests pass.
- Packaged Electron **44.9.0** on macOS: both Codex and Copilot UI checks passed.
  Provider changes clear dialogue and proposals; model choices stay independent.
  Selection-only requests, CRLF-preserving reviewed apply/undo, cancellation,
  stale buffer rejection and external-disk conflict protection passed.
- Packaged UI had no renderer errors and fit a 1050 × 700 window.
- Mac archive matches **205 source/bundle/license files** and includes the
  existing Copilot native runtime. Codex uses the separately installed CLI.
- `git diff --check` passed.

## Artifacts and limitations

`output/codex-20261020/Dynote-darwin-arm64/Dynote.app` is an unpublished
development build with version metadata **0.4.1**.

Reports: `codex-package.json`, `codex-protocol.json`, `codex-runtime.json`,
and `copilot-runtime.json`. UI screenshots are in `output/playwright/`.

Real account authorization, entitlement/quota behavior and an actual account
model answer remain unverified. UI answers and native protocol answers used
explicit synthetic fixtures. No Windows package was rebuilt or executed for
this change. No GitHub push/release, signing or notarization was performed.

The earlier Copilot build was installed to `/Applications/Dynote.app` and its
real window and existing vault were verified. Replacing it with this Codex build
requires the Mac to be unlocked so the existing app can close normally.
