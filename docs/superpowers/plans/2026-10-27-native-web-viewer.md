# Native Web Viewer Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans by default for continuous inline implementation. Use superpowers:subagent-driven-development only when the user explicitly requested subagents or parallel agent work. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add explicit isolated HTTP/HTTPS reading windows with no note/native access.

**Architecture:** A narrow main-process URL operation creates owned child windows using a separate session; React supplies the URL dialog. Main notes keep their existing sandbox, preload and network policy.

**Tech Stack:** Electron BrowserWindow/session and existing URL/frame validation.

---

### Task 1: URL policy

Files: `core/security.mjs`, `tests/security.test.mjs`.

- [x] Test safeWebViewerUrl accepts normalized HTTP/HTTPS, rejects mailto/file/javascript/data URLs, credentials/control characters. Run failing test before implementation.

### Task 2: Native child and UI

Files: `electron/web-viewer.mjs`, `electron/main.mjs`, `electron/preload.cjs`, `src/App.jsx`.

- [x] Create a sandboxed/context-isolated no-Node/no-preload child with a separate memory session. Configure denied permissions/downloads/popups once per session and guard navigation/redirect schemes.
- [x] Validate native sender; expose only URL opening, not arbitrary BrowserWindow settings. Track children and destroy owned children when the main window closes.
- [x] Add command and URL modal, show errors on invalid/failed requests, and retain note network restrictions.

### Task 3: Hostile local fixture runtime

Files: `scripts/verify-web-viewer.mjs`, `docs/verification/native-workflows.md`.

- [x] Run a local test HTTP server; launch actual Dynote and open it through the native dialog. Verify page content and no window.notes/require.
- [x] Inspect actual child preferences/session isolation, deny file navigation/popups and remote microphone access, close it and confirm note UI remains usable. Run whole tests/build.
