# Obsidian plugin support investigation

Date: 2026-10-27. Target: Dynote at commit `3e151d5827c41bf01a5cf357ac172f22155998d7`.
Status: discovery completed for installed/enabled metadata and Dynote gaps; implementation scope awaits the user's choice. This document is research, not an approved implementation specification.

## Evidence and limits

- The running Obsidian window identifies itself as **1.14.5**. The installed launcher is 1.12.7; these are different artifacts.
- REA analyzed `obsidian-1.14.5.asar`, selecting `app.js` as inert source. SHA-256: `3a349274f789b62c5b35ad19de10311909a94e8783033569c2210a4bac491780`. Parent evidence: `ev_b16891d81f3f360747f007b5963d5fc3f6858f0f2f0770264e8b8764709c4311`. Unselected sources and semantic limits prevent claims of exhaustive API recovery.
- REA analyzed the installed Recent Files plugin's `manifest.json` and `main.js`. Parent evidence: `ev_13064e46af8cf204fb1481585c46536ff97000534c948cde0038ed3be94fd911`. This is static evidence, not a plugin execution test.
- Actual runtime interaction: opened Obsidian settings, inspected core/community plugin panels, opened the command palette, searched for the Bookmarks command and executed it. The Bookmarks sidebar appeared with no bookmarks.
- The open synthetic graph vault has community plugins restricted and no enabled community plugin list. It cannot establish runtime behavior of the personal vault's plugins.
- The closed personal vault lists the eleven community plugins below as enabled. Configuration proves enabled intent, not successful execution. Only plugin-list metadata, manifests and selected program sources were inspected; private notes and plugin `data.json` were excluded.
- No security setting was changed. No community plugin execution, Windows runtime verification or new product implementation is claimed.

## Configured community plugins and current gaps

Versions are the installed manifests, not claims about the newest available version. The final acceptance behavior must be captured from controlled original-plugin executions after scope selection.

| Plugin | Installed version | Dynote equivalent coverage | Remaining work to assess |
| --- | --- | --- | --- |
| Recent Files | 1.7.4 | No persistent recent-files view | Persistent history, vault separation, rename/delete behavior |
| Plugin Update Tracker | 1.7.0 | No plugin manager/runtime | Requires deciding whether Dynote will host plugins |
| Markmind | 3.1.9 | Graph and Canvas exist, but do not establish mindmap parity | Capture supported mindmap/outline operations and saved formats |
| Outliner | 4.9.0 | Basic editor indentation | Capture subtree movement, folding, zoom and undo behavior |
| Git | 2.34.0 | Backup, clone, commit/push and history restore subsets | Capture required pull, scheduling, conflict and source-control workflows |
| Calendar | 1.5.10 | Git commit calendar only | Daily-note navigation and creation; commit history is a separate function |
| Periodic Notes | 0.0.17 | No periodic-note workflow | Date naming, templates, daily/weekly/monthly behavior |
| Mermaid Tools | 1.2.1 | Mermaid rendering in reading/split views | Capture authoring commands and insertion behavior |
| PDF++ | 0.40.30 | PDF page rendering | Capture selection links, annotations and PDF backlink workflows |
| Diarian | 1.2.25 | No dedicated journal workflow | Determine its required behavior and overlap with periodic notes |
| Enhancing Mindmap | 0.2.5 | No Markdown mindmap editing view | Capture editing operations, serialization and overlap with Markmind |

Disabled installed plugins are outside this enabled-plugin inventory.

## Core functionality

Dynote already implements subsets of file exploration, search, document switching, graph, backlinks, outgoing links, tags, heading outline, properties, Canvas and Bases. These labels do not establish complete behavioral compatibility.

Daily notes, templates, note composition, a general command palette, bookmarks and hover page preview need separate acceptance definitions. Dynote's document switcher is not a general command palette, its heading outline is not the community Outliner plugin, and character counting is not word counting. Recovery/Git restore are partial equivalents to recovery workflows. Audio, web viewer and Obsidian Sync need explicit scope decisions.

## Implementation alternatives

1. **Native equivalent features (recommended starting direction):** implement the selected user workflows through Dynote's existing vault, editor and view boundaries. Share overlapping daily/calendar/journal capabilities. Preserve the current renderer isolation. This does not run original Obsidian plugin files and does not inherently reproduce plugin-specific file formats or settings.
2. **Original-plugin compatibility:** define a versioned Obsidian API compatibility boundary, plugin lifecycle, commands, views, vault events, persistence and required editor integrations. Validate each exact plugin/version individually. Node access, direct DOM assumptions and external dependencies must be inventoried before selecting a hosting architecture; globally disabling the renderer sandbox is not a compatibility design.
3. **Combined, staged support:** implement native workflows first and then add a compatibility host for an explicitly selected plugin set. Broader scope and duplicated integration risks make this a separate staged project, not a claim of automatic compatibility with all eleven.

## V-model verification contract

For each accepted workflow, record a requirement ID, original Obsidian input/action/output, implementation boundary, automated check and Dynote runtime result. Design the checks before implementation. Use synthetic vaults and omit personal settings/credentials.

| Requirement family | Planned verification |
| --- | --- |
| Recent files/bookmarks | Restart persistence; vault isolation; rename/delete updates; actual sidebar navigation |
| Calendar/periodic notes | Same date reopens one file; template insertion; locale/year/week/leap boundaries; concurrent creation does not overwrite |
| Outliner | Move/indent a subtree; undo restores exact text; folding behavior verified in the editor |
| Commands | Palette lists registered actions; disabled states; keyboard execution; document switching remains distinct |
| Mindmaps | Original controlled operations and saved format captured first; Dynote edit/save/reopen preserves required structure |
| Mermaid tools | Selected insertion/edit commands preserve surrounding text; resulting diagram renders |
| PDF workflows | Page/selection link roundtrip; specified annotation persistence; original PDF bytes preserved unless editing is explicitly required |
| Git | Required local/remote cases verified in disposable repositories; conflicts preserve user changes |
| Plugin runtime, if selected | Exact plugin/version load, commands, views, persistence, unload and failures tested; unsupported API calls reported explicitly |
| Platform/performance | Same fixture tested on Mac and Windows; startup-to-first-document and selected interaction timings measured separately |

## Decisions still required

The user has been asked whether the goal is native equivalent features, original-plugin execution, or both; and whether the target is the personal vault's eleven configured community plugins plus core functions, the test vault's core functions, or a named subset. These answers determine the architecture and implementation plan. No approved design or implementation completion is asserted here.

## 2026-10-27 approved direction and controlled runtime follow-up

The user selected native equivalents covering all eleven configured community plugins plus core functionality. This resolves the earlier architecture/target questions; it does not reduce the overall scope to the first implementation slice.

A separate Obsidian profile and synthetic vault were created under ignored `output/research/obsidian-native-fixture/`. Only `main.js`, `manifest.json` and `styles.css` were copied from installed plugins; no personal `data.json`, notes, credentials or sync configuration were copied. The owned test instance loaded all eleven plugin IDs. Its initial runtime inventory registered 358 commands; enabling all five periodic families in this fixture then registered the corresponding periodic commands.

Actual original command execution opened daily `2026-10-27.md`, weekly `2026-W44.md`, monthly `2026-10.md`, quarterly `2026-Q4.md`, yearly `2026.md`, Calendar and Recent Files. Existing daily opening reused the file; period notes were created when missing. Recorded files: `runtime-inventory.json`, `runtime-behavior.json`, `runtime-plugins.png`. This establishes these representative commands, not every command of every plugin. The owned instance was closed after observation.

Additional program-only REA references, with partial semantic coverage and zero parse failures:

- Calendar: `ev_b9ab5d57e72feed233b98bedbd8f585cb9a6c58fcc19a9fd8d83fc274fa978d8`.
- Periodic Notes: `ev_6ccb31ae1c359300ac9a44828497022437a2d0d01e67ce4dcce74048c0d25734`.
- Diarian: `ev_19831a25fe5b3088732773e63e3afd22d80842bdd4cf4ce005ae1b7eb12ebbcc`.
- Mermaid: `ev_03b9704ee67a92ebded7a34b332f80611de91dfa6db69f91a548028e3b1c044b`.
- Outliner/Markmind/Enhancing/PDF++/Git/Update Tracker: `ev_e8cf41d1b44b328a6a2bed7aea38c29552b7c4b782a5c7c2eb8abac18d8f3654`; exact source hashes and command contexts retained in ignored `output/research/plugin-equivalence-detail.json`.

Important remaining scope: Diarian includes ratings, timestamps, on-this-day, importer/converter; Recent Files has exclusion settings; Markmind rich includes persisted JSON and export/annotation workflows; PDF++ edits real PDF annotations/pages; Git includes staging/diff/branches/remotes. A calendar, basic mindmap or PDF page viewer alone must not be called complete plugin equivalence.
