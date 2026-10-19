# Dynote desktop expansion

Approved continuation: implement the remaining reviewed desktop scope, excluding Obsidian-style Live Preview, mobile and Obsidian Sync/Publish. Keep Canvas/Bases/plugin compatibility as the separately scoped design items already identified in UPSTREAM-REVIEW.md. No automatic note upload or Git credential storage.

## Release baseline

Publish the already verified v0.1.0 at 5bfaa4c with both existing ZIPs and SHA256 files as a prerelease. Confirm all four assets on the published page. Keep its source tag fixed while developing v0.2.0.

## Storage and links

- Add failing real-filesystem cases to tests/desktop.test.mjs for binary image/PDF import/read, path and symlink rejection, collision/stale-revision rejection, file relocation with incoming/outgoing relative-link updates, and recoverable trash/restore.
- Extend core/vault.mjs: snapshot includes attachments; importAttachment(name, bytes), readAttachment(path), moveFile(from,to,revision), trashFile(path,revision), restoreTrash(id). Restrict attachment types to PNG/JPEG/GIF/WebP/PDF, verify signatures, limit to 25 MiB and preserve bytes. Keep hidden directories out of notes and store recovery/trash outside the vault.
- Add core/links.mjs for shared safe vault-relative resolution and syntax-aware link rewriting that skips fenced/inline code. Before a move validate all affected file revisions and destination exclusivity; on a partial failure restore only unchanged writes made by this operation and retain recovery copies.

## Knowledge and editor

- Test metadata/body separation, normal Markdown links in backlinks, path-safe suggestions, YAML edits, task source-line updates, note embeds with cycle limits, local attachments, and phrase/tag/path/exclusion searches.
- Reuse the MIT searchIndex.ts logic from pinned upstream d6601440 after conversion to JavaScript; retain copyright/license in THIRD_PARTY_NOTICES.md. Keep markdown-it and DOMPurify. Add YAML parsing, footnotes, task lists, safe math and Mermaid rendering.
- Extend core/knowledge.mjs while preserving existing exported APIs. Add parseMetadata, updateMetadata, suggestNotes, toggleTask, and attachment URL helpers. Give editor suggestions actual paths, retaining visible labels separately.
- Extend src/Editor.jsx with CodeMirror completion and clipboard/file-drop image import; composition must not trigger text replacement. Preserve native undo history.

## Native integration and UI

- Add narrow preload/IPC calls for attachments/move/trash/restore. Serve only validated local image data through notes://vault/<vaultId>/<encoded-path>. Preserve all sender checks and network blocking. Permit local images/workers in CSP; PDF is rendered from validated bytes using bundled PDF.js, not arbitrary file navigation.
- Add src/PdfViewer.jsx with page navigation, src/DiagramPreview.jsx with strict Mermaid and SVG sanitation, and file/metadata dialogs in src/App.jsx. Flush the existing SaveQueue before file changes or folder switches; keep active note/tabs coherent after moves and reload.
- Provide native attachment chooser, paste/drop insertion, attachment listing and image/PDF open. Provide rename/move and recoverable delete with restore. Expose YAML editing, unlinked mentions, search operator hints, graph path/tag/local-depth filters. Keep current read/edit/split modes.
- Document manual note Git workflow: save, pull/resolve conflicts, refresh, edit, commit/push using user's Git tooling. No implicit background push; app source and note repositories remain separate.

## Verification and delivery

Run node tests after each red/green cycle, then npm test, npm run build, npm audit, git diff --check. Exercise the actual packaged Mac app against a synthetic vault with an image/PDF, linked moved note, metadata and an ordinary Markdown backlink. Check PDF rendering and clipboard insertion. Cross-package Windows, verify sources/runtime/ZIP checksums and disclose that Windows runtime is untested. Bump to 0.2.0, commit/push, publish updated assets and verify remote HEAD, release assets and clean status. Do not claim Canvas/Bases/plugin compatibility or live editing preview.
