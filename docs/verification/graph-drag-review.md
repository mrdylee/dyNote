# Graph drag review — v0.6.3

Reviewed the renderer's pin/release/cancel messages, simulation cooling, async kernel initialization, and actual WASM velocity integration. A stationary drag previously cooled to a stop; release reheated it, and pinned center/link velocities accumulated until release. The fix keeps the simulation active while a node is held, clears pinned velocity each step, and cools normally after release. A drag completed before kernel initialization now applies its final coordinates before releasing. Nodes remain physically free after release; coordinates are not persisted across graph reconstruction or restart.

Regression tests failed before the fix in both the actual WASM and actual Electron UI. Tests cover holding still, release without reheating, multiple pins, asynchronous startup, changed linked-node arrangement, and subsequent force changes proving that released nodes are not permanently pinned. The actual packaged UI also verifies pointer cancellation and capture loss, one release per drag, and no document opening after a drag.

The release review additionally found two delivery/verification issues:

- The UI verifier replaced an IPC handler before application startup was guaranteed to register it, allowing duplicate registration and intermittent startup failure. The verifier now exercises the normal application without replacing that handler.
- A real packaged ASAR included the local `HANDOFF.md`. Packaging now excludes it, and the final package verifier asserts its absence on both platforms. The original local handoff is preserved.

Reference evidence: REA analyzed the Obsidian 1.14.5 update ASAR, SHA-256 `3a349274f789b62c5b35ad19de10311909a94e8783033569c2210a4bac491780`, selecting `app.js` and `sim.js`. The shipped `sim.js` and embedded WASM were also executed with synthetic nodes and controlled timers. They keep physics active during a stationary drag, release without raising alpha, and clear fixed-node velocity. Static semantic coverage was bounded; this does not establish complete application equivalence. The installed Obsidian GUI displayed no graph nodes during this inspection, so no successful original-app GUI drag comparison is claimed.

Release validation on macOS, 2026-10-27:

- `npm test`: 159 passed, no failures or skips.
- Mac ARM64 and Windows x64 packages built with Electron 44.9.0.
- Both ASAR archives match 205 current source/build files; graph WASM hashes match. Required platform Copilot binaries are present and the local handoff is absent. See [package verification](dynote-v0.6.3-release-package.json).
- Actual packaged Mac app: [drag/release/cancel](dynote-v0.6.3-drag-runtime.json), [1,000-note runtime](dynote-v0.6.3-graph-runtime.json), and [graph controls/settings](dynote-v0.6.3-graph-controls.json) passed without renderer errors.
- Both release ZIP files passed CRC integrity checks. Checksums are distributed in `SHA256SUMS.txt`.

Windows runtime, OS input/presentation latency, distribution signing and notarization remain unverified or unavailable. The separate Windows startup-delay report is not resolved by this patch.
