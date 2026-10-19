# Canvas and Bases

The user approved implementation after reviewing references. Keep the white desktop UI and the existing exclusions (inline Live Preview, mobile, Sync/Publish). Work on `feat/canvas-bases`; do not silently publish a new release.

## Review of v0.2.0

Reviewed the current Vault save/move/trash pipeline, IPC sender/vault checks, Markdown sanitization, SaveQueue, and App integration. The baseline 40 filesystem/knowledge/security/save-queue tests pass; dependency audit reports zero known advisories. This is a scoped code review, not a full security certification. The existing graph is a deterministic SVG layout: no force simulation or individual node dragging. Preserve that behavior during this feature; Canvas is a separate editor.

The important integration gap is that structured documents are not recognized by the vault. Simply adding UI would omit recovery, conflicts and file relocation. Extend the existing storage boundary for explicit `.canvas`/`.base` operations while leaving Markdown-only APIs narrow.

## Canvas

Use MIT React Flow for interaction and the MIT JSON Canvas 1.0 format for storage. Support text/file/link/group cards, resizing, spatial placement, labeled/color connections, grouped movement, undo/redo, pan/zoom and save/reopen. Local note/image/PDF cards open existing viewers; images can render locally. Web cards only open explicitly through the existing external-link boundary. No remote iframe or image loading. Preserve unknown JSON properties on editing. Validate IDs, numbers, endpoints and vault-relative file references. Unsupported node types open read-only without modifying their source. Preserve unsupported subpaths without pretending to render a selected block.

## Bases

Use `obsidian-bases-expression@0.3.0-rc.4` for AST interpretation of filters/formulas. It is a headless MIT runtime, not the Obsidian view implementation. Use existing note properties, tags and resolved links as data. Parse `.base` YAML, combine global and view filters, support table views, columns, display names, ordering, grouping, limit and formulas. Basic note-property cells edit through the existing revision-aware save queue and preserve body, YAML comments and unrelated properties. File/formula values are read-only. Provide a view selector and a YAML configuration editor; unsupported layouts or summary settings display a clear message, preserve raw configuration and disable unsupported writes. No community plugin runtime.

Evaluate data in a local module Worker with a timeout and cancellation; malformed or expensive expressions must not block the UI. No `eval`, network, filesystem or arbitrary host callbacks are exposed to formula code.

## Storage and UI

Snapshot adds `documents` independently from Markdown `notes` and binary `attachments`. Structured documents have content, kind and revision. New create/save IPC calls validate document syntax. Reuse exclusive create, serialized writes, revision check, atomic replacement, backup and trash restoration. File moves update JSON Canvas file/background references and text-card Markdown links, as well as Markdown links to structured documents. Preserve Bases configuration during moves; filters describing paths are user-authored queries and are not automatically rewritten.

Integrate structured documents into the existing file tree/tabs with new Canvas/Bases creation actions. Keep one save queue for all editable documents and note-property changes. Flush before moving, switching vaults or closing. Read-only unsupported documents retain their original source. Existing graph, Markdown modes and attachments continue working.

## Acceptance

Tests cover real-filesystem round trips, stale revisions, collisions, recovery, structured references on relocation and symlink rejection; JSON unknown fields, invalid graph data and YAML aliases; Korean filters/formulas, table grouping/sorting, formula failures and lossless property editing. Build, audit, native Mac UI smoke, Mac and Windows packages are required. Disclose Windows runtime status and supported-format subset. No original personal vaults in tests.
