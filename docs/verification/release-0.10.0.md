# v0.10.0 release verification

Scope: embedded ESS LINK viewer, transparent background, persistent container/device note connections and review fixes. Existing v0.9.0 planner and v0.8.0 restricted original-plugin host are retained. [Feature review](ess-3d.md) · [Usage](../ESS-3D.md).

- Final `npm test`: **233 passed, zero failed/skipped**. Both desktop packaging commands and their production builds exited successfully. The existing large-bundle warning remains.
- Mac arm64 and Windows x64 packages: **264 source/build/license files per platform** byte-match the workspace. The GLB, frame entry and Three.js license are required. Correct platform Copilot runtimes and graph WASM are present. Development sources, duplicate `public/`, tests, docs, output, examples and local HANDOFF.md are excluded. [Package receipt](dynote-v0.10.0-release-package.json).
- GLB is **20,885,064 bytes**, SHA-256 `13d9bd94e5426a452ca49e3f2a4033f989e662e911d4cfe92a583a2e1e1ccbf2`; matches the original ESS project exactly. Original Unity/Blender projects are untouched and are not bundled.
- Actual packaged Mac `scripts/verify-ess.mjs`: **15 grouped checks passed**, including transparent CSS/WebGL clear alpha, six containers, rendered rotate/zoom/doors, vents, real marker and physical mesh note navigation, all device types, link/unlink/restart/rename, conflict preservation, malformed-message rejection, model-load failure/retry, WebGL loss/recovery, frame lifecycle, compact layout and live vault separation. Zero renderer errors or remote renderer requests. Local receipt/screenshots: `output/playwright/ess-packaged/`.
- Actual packaged Mac planner: **10 grouped checks passed** (`output/playwright/ess-planner-packaged/runtime.json`). Original Recent Files/Calendar host: **11 checks passed** (`output/playwright/ess-plugins-packaged/runtime.json`). Graph drag: **6 checks passed** (`output/playwright/graph-drag-packaged.json`). Zero renderer errors.
- Both final ZIPs passed full CRC verification. Checksums below and `SHA256SUMS.txt` were generated from the final archive bytes. macOS Info.plist reports 0.10.0. No personal notes, profiles, credentials or original-plugin program downloads are bundled.
- Windows is cross-packaged and inspected on macOS; actual Windows runtime/startup is **unverified**. Packages are unsigned/unnotarized; no installer or automatic updater was added. Diagnostics remain simulations and no equipment writes are introduced.
- Remote tag/release identity, upload sizes and downloaded asset verification are recorded after publication under ignored `release/v0.10.0/published-verification.json`.

| Archive | Bytes | SHA-256 |
| --- | ---: | --- |
| Dynote-0.10.0-macos-arm64.zip | 291846879 | 4b4e86e768b4bbd1c21cbe26b886115c436998d7a087328a4757ef58c58a9256 |
| Dynote-0.10.0-windows-x64.zip | 380633931 | 5f3eee89ab0dcd355f01c7e6dda8063638a66d14b454d8cdfd537a2c4c137047 |

## Publication confirmation

Published prerelease [v0.10.0](https://github.com/mrdylee/dyNote/releases/tag/v0.10.0), release ID `426829457`, at **2026-10-29 00:14:58 Asia/Seoul**. The immutable annotated tag resolves to `b022317ddf3d8f7199652a72d6069d057ae34f21`. All three public asset sizes and API digests match; every complete public asset was downloaded and SHA-256 verified, including the 192-byte checksum file. The update-information feed identifies v0.10.0 for users including prereleases. No browser security settings were changed for upload.

Additional packaged Mac audit checks confirm actual right-button canvas pan, readable startup failure when WebGL is unavailable, and successful retry after graphics availability returns. Local receipt: `output/playwright/ess-packaged/extra-runtime.json`. The follow-up commit records only documentation completion; the published binaries and immutable release tag remain those verified above.
