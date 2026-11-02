# Personal / Team Review Fixes Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline execution. No delegation or public release is requested.

**Goal:** Fix opposite-purpose reconnection and distinguish actual Git remotes from automatic backup settings.

**Architecture:** Add a connection preflight that preserves already assigned purposes, while retaining explicit purpose changes. Extend existing Git workspace status with sanitized configured fetch/push URLs. Read these through the existing IPC and display them independently of backup configuration.

**Tech Stack:** Existing Node, Electron, React and native Playwright fixtures; no new dependencies.

---

1. Add failing registry regression for both personal→team and team→personal connections, alias paths, unchanged selected folder/settings/notes, and permitted explicit reclassification. Run `node --test tests/vault-registry.test.mjs` and observe rejection missing before the fix.
2. Add real-repository status regressions for configured fetch/push URLs without app backup configuration; initialized and non-repository empty states; preserved config/note bytes and credentials omitted from display. Run `node --test tests/git-workspace.test.mjs` and observe missing metadata.
3. Expand `scripts/verify-vault-spaces.mjs` to reject opposite-purpose connection while keeping the active space and metadata unchanged; open an existing team `origin` before connecting backup; verify separately rendered fetch/push and unset backup target. Observe failures on the previous implementation.
4. Implement `VaultRegistry.checkConnection`, called before folder switching or cloning and by `select`; keep `setPurpose` as the intentional reclassification path. Extend `GitWorkspace.status` with configured remote URL details, using only local Git reads and redacting URL credentials. Preserve existing remote names/actions.
5. Add guarded local repository status loading and refresh in `GitSettings`, with explicit loading/error/no-repository states. Display actual remote fetch/push details and automatic backup target independently. Supply the existing status callback from App.
6. Run focused registry/Git tests, full `npm test`, production build, syntax/diff checks and expanded native space regression. Inspect the actual screenshot. Recheck existing Git workspace, vault/history and journal behavior on the final Mac package.
7. Verify all packaged source/bundle/license files and strict signature. Save a new ready package and receipts, leaving the previously reviewed package intact. Commit only task files. If the actual Mac app can be checked saved/idle, perform backed-up normal-quit installation; otherwise retain the verified ready package and record the remaining installation constraint. No public push/release.
