# Graph quality regression review — 2026-10-20

## Reproduction and fixes

Compared packaged v0.5.0 and v0.6.0 sequentially using identical generated Markdown, forces, viewport, and a fixed 1000×700 CSS-pixel canvas. Temporary isolated vaults and profiles only. Both 1,000 and 10,000 node fixtures (two outgoing edges per node) produced identical final Float32 coordinates and stopped rendering when settled.

At approximately 40% zoom v0.5.0 displayed labels, while v0.6.0 hid them. The new logarithmic fade had changed the default threshold from 0.28 to 0.5. Restored the previous linear opacity curve with a threshold multiplier. A regression test now checks default readability, slider direction, and migration of positive legacy label settings.

The v0.6.0 edge mesh submitted arrowhead triangles even with arrows disabled. An instrumented WebGL runtime check failed with 18 indices instead of 12 for two edges. Mesh geometry now uses four vertices/six indices without arrows, seven/nine with arrows; arrow geometry arithmetic and temporary per-edge arrays are avoided when disabled. Toggling arrows rebuilds only the edge mesh. Physics, node positions, camera, replay and group colors are retained.

## Review and verification

- 153 unit tests passed; production build succeeded (existing large bundle warning).
- Actual Electron controls check passed, including 12 → 36 → 24 GPU indices for the fixture's 2/4/4 edges, arrow canvas change, no physics reset, replay cessation, remount/reload, and reset.
- 10,000-node comparison across v0.5.0, v0.6.0 and corrected development Electron: identical settled coordinates; render callback p95 3.0/3.0/2.9 ms; scripted input-to-render p95 15.1/15.7/15.7 ms. See graph-quality-10000.json.
- Inspected the rendered screenshot to confirm labels return at intermediate zoom.
- Reviewed edge stride offsets, index allocation, toggle resource destruction, empty graphs, graph replacement, and unmount cleanup. No additional blocking findings.

Measurements are single runs, exclude GPU completion and OS presentation/input latency, and do not establish Obsidian parity or Windows performance. Dense synthetic screenshots measure regression, not semantic community-layout quality. Test runner: `DYNOTE_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/compare-graph-quality.mjs 10000`; optional DYNOTE_COMPARE_VERSIONS is a comma-separated list of packaged release versions or `current`.

Final macOS v0.6.1 packaged controls verification passed with no errors. The packaged 1,000-node comparison against v0.5.0 also preserved exact coordinates (152 frames) and returned render callback p95 0.5 ms versus 0.9 ms for the baseline in that run. Both platform archives matched all 205 source/bundle files and retained the unchanged graph WASM hash; Windows execution remains untested.
