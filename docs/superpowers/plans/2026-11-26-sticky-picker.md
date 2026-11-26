# Sticky note picker implementation plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans by default for continuous inline implementation. Use superpowers:subagent-driven-development only when the user explicitly requested subagents or parallel agent work. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Open a synced Markdown memo on this desktop and create a card by mouse.

**Architecture:** Derive the list from the existing personal vault snapshot. Open by validated vault and path through the existing serialized window controller and save against the file revision.

**Tech Stack:** Electron, React, CodeMirror, Playwright.

- [x] Extend scripts/verify-sticky-review.mjs with an isolated profile containing a synced file but no local record. Check discovery, repeated selection, both create buttons, close, and editing the original file.
- [x] In electron/main.mjs and the two preloads, connect the main window and verified card senders to StickyNotes. In electron/sticky-notes.mjs reuse local records and create local placement on first open.
- [x] In src/App.jsx render the personal snapshot with a collapsible picker before the navigator footer. Add the new button to sticky.html and src/sticky.mjs.
- [x] Run npm run build, npm test, and node --test scripts/verify-sticky-review.mjs. Inspect the picker and card screenshots.
