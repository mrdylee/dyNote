# Personal and team documents in one workspace

> Execute inline with Superpowers. Start from `v0.16.1` on `feat/personal-team-together`.

Show connected personal and team trees, search them, and edit their documents in the existing one to three panes.

Use a registered vault ID and relative path for each tab, pane, write, attachment and AI request. File filters change visibility while preserving panes. The journal startup preference controls the startup screen. This implements stage one of the design on `docs/personal-team-together-copy`.

1. Add `scripts/verify-vault-together.mjs`. Use temporary personal and team roots with separate `회의록.md` files. Verify the test fails against the released app at the missing combined explorer.
2. In Electron, open only registered personal/team vaults for the combined workspace. Keep the legacy selected-vault requests scoped as before. Route explicitly scoped requests to their own Vault and Git controller. Verify cross-scope save isolation, the registry boundary, and concurrent Git settings persistence.
3. Store renderer snapshots per vault and key documents by ID plus path. Extend the existing `DocumentWorkspace` and file tree so a real drag opens a different document beside the anchor. Check that the sidebar filter, tab selection, note mode, and width follow their intended scope.
4. Resolve internal links, attachments and journal/AI operations with the originating scope. Verify file bytes and request context after switching focus during an operation, then restart and reopen both files.
5. Run `npm test`, `npm run build`, the combined workspace script and the existing native journal, vault and provider scenarios with temporary profiles. Review the diff and commit the verified local feature branch.
