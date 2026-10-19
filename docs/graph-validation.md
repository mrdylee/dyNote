# Graph engine implementation and validation

2026-10-19 · Dynote 0.3.0. Final release fixes and checks: [release review](RELEASE-REVIEW-0.3.0.md).

## Delivered behavior

The fixed spiral SVG has been replaced with an independently written AssemblyScript/WASM force simulation in a Worker and a PixiJS 8.22 WebGL renderer. The original Obsidian binary, WASM and extracted source are **not** product dependencies or distribution assets.

- White background; node click opens the note; dragging pins a node until release; background pan, cursor-centered wheel zoom, keyboard pan/zoom and fit.
- Path/tag filters, local depth 1–4, incoming/outgoing direction selection, and neighbor-to-neighbor edges. Local BFS operates before path/tag filtering; disabling neighbor links retains edges traversed between consecutive BFS levels. This is our specified behavior, not a claim of exact deep-local Obsidian semantics.
- Four force controls (center, repulsion, link strength/distance), node size, line width, label density, and reset. Settings use `dynote:graph:<vaultId>`. A searchable note picker provides keyboard navigation; it shows up to 50 matching choices.
- Linear-time graph indexing and link lookup; unchanged note parsing is reused. Rename, alias changes and vault changes re-resolve relationships against a fresh index.
- Two recyclable frame buffers, epoch isolation, cooling, visibility pause/resume and teardown. Coordinates stay outside React state. Nodes are created in batches of 300; labels are culled, fade with zoom, prioritize selection/hover and are bounded at 150. Edges crossing the viewport remain visible even with both endpoints outside.
- Pixi's event/scheduler listeners are disabled for this manually managed scene. Scene resources are explicitly destroyed; no global ticker is stopped. An Electron runtime test verifies that settled graphs produce neither Worker frames nor GPU render callbacks.

## Checks

- `npm test`: **70 passed, 0 failed** after release review. Added tests cover indexed Unicode/alias resolution, parse reuse, directed local selection, camera transforms, crossing-edge culling, pinning, short/long springs, overlaps, finite coordinates, malformed kernel inputs, bounded frames, cooling, stale async initialization, early drag pin preservation, empty filters and bundled-WASM path security.
- `npm run build`: succeeds, produces a local Worker and `graph-*.wasm`. Existing large-chunk warning remains.
- Real Electron `notes://app/index.html`: 1,000 and 10,000 synthetic notes, 2 outgoing links each. Click, drag with stable pinned coordinates, drag release without navigation, keyboard picker, directional local counts, repeated mount/unmount, and idle checks passed without captured console/page errors. Each test created and terminated four Workers. Additional demo-vault checks passed for tag filtering, persisted settings, default reset and a switch to a second vault with separate settings. Wheel/button zoom and background pan passed in the final 10,000-note harness.
- One edited synthetic note plus explicit refresh changes the edge count as expected. The durable harness generates its own temporary vault and does not edit a user's notes.
- The test corpus's immediate neighborhood of note 44 is 13/43/44/45/75, matching the observed original application's five-node local view.
- Actual macOS packaged app passed the same 1,000-note runtime flow. Windows x64 was packaged and its archive inspected; **native Windows execution is unverified**.

CSP only adds `'wasm-unsafe-eval'`; it does not enable general JavaScript eval or external resources. `pixi.js/unsafe-eval` is Pixi's static-function CSP polyfill (confirmed in the installed 8.22 source despite its name). Bundled `.wasm` is served as `application/wasm`; the vault protocol remains image-only. Build assets are emitted as files, avoiding inline font URLs rejected by the existing `font-src 'self'` rule.

## Compute measurements

Apple M4 Pro, Node 22.22.2. Each kernel case: 10 warmup + 30 measured steps, 3 repetitions (90 samples). Same spiral coordinates and link offsets as the previous research baseline. Independent force/collision semantics and tuning mean these are **not numerically identical simulations or proof of equivalent layout quality**. Raw results: [graph-kernel-benchmark.json](graph-kernel-benchmark.json).

| Nodes / edges | Dynote median / p95 ms | Earlier original WASM median ms |
|---|---:|---:|
| 1,000 / 2,000 | 0.572 / 0.651 | 0.484 |
| 1,000 / 8,000 | 0.587 / 0.696 | 0.561 |
| 5,000 / 10,000 | 2.572 / 2.735 | 3.520 |
| 5,000 / 40,000 | 2.684 / 2.856 | 4.048 |
| 10,000 / 20,000 | 4.891 / 5.137 | 7.013 |
| 10,000 / 80,000 | 5.146 / 5.282 | 7.922 |

All six spiral cases meet the internal timing target of <=1.5x that earlier baseline. Additional 10,000-node clustered/hub/isolated cases had median 6.008/4.598/4.542 ms and finite coordinates. WASM linear memory was 1–2 MiB. Tests also run overlapping/hub/isolated inputs for 300 steps. A pathological dense leaf can still require pairwise work; this is not a worst-case time guarantee.

Knowledge construction (`scripts/benchmark-knowledge.mjs`, one run per size, not a statistical UI benchmark): 1,000 notes initial 40.2 ms / one-note edit 3.2 ms; 5,000 initial 91.9 ms / edit 12.9 ms. Earlier diagnostic measurements were approximately 201/183 ms and 3,952/3,873 ms respectively.

## Real app measurements and their limits

The runtime harness instruments actual WebGL draw callbacks and Worker delivery in a 1420×940 Electron window. Raw reports are saved alongside this document. These are single-run diagnostics, not a matched original/Dynote performance contest. Probe overhead, text/layout and test-driver latency affect results.

- The final 10,000-note run: first partial GPU render after graph request 323.1 ms, first Worker frame 336.5 ms; render callback p95 3.4 ms; synthetic keyboard dispatch-to-render callback p95 21 ms; renderer JS heap about 115 MB. These figures exclude vault startup/indexing before requesting the graph.
- Packaged macOS 1,000-note run: first render 445.6 ms, render callback p95 2.0 ms, synthetic input-to-render callback p95 9.8 ms. See [graph-runtime-mac-packaged.json](graph-runtime-mac-packaged.json).
- One-note file edit + explicit whole-vault refresh took 302.3 ms at 1,000 notes and 2,054.3 ms at 10,000 in the runtime harness, including test-driver polling and full disk snapshot/UI work. This is separate from cached relationship construction; full refresh remains a larger cost. See [1,000-note report](graph-runtime-1000.json) and [10,000-note report](graph-runtime-10000.json).
- Render callback time is CPU-side submission, **not presentation FPS or GPU completion time**. Synthetic input timing excludes hardware/OS input latency. JS heap excludes Worker, GPU and total process memory. Initial rendering is progressive.
- Native minimize-to-visibility propagation could not be established: the automated macOS window remained `isMinimized() === false`. The Worker pause/resume protocol is unit tested; a separate programmatic visibility-event check exercises the renderer callback.
- Matched original app presentation FPS/p95, OS input latency, full-process memory, long-duration memory/CPU profiling, and native Windows runtime remain unmeasured. Therefore this work does **not** claim overall Obsidian performance parity.

## Reproduction and local packages

```sh
npm ci
npm test
npm run build
node scripts/benchmark-knowledge.mjs
node scripts/benchmark-graph.mjs /tmp/graph-kernel.json
# Requires Playwright with Electron support; no browser installation is required.
# DYNOTE_PLAYWRIGHT_MODULE may point at an existing playwright/index.mjs.
node scripts/verify-graph-runtime.mjs 1000
node scripts/verify-graph-runtime.mjs 10000
# Optional third argument: absolute path to a packaged Electron executable.
```

Runtime artifacts go under ignored `output/playwright/`. Temporary test profiles/vaults are under the system temp directory. The graph engine is rebuilt before tests and builds; generated WASM is ignored by Git.

Historical v0.3.0 verification package locations (current downloads: [v0.4.0](RELEASE-NOTES-0.4.0.md)):

- `release/v0.3.0/Dynote-darwin-arm64/Dynote.app`
- `release/v0.3.0/Dynote-win32-x64/Dynote.exe` (keep the whole containing folder)

Both ASAR archives contain the independently compiled graph WASM and its bundled Worker. Final hashes and source comparisons are recorded in [release package verification](verification/dynote-v0.3.0-release-package.json). No original `graph-simulation.wasm` is included. Distribution signing, notarization and installers remain unavailable.

## Remaining functional differences

Tag/attachment/unresolved-link nodes, orphan visibility toggle, search color groups, direction arrows, creation-time animation, the full Obsidian search language/frontmatter-link semantics, and a local graph pane beside a note are separate follow-up work. Mobile and Sync/Publish remain outside the agreed scope. Live Preview was added separately in v0.4.0; see [its support scope](LIVE-PREVIEW.md).

Implementation references: [Pixi Application API](https://pixijs.com/8.x/guides/components/application), [AssemblyScript compiler options](https://www.assemblyscript.org/compiler.html). Original runtime observations remain in [obsidian-graph-runtime-review.md](obsidian-graph-runtime-review.md).
