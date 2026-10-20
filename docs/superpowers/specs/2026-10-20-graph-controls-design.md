# Dynote graph controls

## Goal and decision
Recreate the useful right-side graph controls observed in installed Obsidian 1.12.7, independently, on Dynote's existing Pixi/WebAssembly worker engine. The user authorized implementation, review and publication.

Alternatives: (1) move current sliders only (small, but missing requested filters/groups); (2) extend existing model/renderer and add a right panel (chosen: complete interaction scope without engine replacement); (3) replace the graph engine (unnecessary risk and performance regression).

## Behavior
- White graph workspace, compact heading, right scrollable settings panel with collapsible Filter, Groups, Display, Forces sections. Close/reopen and reset. Settings scoped to each vault; reset clears filters and groups too.
- File search supports literal name/path text, quoted phrases, path:, file:, tag:, and negative terms combined with AND. Clearly advertise this subset, not full Obsidian search compatibility.
- Tags appear as connected nodes; attachments toggle shows referenced binary assets; existing-files-only hides unresolved local links; orphans toggle removes nodes without visible connections. Canvas/Base documents remain file nodes. Use existing link resolver; never create files by clicking unresolved nodes.
- Groups have query and color, first match wins, add/remove/up/down controls. Color edits do not restart physics. Existing active/hover highlighting remains.
- Arrows point from source to target when sufficiently zoomed. Text threshold increases the zoom needed for names. Node size/link thickness react immediately.
- Keep Dynote's proven physical force ranges, with clear labels; replay reveals nodes chronologically by min(creation, modification time), reveals edges when both ends are present, then ends without perpetual rendering. Missing timestamps use stable path order; tag/missing/attachment nodes appear with their earliest connected document. Graph changes cancel replay.
- No changes to user notes or Obsidian source copied into product.

## Verification
Unit cases cover link expansion/resolution, orphan-after-filter semantics, queries, first-match groups, clamped saved settings and replay ordering. Real Electron tests exercise panel, filters, colors, arrows, sliders, replay, reopen persistence, empty graph, zoom/drag and worker cleanup. Review security (local link routing), performance (no per-edge scene objects, no idle animation), and regressions. Package Mac arm64 and Windows x64, verify contents, publish GitHub release with checksums. Windows runtime remains unverified on this Mac.
