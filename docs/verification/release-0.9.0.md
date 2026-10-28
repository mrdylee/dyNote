# v0.9.0 release verification

- Scope: native development planner, image extraction with the existing Copilot SDK, brainstorming adoption/deferral, explicit note evidence and synthetic ubCode evaluation. See [review findings](development-planner.md) and [ubCode limits](ubcode-planner.md).
- Fresh suite: **228 passed, 0 failed, 0 skipped**. Both packaging commands and production builds passed. Existing large-bundle warnings remain.
- Mac arm64 and Windows x64 archives: **254 source/build/license files per platform** byte-match the workspace. Correct platform Copilot runtime and graph WASM are present. Development sources, tests, docs, output, examples and local HANDOFF.md are excluded. [Machine-readable package receipt](dynote-v0.9.0-release-package.json).
- Actual packaged Mac planner: all **10 grouped checks** passed, including clipboard import, editable extraction, selected registration, duplicate preservation, adopt/defer, manual tasks/dates, real drag+undo, restart, save conflict retaining draft/external bytes, changed evidence, document navigation, real vault isolation and compact layout. No renderer errors. Local evidence: `output/playwright/planner-packaged/runtime.json` and screenshots.
- Separate actual Copilot `gpt-6.1-sol` probe recognized the synthetic image dates, left the absent year undated and generated brainstorming alternatives. Local evidence: `output/playwright/planner/live-vision.json`. This does not establish general screenshot accuracy.
- Packaged Mac original-plugin regression: **11 checks** passed, covering Recent Files/Calendar import/load, original settings/history, commands, existing/create document navigation, lifecycle, restart, vault separation, rejected unsupported imports/actions and original program byte preservation. Local evidence: `output/playwright/release-0.9.0-original-plugins/runtime.json`.
- Packaged Mac graph drag: all **6 checks** passed, including stationary hold, pointer tracking, release, stopping and cancel/lost-capture handling. Local evidence: `output/playwright/graph-drag-packaged.json`.
- Both final ZIPs passed full CRC checks. `SHA256SUMS.txt` was generated from the final archive bytes. macOS Info.plist reports version 0.9.0. No personal notes, credentials, imported original-plugin programs or downloaded ubCode binary are bundled.
- Windows was cross-packaged and inspected on macOS; actual Windows runtime/startup remains unverified. Distribution remains unsigned and unnotarized. No automatic updater/installer was added.
- Public release identity, upload sizes and downloaded asset verification are recorded after publication under local ignored `release/v0.9.0/published-verification.json`.

| Archive | Bytes | SHA-256 |
| --- | ---: | --- |
| Dynote-0.9.0-macos-arm64.zip | 276408112 | aa39145c3f5aa6f4f6913d979bc46e5561fe41ed3b48dd2c1d0835ae331f5b74 |
| Dynote-0.9.0-windows-x64.zip | 367465769 | 6ec18d76fd543793d3e89377713af8c029a2d333c7fb0b372039f19efe888923 |
