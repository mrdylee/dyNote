# Journal Details Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans by default for continuous inline implementation. Use superpowers:subagent-driven-development only when the user explicitly requested subagents or parallel agent work. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add native timestamps, ratings, on-this-day navigation and core word count from observed behavior.

**Architecture:** Pure journal helpers reuse existing periodic-date parsing and metadata preservation; a deferred editor transaction safely inserts stamps. Existing journal/preferences and command/modal patterns provide the UI.

**Tech Stack:** Moment, YAML, Intl.Segmenter, CodeMirror and React/Electron.

---

### Task 1: Pure behavior tests

Files: `core/journal-details.mjs`, `tests/journal-details.test.mjs`.

- [x] Test fixed local clock `2026-10-27 15:04`: Korean today's stamp omits date, historical/non-date stamp includes `10/27/2026`; timestamps keep one blank line on both sides and preserve CRLF.
- [x] Test rating 1–5 set/remove preserves existing YAML/comment/prose and refuses invalid values. On-this-day uses configured folders/formats, ignores invalid dates, matches earlier leap years and excludes same/future years.
- [x] Test original four-word/24-character fixture with and without YAML. Run tests before implementing helpers, implement and rerun.

### Task 2: Existing editor and journal integration

Files: `src/App.jsx`, `src/JournalPanel.jsx`.

- [x] Add timestamp command through pending editor-command delivery; set edit mode when needed, append if there was no editor, reject stale target documents and use one undoable insertion transaction.
- [x] Add rating modal and on-this-day modal with date picker and linked notes. Journal settings expose stamp formats/locale through existing profile preferences.
- [x] Add per-period existing next/previous commands only when the palette is open to avoid startup scanning. Add memoized current-note word/character statistics excluding frontmatter.

### Task 3: Actual runtime

Files: `scripts/verify-journal-details.mjs`, `docs/verification/native-workflows.md`.

- [x] Launch Electron with date-named synthetic notes/templates. Insert a stamp, undo once, set rating and verify disk metadata/body. Reopen and navigate a past same-day note; verify original count fixture in the status bar.
- [x] Run full tests/build and record Diarian import/conversion and remaining core gaps separately.
