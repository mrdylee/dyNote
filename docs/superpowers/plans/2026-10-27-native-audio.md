# Native Audio Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans by default for continuous inline implementation. Use superpowers:subagent-driven-development only when the user explicitly requested subagents or parallel agent work. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add user-controlled recording and local playback without widening note/native permissions.

**Architecture:** Browser MediaRecorder uses a narrow audio-only permission policy; imported attachments reuse Vault and SaveQueue. A dedicated audio viewer owns and revokes local Blob URLs.

**Tech Stack:** Existing Chromium MediaRecorder, Electron permission handlers, React and Vault.

---

### Task 1: Policy and byte tests

Files: `core/security.mjs`, `core/vault.mjs`, `tests/security.test.mjs`, `tests/desktop.test.mjs`.

- [x] Test `allowAudioPermission('media',exactMainUrl,true,['audio'])` true; video/mixed/unknown/remote/subframe false. Existing font policy stays unchanged.
- [x] Import signature fixtures for WebM/WAV/MP3/Ogg/M4A and verify identical bytes/mime in snapshot/read/restore. Reject PNG disguised as audio and traversal/oversized inputs.
- [x] Observe failures before implementing audio extension/mime/signature and policy changes; rerun.

### Task 2: Recorder/playback integration

Files: `src/AudioRecorder.jsx`, `src/AudioViewer.jsx`, `src/App.jsx`, `src/styles.css`, `electron/main.mjs`, `index.html`, `scripts/package-desktop.mjs`.

- [x] Add audio-only main-frame permission grant and macOS usage description. Keep the main renderer sandbox and existing network restrictions; allow local Blob media only in CSP.
- [x] Implement start/stop-save/cancel with track disposal, bounded chunks, explicit active state and retryable save errors. Guard modal/app close and modal-switch shortcuts while active; no automatic recording.
- [x] Import to the originating vault and append one audio embed through SaveQueue. Show local audio controls for saved attachments and revoke Blob URLs on change/unmount.

### Task 3: Synthetic media runtime

Files: `scripts/verify-audio-runtime.mjs`, `docs/verification/native-workflows.md`.

- [x] Launch actual Electron with fake media-device flags in a temporary profile. Start recording, cancel once, then record/stop/save. Verify only the saved clip exists, EBML bytes/mime and Markdown link roundtrip.
- [x] Open playback and wait for audio metadata without playing through speakers. Verify page errors absent and physical microphone was not used. Run whole tests/build; record OS/Windows limitations.
