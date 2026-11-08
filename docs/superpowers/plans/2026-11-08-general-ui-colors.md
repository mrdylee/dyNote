# General UI and text colors Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for continuous inline implementation.

**Goal:** Simplify Dynote for general users and provide reusable text colors.

**Architecture:** Remove ESS routes and manual AI-extension controls without changing note data or AI runtime. Add a focused color picker beside the existing formatting actions, backed by localStorage.

**Tech Stack:** React, CodeMirror, Vite, Electron, Node tests and Playwright.

- [x] Extend `scripts/verify-text-color.mjs` with palette selection, save deduplication, restart persistence, removal and missing ESS/MCP controls. Run against the baseline; expect missing palette controls.
- [x] Remove ESS imports, state, callbacks, navigation, tab and rendering from `src/App.jsx`; remove the ESS Vite build input. Remove `AiExtensions` and associated busy state from `src/CopilotPanel.jsx`; delete the newly orphaned component.
- [x] Create `src/TextColorPicker.jsx`: 12 named colors, custom input, saved swatches with individual delete controls, localStorage persistence and synchronization between editor panes. Integrate in `src/Editor.jsx`, style in `src/styles.css`. Preserve selection and read-only behavior.
- [x] Run `npm test`, `npm run build` and the Electron verification script. Inspect the screenshot and `git diff --check`. Record actual results and limitations.

## Screen eyedropper follow-up

- [x] Write `tests/text-color-picker.test.mjs` for screen sampling to a saved swatch, Escape cancellation, failure feedback, unsupported/read-only states and unmount cancellation. Run it against the existing picker and confirm the screen sampling control is missing.
- [x] Extend `src/TextColorPicker.jsx` with a user-triggered EyeDropper, cancellation cleanup and inline feedback. Keep explicit Save and existing Apply actions.
- [x] Run component tests, full suite and production build. Verify native Chrome capture and restart persistence in an isolated profile. Record the one-unit channel difference and the untested desktop/Windows limits before the requested branch integration and release.
