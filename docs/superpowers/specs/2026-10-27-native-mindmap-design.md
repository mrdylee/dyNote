# Native mindmap design

Approved portfolio: native Markmind/Enhancing Mindmap workflows. Both use `mindmap-plugin: basic` Markdown. Markmind rich uses `mindmap-plugin: rich` plus a fenced JSON object containing arrays of flat nodes in `mindData`; nodes reference their parents through `pid`.

Controlled original execution loaded the basic `Map.md`, switched to the Markmind view and executed basic-to-rich conversion. It produced a separate `Map-rich.md`, leaving the basic source unchanged. The synthetic generated file is captured as `tests/fixtures/markmind-rich.md`. Disabling Enhancing Mindmap in the synthetic profile avoided confusing its `mindmapView` with Markmind's distinct `mindmapview`; no personal configuration changed.

Native architecture: parse basic headings/list nodes with source ranges, or rich flat nodes with IDs/parents/coordinates. React Flow displays native cards and hierarchy edges. Existing SaveQueue/revision checks persist edits. Rich updates preserve unknown object fields and auxiliary arrays. Invalid/cyclic rich data produces a visible error and remains editable in Markdown; never silently replace it with an empty map.

MAP-01: basic node rename, child/sibling creation, subtree deletion, local collapse/expand and view/Markdown switching, with original frontmatter/prose retained. MAP-02: read/edit rich nodes, preserve coordinates and unrelated data, persist rich drag positions and expanded state. Conversions create a separate basic/rich file through exclusive Vault creation, never overwrite an existing conversion target.

This slice does not establish PDF/EPUB annotation, licensed original extensions, XMind/PDF exports, AI/GROBID/translation services or every layout/preset. Keep those portfolio items open. Native conversion supports hierarchy/text; rich-to-basic cannot represent rich decorations, so the original rich document remains available.

V-model: original generated rich fixture -> parser/preservation/cycle tests -> native editor -> actual Electron rename/add/save/reopen, drag coordinate persistence and safe conversion tests. Keep Markdown source/revision conflict behavior intact.
