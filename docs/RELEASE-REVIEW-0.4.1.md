# Dynote v0.4.1 release verification

2026-10-20 · patch release preparation for font-list fix `05c7754`, based on published v0.4.0 (`b5710a9`). This release step updates version metadata and current usage documentation. It does not add VS Code integration or connect a personal note repository.

## Fix and scope

The installed-font input previously used a native autocomplete popup whose lower entries were difficult to reach. The fix uses a searchable, scrollable list for each UI/body/code font setting, with keyboard navigation and the system-default option. Manual font-name entry and stored preferences remain supported.

The application changes are limited to `src/FontSettings.jsx` and its CSS. The runtime harness adds real wheel-to-last-item, keyboard navigation, search and default-reset checks. Live Preview, Git backup, graph, Canvas and Bases behavior is otherwise unchanged. Historical v0.4.0 evidence is retained in its own release documents.

## Verification

- Fresh `npm test`: **99 passed, 0 failed**.
- `npm audit --json`: **0 known dependency advisories** at release preparation time; this is not a complete security audit.

- Mac arm64 and Windows x64 production packages built successfully; Vite retains its large-chunk advisory. Both ASAR archives match each other and **198 source/built files** match the checkout. No native Node addons or original Obsidian graph WASM are included.
- Windows EXE format: PE32+ GUI x86-64. **71 runtime support files** match the cached official Electron 44.9.0 distribution byte-for-byte.
- Both ZIPs pass CRC validation. [Package report](verification/dynote-v0.4.1-release-package.json) records exact file sizes and SHA-256 hashes, also available in downloadable `SHA256SUMS.txt`. The previous v0.4.0 ZIP hashes were rechecked and remain unchanged.

- [Actual packaged macOS runtime](verification/dynote-v0.4.1-settings-runtime.json): version 0.4.1, Electron 44.9.0, Apple Silicon. Enumerated 258 font families and reached the last font by real wheel input, selected it, used End/Home/PageDown, searched by name and reset to the default. UI/body/code choices, sizes, spacing and restart persistence passed. Git defaults to 10 minutes with a blank URL; invalid intervals are blocked; an actual 1-minute automatic upload, directly entered 17-minute persistence, offline failure/retry and disconnect passed. **Zero captured page/console errors and renderer HTTP(S) requests.**

## Limits

All runtime checks use synthetic temporary vaults and profiles. The Git test URL is redirected to a local bare repository using isolated Git configuration; it does not establish real GitHub authentication or network availability. Existing Git authentication must be configured separately.

Windows x64 is cross-packaged on macOS. Windows execution, installed-font enumeration, native Korean IME, and Git authentication/backup on Windows remain untested. Packages are unsigned and have no macOS notarization, installer or automatic updater.

Git backup runs while the app is open; it does not auto-pull, resolve conflicts or overwrite remote history. See [FONTS-GIT.md](FONTS-GIT.md). Dedicated VS Code integration, mobile, Sync/Publish and existing Obsidian plugin compatibility are outside this release.

This document records local preparation and verification. GitHub publication and remote tag state must be verified separately.
