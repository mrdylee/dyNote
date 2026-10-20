# Graph controls review — 2026-10-20

Scope: source since 3fdae4b, graph controls design and plan, installed Obsidian 1.12.7 reference, v0.6.0 packaging.

## Review and corrections

- Reused the existing WASM/worker/Pixi engine; no proprietary code copied. Data changes rebuild topology; group/colors/display changes only redraw. Arrowheads share the existing edge mesh.
- Missing targets cannot become file-open requests. Unsafe URLs/absolute paths/escaping relative paths are omitted; ambiguous names are not invented as missing documents. No note-write operation exists in the graph controls.
- Orphan removal occurs after filtering. Reset clears query, groups, display and forces. The parent keys Graph by vault ID, preserving per-vault storage isolation.
- Review found incorrect fallback animation ordering when timestamps are absent. Added a failing regression case and corrected synthetic-node ranks to follow the earliest connected file.
- Replay cancels on graph replacement and renderer destruction; hidden nodes are excluded from hit testing. Completed animation schedules no further frames. Existing epoch isolation and worker disposal retained.
- Existing graph regression assertions were updated for persisted path filters and inclusion of Canvas/Base file nodes; unrelated Canvas/Bases checks retained.

## Observed validation

- `npm test`: 152 passed, 0 failed after the final replay correction.
- `scripts/verify-graph-controls.mjs`: actual Electron notes://app, zero console/page errors. Verified four toggles, query/orphan interaction, group precedence/reorder, actual canvas pixel change with arrows, all seven sliders, finite replay, no idle draws, appearance changes without physics rebuild, graph remount and renderer reload persistence, reachable bottom controls at 1000×680, full reset, unchanged note bytes.
- `scripts/verify-graph-runtime.mjs 1000`: 1,000 notes plus three structured documents; first worker frame ~166 ms, render callback p95 ~1.4 ms, scripted keyboard-to-render p95 ~7.5 ms in this run. These exclude GPU completion/OS presentation and are not an Obsidian comparison. Verified no idle worker/render activity, empty filter, zoom/wheel/pan/drag/click, local directions, 3 remount cycles, all 7 created workers terminated. Existing Canvas/Bases save checks passed.
- Unit coverage: node types and links, ambiguous/unsafe paths, Unicode/quoted/excluded queries, first matching group, malformed settings/clamps/migration, chronology with/without timestamps.

- Packaged Mac v0.6.0 reran the complete graph controls fixture successfully with zero console/page errors. Both Mac and Windows ASAR contents matched the source/bundle manifest, including matching platform Copilot runtimes. See `dynote-v0.6.0-release-package.json`.

## Limits

No native Windows runtime test on this Mac. No full Obsidian search grammar, same-performance claim, or pixel identity. The current label budget remains bounded at 150; force values keep Dynote's established numeric ranges. This release adds the requested controls rather than replacing the physics engine.
