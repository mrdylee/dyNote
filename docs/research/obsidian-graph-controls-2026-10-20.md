# Obsidian graph controls: shipped-artifact review

Date: 2026-10-20. Purpose: independently implement Dynote graph controls from observable behavior. No Obsidian implementation code is included in the product. This report covers static evidence; the accompanying application verification must separately record actual UI observations.

## Identity and REA evidence

- Installed target: `/Applications/Obsidian.app/Contents/Resources/obsidian.asar`.
- Both the app bundle and packaged manifest report **1.12.7**.
- ASAR SHA-256: `2b2483b2e1246772e0d25367ec055cbc5047ea2f0091b667c35656678f86d712`.
- Packaged `app.js` SHA-256: `cc6d0c363cba3935207fb70e7d78736c9f0c2024545787871095288a1b185851`.
- The packaged member was hashed again and matches the previously extracted research copy, `/Users/james_black/work/project/REA/research/obsidian-1.12.7/graph-review/app.js`.
- Reused REA application Evidence: `ev_51248e14d2a6b4e8a100c1288987d9e88abd1aeb530b1ccdeb12523b95dda038`; selected source `app.js`, authority `shipped-artifact`.
- Existing summary Evidence: `ev_8e2058d3b721c039515f1222ae1301dfd12e938a55e573c6eb0dfbeb1223a4fe`.
- Revalidated the portable evidence with the installed REA CLI, `inspect-evidence-bundle`, selecting the exact Evidence ID. It reports one complete retained record with the same target digest. Receipt: `research/obsidian-1.12.7/graph-controls-2026-10-20/rea-reused-evidence.json` under the parent REA workspace.
- The fresh MCP connection contained no retained records; the matching portable bundle was reused instead of repeating application analysis.

REA establishes artifact identity and bounded static structure. The behavior descriptions below are **analyst readings of the matching packaged source**, not claims that REA automatically proved all semantics or observed execution. Source locations are zero-based Unicode character offsets in the identified `app.js`, not byte offsets.

## Findings

| Feature | Static behavior | Source range |
| --- | --- | --- |
| Panel | Graph overlay on the right; four independently collapsible sections: filter, groups, display, forces. Close/open and reset controls are separate from graph data. | 2549490–2551300; 2559260–2560530 |
| Search filter | Uses the application search matcher, including required metadata/content inputs, rather than only a filename substring. Changes schedule search; Enter updates immediately when not composing. Colored group queries do not exclude unmatched files. | 2552270–2553810; 2560200–2561200 |
| Tags | Optional tag nodes and note-to-tag edges; tags are normalized case-insensitively against the vault tag index. Default off. Clicking a tag opens a tag search. | 2211110–2211270; 2553900–2555320; 2556750–2557110 |
| Attachments | Optional non-Markdown file nodes and links. Default off. Attachment inclusion is separate from unresolved-link inclusion. | 2211110–2211270; 2553900–2555320 |
| Existing files only | Hides unresolved link target nodes when enabled. Default off, so unresolved targets can appear. | 2211110–2211270; 2554510–2554880 |
| Orphans | Default on. When disabled, removes nodes with no incoming or outgoing non-self connection in the resulting graph. A self-link alone does not make a node connected. | 2555450–2555860 |
| Groups | Ordered search-query/color pairs. First matching colored query wins. Supports add, delete, color selection and drag reorder; reordering changes precedence. Main search still filters inclusion. | 2552270–2553810; 2563950–2566900 |
| Arrows | Optional directional arrows on source-to-target links; off by default. Arrows also fade at distant zoom and are viewport-culled. Opposite-direction links share line treatment but keep direction logic. | 2216650–2218200; 2566900–2567510 |
| Text visibility threshold | Range −3 to 3, default 0. Increasing the value requires closer zoom before ordinary labels become visible; highlighted labels remain legible. This is a fade threshold, not a font-size setting. | 2231500–2231770; 2567510–2567770 |
| Node size | Range 0.1–5, default 1; multiplier applies to a degree-dependent base size. | 2215350–2215500; 2567770–2568080 |
| Link thickness | Range 0.1–5, default 1; changes rendered stroke thickness. | 2216650–2218200; 2568080–2568400 |
| Animation | **Chronological timelapse**, not merely reheating a force simulation: cached files are ordered by the earlier creation/modification timestamp, and graph connections/notes are progressively exposed. The control is omitted in the local graph. | 2554010–2554310; 2555090–2555320; 2555980–2556500; 2568370–2568580 |
| Center force | UI range 0–1 with nonlinear mapping to simulation strength. Default simulation value is 0.1. | 2549215–2549330; 2568580–2569180 |
| Repel force | UI range 0–20, default 10; its cube is sent to the simulation. | 2568580–2569460 |
| Link force | UI range 0–1 with nonlinear mapping. Default simulation value is 1. | 2549215–2549330; 2569460–2569790 |
| Link distance | Range 30–500, default 250. Changing forces sends new settings and resumes computation. | 2230830–2230950; 2569790–2570080 |
| Persistence | Global graph obtains stored plugin options on load and saves current settings on change. Local graph includes options in workspace view state. Settings include section expansion, panel closed state and zoom scale. This establishes save/load call paths, not a measured restart test. | 2545220–2545600; 2546910–2547100; 2547540–2548000; 2549140–2549210; 2558530–2560530 |
| Reset | Restores filter, display and force defaults and removes all color-group rules. | 2550640–2551110 |

## Implementation implications

1. Reuse Dynote's existing renderer and worker. Move controls into a scrollable right overlay; instant sliders should update rendering or forces without rebuilding the whole application.
2. Treat note, tag, attachment and unresolved-target nodes explicitly. Recompute orphan inclusion after other filters, preserving connected-component and local-neighborhood semantics.
3. Explain the supported query syntax in Dynote. Implementing a deliberate subset such as text, `path:` and `tag:` is reasonable, but it must not be described as complete Obsidian search compatibility.
4. Apply group rules in displayed order. Use controls that make precedence and reordering apparent; drag behavior is not required to reproduce the result.
5. Keep label-threshold direction consistent: larger threshold means labels appear only at closer zoom.
6. If Dynote offers “animation replay,” distinguish a chronological reveal from a layout restart. A layout restart should use its own clear label.
7. Persist options by vault. Test reset and switching vaults separately so one vault cannot overwrite another's saved settings.

## Coverage and limitations

- The referenced REA analysis selected only `app.js`; 35 inventoried files remained outside that analysis scope. Semantic graph expansion was bounded and incomplete. Complete record retention does not imply complete semantic coverage.
- Exact source identity was verified this turn. No target JavaScript was executed by this static work.
- Actual interaction, restart persistence, animation speed/appearance, accessibility and performance require GUI/runtime verification.
- No full query grammar compatibility, binary compatibility or pixel-identical rendering is claimed.
- Obsidian's UI slider values are transformed before reaching its simulation; copying those raw values into Dynote's existing force model would not by itself reproduce layout or performance.

## Direct GUI observations (root session)

The installed app was opened through native UI automation. Its graph view title reported Obsidian 1.12.7. Filter toggles, display controls and forces were visible in the right panel. Expanding Groups exposed “New group”; adding one exposed a search field, color picker with reorder help, and delete control. The temporary blank group was then removed. The node-size slider changed from 1 to 2 through its accessibility increment action and was restored to 1 through decrement. The animation button was invoked. These UI observations corroborate control wiring; chronological ordering is supported by the static artifact analysis, not inferred from a single still image. No private note content was changed or included in this report.
