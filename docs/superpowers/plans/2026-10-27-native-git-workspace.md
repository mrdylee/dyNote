# Native Git Workspace Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans by default for continuous inline implementation. Use superpowers:subagent-driven-development only when the user explicitly requested subagents or parallel agent work. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deliver native reviewable Git changes, stage/diff/commit and safe pull/branch workflows.

**Architecture:** GitWorkspace reuses GitBackup repository/path validation and runGit, serialized through GitController. A settings panel calls the narrow native operation API; editor flush/snapshot reload handle file changes.

**Tech Stack:** Existing Node child_process Git wrapper, React/Electron, real Git fixture tests.

---

### Task 1: Real repository tests

Files: `core/git-workspace.mjs`, `tests/git-workspace.test.mjs`.

- [x] In a temporary standalone vault repo, configure only fixture-local author identity, commit `A.md`, modify it and add `B.md`. Test status, stage, staged diff, commit and unstage; verify actual index/worktree through Git.
- [x] Stage an excluded `.secret` fixture and assert commit is refused. Reject invalid file/branch/options and parent repositories. Verify no source bytes change on rejected operations.
- [x] Use a temporary bare origin and sibling clone to test fetch/clean fast-forward pull. Dirty and divergent states must reject without losing bytes; merged-only branch deletion must reject unmerged work.
- [x] Run `node --test tests/git-workspace.test.mjs` before implementation, then implement the minimal GitWorkspace and rerun.

### Task 2: Native integration

Files: `electron/main.mjs`, `electron/preload.cjs`, `src/GitWorkspace.jsx`, `src/App.jsx`, `src/styles.css`.

- [x] Add narrow Git status/action IPC validated through sender/vault checks and serialized in GitController. Reject branch changes while automatic backup is enabled.
- [x] Expose changed/staged rows, selected-file diff, stage/unstage, staged commit and network/branch actions. Require clean worktree for pull/switch/create. Surface excluded-file count and operation errors.
- [x] Flush editor changes before actions; lock writes while Git mutates; reload snapshot after file-changing operations. No network call runs during panel mount or startup.

### Task 3: Runtime verification

Files: `scripts/verify-git-workspace.mjs`, `docs/verification/native-workflows.md`.

- [x] Launch actual Electron with a disposable Git vault, open panel, stage file, view diff and commit a message; verify HEAD and working bytes through Git.
- [x] Verify local branch create/switch and dirty worktree rejection preserve files; existing backup/history tests remain passing.
- [x] Run whole tests/build and record supported subset and unverified external/Windows paths.
