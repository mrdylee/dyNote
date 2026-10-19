# Dynote v0.4.0 release verification

2026-10-19 · prepared from the published v0.3.0 baseline `1f4994d` through Live Preview, its review fixes, installed fonts, and Git backup settings (`5939cc3`). This release step changes version metadata, current usage documentation and packaged-app verification entry points. It does not change the application implementation or connect a personal note repository.

## Scope

- Live Preview phase 1 and reviewed LF/CRLF/BOM persistence and heading navigation.
- Separate installed UI/body/code font choices, sizes and body spacing, persisted per device.
- Note Git repository connection/clone, automatic commit/push with an editable 1–1440 minute interval and a 10-minute default, manual backup and disconnect.
- Existing graph, Canvas and Bases functionality remains included. Its earlier measurements are historical evidence, not fresh performance measurements for this release.

## Verification

- Fresh `npm test`: **99 passed, 0 failed**. Both production packaging commands passed. Vite retains its large-chunk advisory.
- `npm audit --json`: **0 known dependency advisories** at release preparation time; this is not a complete security audit.
- `node scripts/verify-release-package.mjs`: Mac and Windows ASAR files have the same SHA-256; **198 source and built-asset files** match the checkout. Both contain the compiled graph WASM and Worker. Neither contains native Node addons or the original Obsidian graph WASM.
- The Windows executable is PE32+ GUI x86-64. **71 runtime support files** match the cached official Electron 44.9.0 Windows distribution byte-for-byte.
- Final ZIPs pass CRC validation. File sizes and SHA-256 hashes are in [package verification](verification/dynote-v0.4.0-release-package.json) and the downloadable `SHA256SUMS.txt`.
- [Packaged Mac settings runtime](verification/dynote-v0.4.0-settings-runtime.json): Electron 44.9.0, version 0.4.0, Apple Silicon. Enumerated 258 installed font families; checked UI/body/code font application, sizes, spacing and restart persistence. The Git URL starts empty, the default is 10 minutes, and invalid intervals are blocked. A real 1-minute timer uploaded saved Markdown to an isolated local bare repository. The directly entered 17-minute value persisted across restart; offline failure, retry and disconnect passed. No captured page/console errors or renderer HTTP(S) requests.

- [Packaged Mac Live Preview runtime](verification/dynote-v0.4.0-live-preview-runtime.json): formatting, selective syntax reveal, local images, Markdown/wiki navigation, Korean text insertion, checkbox autosave/undo, clipboard/drop imports, exact saved content after restart, and long-document scroll anchoring passed. The synthetic composition lifecycle check is not proof of native OS IME behavior. No captured page/console errors or renderer HTTP(S) requests.

- [Packaged Mac Live Preview review regression](verification/dynote-v0.4.0-live-preview-review.json): all 22 checks passed, including formatted/encoded heading navigation and byte-exact LF, CRLF and BOM+CRLF checkbox changes, undo, new lines and restart. No captured page/console errors or renderer HTTP(S) requests.

## Limits

All runtime checks use synthetic temporary vaults and profiles. The Git test URL is redirected to a local bare repository using isolated Git configuration; it does not establish real GitHub authentication or network availability. Existing Git authentication must be configured separately.

macOS native execution is tested. Windows x64 is cross-packaged on macOS: Windows execution, installed-font enumeration, native Korean IME, and Git authentication/backup on Windows remain untested. Packages are unsigned and have no macOS notarization, installer or automatic updater.

Live Preview supports the subset documented in [LIVE-PREVIEW.md](LIVE-PREVIEW.md). Git backup runs while the app is open; it does not auto-pull, resolve conflicts or overwrite remote history. See [FONTS-GIT.md](FONTS-GIT.md). Mobile, Sync/Publish and existing Obsidian plugin compatibility remain outside this release.

This document records local preparation and verification. GitHub publication and remote tag state must be verified separately.
