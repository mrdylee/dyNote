# macOS downloaded-app signature investigation — 2026-10-29

## Reproduction and cause

The user downloaded v0.10.0 through Chrome, extracted it with Archive Utility and received the macOS “Dynote is damaged and can't be opened” alert. The downloaded ZIP SHA-256 is `4b4e86e768b4bbd1c21cbe26b886115c436998d7a087328a4757ef58c58a9256`, exactly matching the published release. The download itself is intact.

Both the downloaded application and the original packaged application fail:

```text
codesign --verify --deep --strict --verbose=2 Dynote.app
code has no resources but signature indicates they must be present
```

The executable retains Electron's linker ad-hoc signature (`Identifier=Electron`, `Info.plist=not bound`, `Sealed Resources=none`). Packaging did not seal the final renamed bundle. Chrome quarantine is present on the downloaded app. Previous byte comparisons, ZIP CRC and direct Electron runtime tests did not validate this trust boundary.

## Correction

The macOS packager now uses `@electron/osx-sign` through `osxSign` to ad-hoc sign the complete bundle and nested binaries from inside out. It does not automatically select a user's certificate or embed a provisioning profile. Hardened runtime remains off, as in the prior linker-signed prerelease; this local ad-hoc correction does not introduce Developer ID distribution signing.

The package verification script now requires `codesign --verify --deep --strict` to pass. It failed on the existing release before the correction and passed on the newly built copy. An optional report destination prevents isolated validation from overwriting prior release receipts.

The runtime harness also ignores clipboard entries exposing no MIME types when snapshotting the clipboard. Such an entry caused the first planner verification attempt to fail before writing the test image; the app itself had launched. The rerun passed all 10 planner checks.

## Observed verification

- Rebuilt into isolated `output/research/mac-signature-fixed/`; original release archives and downloaded app were preserved.
- New bundle: strict deep signature verification passes; identifier is `com.electron.dynote`, Info.plist is bound and sealed resources are present.
- Source/bundle check: 264 files per platform match. The existing Windows package is unchanged and was referenced only for comparison.
- `npm test`: 233 passed, zero failed/skipped.
- Re-signed app: 10 actual macOS planner checks passed with zero renderer errors.
- Delivered app: all 15 ESS viewer checks passed with zero renderer errors or remote requests, including GPU rendering, window/frame restart and vault isolation.
- Delivered a separate local copy under `~/Downloads/Dynote-0.10.0-local-fixed/Dynote.app`; signature verification also passes after copying.
- Opened that local copy through the macOS application API and observed its normal settings/document window, with no damaged-app alert. Its saved user-profile vault path refers to a missing old temporary folder, so the UI requests choosing a vault. No vault path was changed during this investigation.

## Remaining distribution requirement

`spctl --assess --type execute` still rejects the ad-hoc build. **Signature integrity is not Apple notarization or Gatekeeper approval.** No Developer ID Application identity was available locally; an Apple Development identity does not substitute for it. A normal Internet distribution requires Developer ID signing, appropriate hardened-runtime entitlements and notarization. This fix has not replaced the public v0.10.0 assets or established a warning-free browser-download installation.

No quarantine attributes were removed, no global security setting was disabled, and no personal vault was modified by the synthetic runtime checks.

References: [Apple: modified or damaged apps](https://support.apple.com/en-sg/guide/mac-help/mh40619/mac), [Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing).
