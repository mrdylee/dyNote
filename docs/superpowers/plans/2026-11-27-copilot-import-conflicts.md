# Copilot import conflict review implementation plan

> **For agentic workers:** Use superpowers:executing-plans for inline execution.

**Goal:** Open actionable conflicts at the point of import and resume the same request.

**Architecture:** Return affected paths from the capture controller. Intersect protected paths with pending Git conflicts before displaying them. Reuse PersonalVersionReview for decisions and retain the original request while reviewing.

**Tech Stack:** Electron IPC, React, Node test runner.

- [x] Extend tests/copilot-journal-controller.test.mjs to assert affected paths during migration, reimport and pending replay. Run node --test tests/copilot-journal-controller.test.mjs and confirm the new expectations fail before editing the controller.
- [x] Update electron/copilot-journal.mjs to return the unique set of blocked paths, including the check-only scan. In electron/main.mjs distinguish pending versions from published deletions.
- [x] Connect capture actions in src/App.jsx to PersonalVersionReview, including cancellation, sequential files and an already-resolved file. Reuse the original vault, manual flag and project arguments. Expose resume in CopilotJournalSettings and the main status bar.
- [x] Exercise the popup, cancellation and retry through the renderer. Check background capture and preservation of the selected project. Run npm test, npm run build and git diff --check.
