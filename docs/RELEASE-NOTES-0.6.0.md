# Dynote v0.6.0 — Graph controls

- Graph settings now live in a scrollable right panel, with collapsible Filter, Groups, Display and Forces sections, close/reopen and reset.
- Toggle tag nodes, attachments, unresolved targets and unconnected notes. Node counts include the enabled types. Canvas/Base documents can also appear as file nodes; this does not parse their internal edges into the note graph.
- Search by filename/path text, quoted phrase, `path:`, `file:`, `tag:` or negative terms (`-tag:archive`), combined with AND. This is a documented subset: no full-content, regex, OR or full Obsidian query compatibility.
- Add color groups and move them up/down. The first matching group wins. Group/display changes preserve the physical layout.
- Show source-to-target arrows when zoomed in. Adjust label appearance threshold, node size, line thickness, center force, repel force, link strength and distance.
- Replay a four-second chronological reveal using the earlier file creation/modification timestamp. Files without timestamps use stable path order; attached synthetic nodes appear with their owning file. Stop restores all nodes. Changing the graph cancels the animation.
- Settings are saved per vault. Existing layout settings migrate; reset also clears search and groups.

## Validation and limits

Installed Obsidian 1.12.7 was inspected through REA artifact evidence and its live GUI. This is an independent implementation, not copied Obsidian source, and does not claim identical physics, performance or every search feature.

Node tests and real macOS Electron tests cover filters, grouping, arrows, seven sliders, replay, idle rendering, persistence, reset, keyboard/mouse navigation, worker lifecycle and 1,000-note regression behavior. See [review](verification/graph-controls-review.md).

Downloads: Mac Apple Silicon app ZIP and Windows x64 portable app ZIP, plus SHA256SUMS.txt. Extract the entire Windows folder before running Dynote.exe. The Windows package was built and inspected on macOS; native Windows execution was not tested. Packages are not distribution-signed/notarized.
