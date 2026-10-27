# Native Update Information Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans by default for continuous inline implementation. Use superpowers:subagent-driven-development only when the user explicitly requested subagents or parallel agent work. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add safe explicit Dynote release checking and release-note/download navigation.

**Architecture:** Pure feed selection/comparison sanitizes metadata before a fixed main-process fetch response reaches the native React settings view. Channel/ignored-version preferences stay in local profile storage.

**Tech Stack:** Existing Electron/Node fetch and React; no updater or plugin runtime dependencies.

---

### Task 1: Release selection tests

Files: `core/update-information.mjs`, `tests/update-information.test.mjs`.

- [x] Test version 0.10.0 sorts after 0.9.0, stable sorts after its beta, beta.10 after beta.2, and non-version tags/drafts are excluded.
- [x] Test stable versus prerelease filtering, current-version comparison, canonical URL derivation and rejecting foreign asset URLs; HTML remains inert text.
- [x] Run the test before implementing `releaseInformation(feed,current,includePrerelease)` and rerun after implementing.

### Task 2: Main API and settings UI

Files: `electron/main.mjs`, `electron/preload.cjs`, `src/UpdateSettings.jsx`, `src/App.jsx`, `src/styles.css`.

- [x] Add a read-only fixed-endpoint release check with GitHub Accept/User-Agent headers, 10-second abort signal, status checking and explicit error. Never accept a caller-supplied URL.
- [x] Add native update settings and command. Display current/latest version, release notes and known release/asset links; support beta channel, ignore selected version and restore ignored versions using existing local profile persistence.
- [x] Block repeated checks while pending; request failure displays an error and does not display an up-to-date claim. No automatic install or startup poll.

### Task 3: Verify runtime

Files: `scripts/verify-update-information.mjs`, `docs/verification/native-workflows.md`.

- [x] Launch actual Electron, navigate to Update settings, make one explicit public release request and verify a result or honest network failure. Verify ignored preferences and channel persistence without downloading/installing assets.
- [x] Run whole tests/build, record source-app versus packaged/Windows evidence and remaining portfolio scope.
