# Word document release review — 2026-11-08

## Integration

- Published baseline: `v0.20.0` / `f9c3c2d827e2f2b8c2825b829d02c3fa206862b4`.
- Main baseline: `94e10cc6c46bf0445afa89f8e78e1b7b811899cb`.
- Word support: `b36f35a`, archive/index corrections `8bf142c`, native activation refresh `9ccb98e`.
- Both baselines and the Word branch were merged into an isolated release checkout without conflicts. Existing development checkouts were preserved.

## Review and corrections

- Verified Word files use separate read-only routes and never enter Markdown save, move, or attachment write allowlists. Lock files and paths outside the vault are rejected.
- Checked ZIP validation and conversion use the same bounded package entries. Preview sanitization excludes active links and unsafe image formats.
- Checked preview request cancellation and revision-guarded index updates, including refreshing a document whose preview is closed.
- The previous package-verification failure came from a stale duplicate `dist/ess/ess-container 2.glb` in the old generated output. A clean build passed the unchanged release verifier; no file exclusion or weakened check was added.
- Added Word runtime verification to the release scenario runner on both Windows and macOS. Updated release metadata and notes to v0.21.0.

## Fresh local verification

- Original Word branch: 448 tests passed.
- Integrated release: 450 tests passed; dependency audit reported zero vulnerabilities.
- macOS arm64 package built and passed source, bundle, icon, runtime, and signature verification for 298 files.
- Packaged Word runtime test passed listing, Korean text/table/image preview, body search, quick document search, original-path handoff, byte preservation, and index refresh with open and closed previews. The handoff uses a mocked shell opener; focus events in this automated test are emitted explicitly.
- macOS `spctl --assess --type execute` rejected the ad-hoc build. Only an Apple Development identity is available locally; Developer ID distribution signing and notarization are not claimed.
- Release publication is gated by native Windows and macOS CI, package checks, and archive checksums.

## Interoperability boundary

The earlier Windows 11 ARM VMware run used a synthetic SWRS fixture and an isolated profile/vault. It verified native application return and external fixture replacement. Microsoft Word editing/saving and Polarion Round-trip re-upload remain deferred at the user's request. No actual Polarion project or user document was modified.
