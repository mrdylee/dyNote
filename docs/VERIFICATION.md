# Dynote v0.1 verification

Date: 2026-10-19, Asia/Seoul. Host: Apple Silicon macOS.

The original baseline below was verified under the Open Notes name. The final section records the Dynote rename and refreshed packages; earlier hashes identify the original packages.

## Automated checks

- `npm test`: **21 passed, 0 failed** across knowledge, filesystem, save queue and native-boundary tests.
- `npm run build`: succeeded. The renderer bundle is approximately 923 KB uncompressed / 319 KB gzip. Vite reports a non-failing chunk-size advisory; no remote CDN is required.
- `npm run package:mac`: succeeded with official Electron Packager 20.3.0 / Electron 44.9.0. Output: `release/Open Notes-darwin-arm64/Open Notes.app`.
- `npm audit`: **0 known vulnerabilities**, including development dependencies, after replacing the initially evaluated packaging dependency. This is a point-in-time advisory check, not proof of security.
- `git diff --check`: no whitespace errors in tracked changes; new source was formatted before review.

Meaningful regression cases include stale-revision rejection, simultaneous saves, traversal and hidden-path rejection, symlink exclusion, exclusive creation, binary neighbors left untouched, byte-identical UTF-8 BOM/CRLF recovery copies, Windows device-name rejection, draft retention on failed IO, edits arriving during IO, HTML/image/protocol rejection, aliases inside tables, ambiguous names, Korean search, and consistent backlinks/graph edges.

## Native UI observations

Used the actual Electron window through macOS UI automation, not simulated screenshots or a browser-only mock.

1. Opened the example workspace with eight synthetic documents.
2. Created `검증/한글 저장 시험.md` using the app's new-note dialog.
3. Entered Korean content, an emoji, a wikilink, and `SECURITY-SMOKE-20261019` into CodeMirror. Saved, switched to reading mode, and observed the rendered text/link.
4. Added `AUTOSAVE-VERIFIED-20261019` without a save command. Independently read the resulting file on disk and verified the marker. A copy is retained in `verification/native-ui-note.md`.
5. Searched for `SECURITY-SMOKE`; the app returned one matching document with the expected text.
6. Followed `[[시작하기]]`; the destination opened and showed the test note as an incoming link.
7. Opened the graph; the app displayed document/link counts and graph controls.
8. Quit through the native application menu, then launched the separately packaged `.app`. Its native menu was named Open Notes. The packaged app displayed eight example notes; the previously reproduced table-alias rendering defect was fixed and the table contained active document links in the proper cells.
9. Used the packaged app's native directory picker to open `/tmp/open-notes-ui-vault-20261019`, a dedicated synthetic folder with two Markdown notes and a binary neighbor. The app showed both documents, their link and backlink, and the two-note count.

All edited content was synthetic. No original personal Obsidian vault was connected. Windows/Linux execution, signing/notarization, large-vault performance and crash/power-loss recovery were not validated.

## REA inspection of the deliverable

The packaged ASAR was analyzed statically with REA, selecting `electron/main.mjs`, `electron/preload.cjs`, and `core/security.mjs`.

- Artifact SHA-256: `4ebfb77b50caf02a6536092fe1ac18992a0be9b31cd613c0e4312a35ec6195a0`.
- Retained parent evidence: `ev_adf6fc439eb9cf27fc76976681380db7e35cbf2829bd511d7df9a8726c455f58`.
- Summary evidence: `ev_2dcf68caa86d166b65c5d547347230b0476ab5c2a83399f3bed8d89ffb259992`.
- Observed: one BrowserWindow construction, six explicit web-preference assignments, one context-bridge API and a sender-validation syntax observation; three selected files parsed without failures.
- Coverage remains partial. The loop-registering IPC code includes dynamic channel expressions that REA did not resolve; bundled dependencies and renderer sources were not part of this selected analysis. The observation is not a runtime policy proof or a comparison proving equivalence to Obsidian.

The inspected ASAR contains no verification document or this report because `docs/` is excluded from packaging. Source code, lockfile and these reports remained local at that original inspection stage. The later initial source publication uses the Dynote name; executable packages are not included in Git.

## Windows x64 package

On 2026-10-19, `npm run package:win` completed on macOS and generated `release/Open Notes-win32-x64/Open Notes.exe` with its supporting runtime files. Windows uses the standard native title bar; macOS retains the existing inset title bar.

`file` identified the executable as a PE32+ Windows GUI x86-64 executable. The packaged main/preload/filesystem/security sources and built HTML were compared byte-for-byte against the checkout. Required Electron runtime files were present, and the shared 21-test suite passed on macOS. The package's identity and limitations are recorded in `verification/windows-package.json`.

The Windows deliverable is a ZIP of the complete runtime folder, not an installer or an EXE-only download. See [Windows instructions](WINDOWS.md). Actual Windows execution and code signing remain unverified/not performed, respectively.

## Dynote rename and refreshed packages

On 2026-10-19 the application display name, native menu/window, HTML title, package metadata, fresh demo welcome text and packaging commands were changed to **Dynote**. The internal `Open Notes` user-data path and existing environment override were retained so existing settings and recovery copies remain discoverable. Existing user documents were not rewritten for branding.

- Shared automated tests: **21 passed, 0 failed** after the rename.
- Production build and both `package:mac` and `package:win`: succeeded. The existing bundle-size advisory remains non-fatal.
- Full Dynote dependency audit: **0 known vulnerabilities** at verification time.
- Packaged application source files match the checkout byte-for-byte. Packaged `package.json` matches the official packager's sanitization, which intentionally removes development-only fields.
- On macOS, the actual packaged window, native application menu, HTML content and new synthetic welcome note displayed **Dynote**. This check used an isolated temporary app-data directory with eight synthetic notes.
- Windows `Dynote.exe` is a PE32+ GUI x86-64 executable. The other 71 runtime files match the cached official Electron 44.9.0 Windows distribution byte-for-byte. The 73-file portable ZIP passed its CRC check. Windows execution remains untested, and packages remain unsigned.
- Local deliverables: `release/Dynote-darwin-arm64/Dynote.app`, `release/Dynote-0.1.0-mac-arm64.zip`, and `release/Dynote-0.1.0-windows-x64.zip`. ZIP checksums and source/package verification details are recorded in [dynote-package.json](verification/dynote-package.json).
- The upstream reference suite also passed its existing **116 tests**. This does not resolve the source-level risks or establish feature equivalence; see [the upstream review](UPSTREAM-REVIEW.md).

Initial publication scope is source code, lockfile, tests and documentation in `mrdylee/dyNote`. Release folders, generated ZIPs, dependencies and private note data are excluded from Git. No new image/PDF, Live Preview or Git-sync implementation is claimed by this rename/publication change.
