# ESS LINK in Dynote

The user approved adding the existing ESS viewer, linking equipment to notes, reviewing/fixing the work and publishing a desktop release. Existing planner and plugin work must remain intact. No further design approval is needed for this scope.

## Chosen approach

Bundle the existing Three.js/TypeScript viewer and its GLB as a separate Vite entry displayed in an application tab. An iframe on the distinct internal `notes://ess` origin keeps its global DOM, styles and rendering lifecycle separate; removing it releases the renderer. Loading only the GLB would lose the existing doors, layout and diagnostics. A Unity Web build would duplicate an already working web implementation.

Copy only the viewer source and public model from `ess_unity_project/ess-web-six` at `86a11015d74e100e90c9e1aa7d4a22bb927b3e50`; preserve the original project. Retain its model attribution and Three.js license. Its simulation labels remain visible. Per the user correction, the scene, alpha canvas and frame backdrop are transparent so the notebook surface shows through. This is a bundled ESS feature, not arbitrary Unity projects or general model import.

## User flow

- Sidebar and command palette open an ESS LINK tab. A note toolbar action opens its first linked target, or the previously selected target if there is no link.
- The tab provides the original six-container overview, rotate/pan/zoom, rack and panel views, paired doors, vents, diagnostic mock data and contactor example.
- A small note panel shows the selected container/device and existing notes. Choose a note and link it, open a linked note, or remove a link. A clicked 3D part with exactly one linked note opens that note. Multiple matches are shown for explicit choice.
- Container IDs 1–6 are included in every link. RACK 01 in different containers is never the same target. Support container, racks, BPUs, LCS, eBSC and the two switches.
- Connections are an `ess_links` YAML list in the linked Markdown note, e.g. `ess-01/rack-01`. Use the existing revision-checked save path, preserve note body and other YAML properties/comments, refuse malformed metadata and external modifications. Links follow note rename/move because they live in the note itself. Only current-vault notes participate.
- Switching to a note keeps a reopenable ESS tab and selected target; closing that tab or changing vault drops viewer state. A fresh iframe is mounted only while viewing 3D, so inactive tabs do not keep rendering.

## Boundaries and errors

Only the exact bundled model asset is allowed through the app protocol. No arbitrary file loading, HTTP service, network access, native bridge in the frame or raw HTML note execution is added. Frame messages validate source, origin, type and target. Parent sends only target IDs, never note contents. Initial loading, failed model load, retry and WebGL/context failure have readable UI. Vault switching and async saves must not leak stale note state.

## Success evidence

1. Unit tests validate container-scoped targets, link addition/removal, malformed YAML refusal, body/property preservation, rename behavior and source/origin/schema validation; protocol tests reject arbitrary model files.
2. Actual isolated Electron runtime loads the GLB without remote requests; verifies six containers, rotations/zoom, doors/vents, target selection, persisted note linking, auto-open, restart, rename, two vaults, failure+retry and compact layout. Existing planner/plugin/graph regressions remain covered.
3. Diff review finds and fixes material defects before publication. Full tests and build pass.
4. Version 0.10.0 notes identify scope and platform limits. Mac arm64 and Windows x64 archives contain the same final model/source/build/license bytes; Mac packaged runtime is exercised. Windows runtime is not claimed without execution.
5. Commit/tag/push and GitHub prerelease publication are verified against public asset sizes/digests and downloaded checksums.
