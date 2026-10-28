# Dynote v0.10.1 release verification — 2026-10-29

## Scope and result

This prerelease repairs the incomplete macOS bundle signature. It is ad-hoc signed, not Developer ID signed or Apple notarized. Gatekeeper assessment still rejects the extracted app; successful local runtime checks do not establish successful browser-download installation. Windows was cross-packaged, not executed on Windows.

- `npm test`: 233 passed, zero failed/skipped.
- `npm run package:mac` and `npm run package:win`: passed.
- `node scripts/verify-release-package.mjs`: strict deep macOS signature validation passed; 264 source/build/license files match each platform. Both include their platform-specific Copilot runtime. See [package receipt](dynote-v0.10.1-release-package.json).
- Final Mac ZIP created using `ditto -c -k --sequesterRsrc --keepParent`; fresh extraction with `ditto -x -k` into `output/research/mac-0101-roundtrip`.
- Extracted app: `codesign --verify --deep --strict --verbose=2` passed (valid on disk, satisfies designated requirement).
- Extracted app: 10 planner runtime checks passed, including actual clipboard image review/registration, pointer rescheduling, undo, restart persistence, external edit conflicts and vault isolation. Zero renderer errors.
- Extracted app: 15 ESS runtime checks passed, including offline model rendering, transparency, rotation/zoom, part selection and note linking, restart, WebGL recovery and vault isolation. Zero renderer errors or remote requests.
- Both final ZIPs pass full entry CRC validation using Python `ZipFile.testzip()`.
- No quarantine attributes were removed and no system security protections were disabled.

Runtime receipts: `output/playwright/release-0.10.1-planner/runtime.json` and `output/playwright/release-0.10.1-ess/runtime.json` (local ignored evidence).

## Archive checksums

- `Dynote-0.10.1-macos-arm64.zip` — 291849180 bytes; SHA-256 `dbd086991d69388196bfd072f34c3748d9545f7045162ebfd1f815a37c6e7a56`.
- `Dynote-0.10.1-windows-x64.zip` — 380749888 bytes; SHA-256 `aeaa5e24591e043f1e0d1aa5aa4ec31d1d257a14f9a8101330f07bcc247b1e17`.

## Publication boundary

These are local artifact checks. Publication is verified separately after upload by reading the public release API and downloading all three assets to compare their SHA-256 hashes; the local receipt is `release/v0.10.1/published-verification.json`.
