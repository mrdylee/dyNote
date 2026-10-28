# v0.8.0 release verification

- Scope: original Recent Files 1.7.10 and Calendar 1.5.10 isolated host, plus a MessageCircle icon for the AI chat opener. Live Preview retains Sparkles. All prior v0.7.0 native features remain included; no full-plugin compatibility claim.
- Fresh automatic suite: **218 passed, 0 failed, 0 skipped**. Both package commands and their production builds passed. Existing large-bundle warnings remain.
- Mac arm64 and Windows x64 archives: **253 source/build/license files** byte-match the workspace. Correct platform Copilot runtime and graph WASM are present; development sources/tests/docs/output and local HANDOFF.md are absent. Machine-readable receipt: [dynote-v0.8.0-release-package.json](dynote-v0.8.0-release-package.json).
- Both distribution ZIPs passed full ZIP CRC checks. SHA256SUMS.txt was generated from the final ZIP bytes. Package inventory contains no imported original-plugin program directories.
- Actual packaged Mac runtime: all 11 original-plugin checks passed, covering import/load, original settings, recent history, original commands and note links, Calendar existing/create paths, lifecycle, restart, vault isolation, rejected unsupported imports/actions, and original program byte preservation. Evidence: local ignored `output/playwright/release-0.8.0-original-plugins/runtime.json`.
- Actual packaged Mac toolbar: chat opener renders MessageCircle, Live Preview retains Sparkles, chat click restores the AI panel, and Live Preview opens the editor. Evidence: local ignored `output/playwright/release-0.8.0-toolbar.json` and screenshot.
- Packaged Mac graph hold/release/cancel/lost-capture regression passed. Evidence: local ignored `output/playwright/graph-drag-packaged.json`.
- Mac Info.plist reports version 0.8.0 and retains the microphone usage description. No new physical microphone or OS-consent validation was performed.
- Only synthetic temporary vaults/profiles were used. Original third-party plugin programs, private notes, private plugin data.json/settings and credentials are not bundled.
- Windows was cross-packaged and inspected on macOS. Windows runtime/startup latency remains unverified. Distribution remains unsigned and unnotarized; no automatic installer or auto-update was added.
- Public release identity, ZIP hashes and upload verification are recorded after publication under local ignored `release/v0.8.0/`.
