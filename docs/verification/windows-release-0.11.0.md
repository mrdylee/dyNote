# Windows v0.11.0 publication verification

Published 2026-10-30 01:19:43 UTC as a prerelease:
https://github.com/mrdylee/dyNote/releases/tag/v0.11.0

## Windows runner

Run: https://github.com/mrdylee/dyNote/actions/runs/40984799406

- Windows-hosted Node24, locked dependencies, production build and Windows x64 packaging: pass.
- Unit suite: 275 total; 273 passed, 0 failed, 2 skipped. The two permission rollback tests explicitly skip Windows because Unix chmod semantics do not apply.
- Packaged `Dynote.exe` started and created a native window titled `Dynote`; isolated temporary profile, no personal notes or credentials. It then closed normally.
- Windows Copilot executable present. ZIP folder root is `Dynote-win32-x64/` with all resources and DLLs.
- This is a native launch smoke test, not full Windows UI interaction or real Copilot inference.

The first Windows run stopped before packaging on three test-only POSIX path assertions. Main commit `8f90a5d55c500ffcb9fe1d23c2f6d0c65b8020bf` changes only `tests/security.test.mjs` relative to immutable product tag `v0.11.0` (`ae3f292ff6712dd1d0119897be3f8bbd2a9d4281`). Six expected paths now use host path resolution; security rejection checks remain intact. The successful workflow verifies this exact one-file difference before testing and packaging. No product code change was needed.

## Exact public download

| Asset | Bytes | SHA256 |
| --- | ---: | --- |
| Dynote-0.11.0-windows-x64.zip | 326565472 | cc53987df8c4a14c38a9588ebae1d191a5fcd36bcf0debb87dabffe4f1813991 |
| SHA256SUMS-windows-x64.txt | 97 | fceed21685dd90e84732848cff8d721ffcf302eaf803e4193dc6785cc9adc553 |

The files were downloaded from the public release. ZIP digest matches GitHub's API digest and the published checksum. All 252 ZIP entries pass CRC checks; the Windows application and Copilot executable are present. HANDOFF, Git metadata and development sources are excluded.

Public ASAR SHA256: `23ed98af4e57e3a7b8567c163a4648cd0a2ed4a49e0e0377ff0fccb731f1f7f2`.

- 55 tagged source/license files match after Windows CRLF normalization.
- All 213 production build files match the locally verified Mac build. Three HTML files differ only by carriage returns; the remaining 210 match byte for byte.
- WASM matches `9ef72a4d3c5ce1d3b772bcd7f4b02dded8ebb170bbcff10742c4ae5885fd653e`; bundled ESS model bytes match.

The earlier macOS-cross-packaged Windows ZIP/checksum in `release-0.11.0.md` is a local validation artifact and was not published. The native Windows artifact above is the public download.

## Follow-up

Post-publication observation completed with seven read-only sweeps. Final fresh sweep: 2026-10-30 01:50:15 UTC, 30 minutes 32 seconds after publication. The two asset identities/sizes/digests, public prerelease state, publishing workflow success and annotated tag remained unchanged. All-state issue updates, issue/PR conversation comments and PR review comments since publication each remained zero. Each feed fit one complete page on every sweep; zero findings and no API coverage gaps were reported. Mac publication and installed-app replacement remain pending; the user's existing app and profile have not been changed.
