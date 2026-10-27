# v0.7.0 release verification

- User authorized Git push and release. New features require a minor version bump from0.6.3 to0.7.0; keep prerelease status and incomplete-portfolio/Windows caveats.
- Fresh automatic suite:210 passed,0failed,0skipped. Both packaging builds passed. Existing large-bundle warning remains.
- Mac arm64 and Windows x64 packages:217 source/bundle/license files byte-match current workspace; correct platform Copilot runtimes and graph WASM present; development sources/tests/research/output and local HANDOFF.md absent. Machine-readable receipt: dynote-v0.7.0-release-package.json.
- Actual packaged Mac runtime: PDF text highlight/save/reopen/comment/color/delete/stale refusal/recovery; Composer selection/heading extraction/merge/readonly hover/stale refusal/recovery; basic/rich mindmap edit/undo/drag/conversion/preservation; graph hold/release/cancel/lost-capture all passed. Temporary synthetic vaults only. Receipts under local ignored output/playwright with packaged=true.
- Mac Info.plist version0.7.0 and microphone usage description confirmed. Physical microphone consent unverified; prior audio-flow tests used a synthetic source.
- Windows package creation and byte inspection are not Windows runtime evidence. Startup delay and Windows interaction remain unverified. Distribution unsigned/unnotarized.
- No original plugin program or personal-vault documents/settings/credentials included. Complete advanced-plugin parity is not asserted; see native-plugin-support.md and RELEASE-NOTES-0.7.0.md.
