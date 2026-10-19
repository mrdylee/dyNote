# Dynote v0.3.0 release review

2026-10-19 · reviewed published baseline `c60bc7b` through graph implementation `3a61d7e`, then applied the corrections below. The requested `review-work` command was unavailable; this was a direct local code review following the requesting-code-review workflow, without review agents.

## Findings and corrections

| Finding | Correction and evidence |
|---|---|
| A zero-result graph filter still scheduled about 152 simulation ticks and replaced the empty-state message. | Dispose the previous kernel and leave the empty graph idle. A regression failed before the change and passed afterward; the Electron harness checks the message and absence of frames. |
| A node dragged during asynchronous WASM startup lost its pin. | Retain the latest pending pin per node, remove it on release, and apply it when the current kernel is installed. A failing regression covers movement and release before startup. Epoch changes clear old pins. |
| A fresh checkout lacked ignored `src/generated/graph.wasm` when starting the development server directly. | Add `predev` to compile it. A temporary tree containing tracked source files and a dependency symlink starts the server and serves the Worker successfully without a pre-existing WASM file. |
| Bases repeatedly scanned every note for every resolved link/backlink, exceeding its 1.8-second Worker budget on a large simple vault. | Build one path/alias index and incoming-link map. A 10,000-note diagnostic with one link per note, three columns and a backlink formula fell from 9,827 ms to 111 ms on this Mac (Node 25.9.0, single runs; not a general latency guarantee). Regression coverage retains alias, relative-link, duplicate-link and ambiguous-name behavior. |
| An object-valued Canvas file-card `subpath` passed validation and could reach a React text child. | Validate this optional display value as a string. The regression failed before the fix; the app now shows an error and preserves the malformed file. |
| AssemblyScript is a build dependency removed by packaging, while its compiled standard library/runtime is included in the graph WASM. | Retain its LICENSE and NOTICE under `licenses/assemblyscript/` and add graph dependencies to THIRD_PARTY_NOTICES.md. |

## Verification

- 70 automated tests passed; production build passed. The existing large-JavaScript-chunk advisory remains.
- Full dependency audit reported zero known advisories at review time. This is not a complete security audit.
- The Electron harness covers graph loading through `notes://app`, idle behavior, filters, local directions, drag/click, zoom/pan, repeated mount/unmount, changed links, Bases property persistence and Canvas persistence/error handling. It uses synthetic temporary vaults only.
- Final successful runs: [1,000 notes from the checkout](verification/release-runtime-1000.json) and [10,000 notes in the final macOS package](verification/release-runtime-mac-10000.json). Both ended with zero captured errors and all seven created Workers terminated. The large Base evaluates the full corpus while displaying 25 rows.
- The final 10,000-note packaged run reached its first partial graph render in 362 ms; render submission callback p95 was 2.9 ms. This excludes initial vault loading and is not GPU/presentation FPS. Explicit whole-vault refresh after a note edit took about 2.15 seconds.
- Harness corrections count unique terminated Workers (Bases may call terminate again during cleanup) and exclude unrelated physical pointer activity from the synthetic test window. Early packaged attempts were interrupted by hover/navigation during supposedly idle scripted checks; the isolated final run passed. The application's normal input behavior is unchanged.
- Package and ZIP integrity results: [release-package report](verification/dynote-v0.3.0-release-package.json). Runtime reports are linked from that report.
- Source/package comparison excludes platform-specific Electron runtime modifications; Windows runtime support files are checked separately against the official cached distribution.

## Limits

macOS native execution is tested. Windows x64 is cross-packaged on macOS and has no native Windows execution claim. Packages have no distribution signing, macOS notarization, installer or automatic updater.

The graph is independently implemented, with measured bounded workloads; complete Obsidian performance/feature equivalence is not established. Whole-vault refresh still reads the full folder, and large tables are not virtualized. Canvas/Bases support the subset in [CANVAS-BASES.md](CANVAS-BASES.md). Live Preview, mobile, Obsidian Sync/Publish and existing Obsidian plugin compatibility remain outside this release.

Earlier preview hashes in `VERIFICATION.md` and `dynote-v0.3.0-package.json` identify the pre-graph Canvas/Bases build, not the final release files.
