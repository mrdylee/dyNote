# Native Git workspace

Approved GIT-01 scope: extend existing backup/history with native changed-file status, per-file stage/unstage, safe diff, staged commit, fetch, clean fast-forward pull, and local branch listing/create/switch/delete. Use existing runGit environment/hook protections and exact standalone vault-repository checks. Do not add a shell/raw-command bridge.

Serialize Git workspace operations with GitController.enqueue. Flush editor changes before mutations and reload a vault snapshot after pull/branch switch. Source control works for an existing standalone vault repository even when automatic backup is disabled. Branch changes require automatic backup to be disabled first; otherwise it could unexpectedly push a newly selected branch under old configuration.

Show staged/worktree state for allowed vault file types, and disclose the count of excluded paths. Refuse staged commit if excluded files are in the index so the UI never commits hidden/unreviewed configuration. Preserve manually staged work. Untracked files open in the existing editor rather than pretending to have a tracked-file diff. Git diffs disable external diff/textconv. Clean fast-forward pull refuses dirty worktrees and never rebases, resets or autostashes user changes. Local branch deletion uses merged-only `-d`; no force/discard/delete-repository behavior is added.

A native panel exposes these actions, a commit-message field and text diff. Network actions happen only on explicit user requests; startup does not wait for network. Existing credential helpers/SSH remain external; no credentials enter the renderer or documentation. This slice does not implement every original Git command: blame, remote editing, raw shell commands, destructive discard, partial hunk staging and merge conflict resolution remain open.

V-model: disposable real repositories test status/staging/diff/commit, hidden staged refusal, branch guards and dirty/divergent pull preservation. Native Electron verifies panel interaction and actual disk/index state. External SSH/HTTPS remotes and Windows remain separate runtime proof.
