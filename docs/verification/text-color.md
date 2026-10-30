# Selected Markdown text color

The writing toolbar now includes a native color picker, color apply and default-color reset. Color is stored in a narrowly accepted color-only span in Markdown. Existing generic HTML remains disabled. Source mode exposes the saved markup; reading and Live Preview render the chosen text color.

Implementation: core/text-color.mjs shares exact six-digit color validation, balanced spans, Markdown rendering and inline grammar. Existing CodeMirror transactions preserve selection and isolated undo/redo. Recoloring an existing complete range replaces its original color. Default reset preserves surrounding plain-text color ranges. Unsupported attributes/CSS, code and escaped markup remain literal.

Verification on 2026-10-29:

- Nine tests in tests/text-color.test.mjs pass: Korean selection, undo/redo, recolor/reset, caret insertion/preservation, readonly/invalid input, partial plain-text reset boundaries, safe rendering, nested colors, code/escape handling, Live Preview syntax visibility and paragraph preservation.
- Fresh npm test:264 passed,0 failed,0 skipped. Production build passed with existing bundle-size warning; git diff --check passed.
- Actual isolated Mac Electron via scripts/verify-text-color.mjs: picker focus preserves selection, chosen exact RGB in split reading and Live Preview, undo/redo, recolor without duplicate spans, reset/undo, exact file bytes and color after app restart. Zero renderer errors.
- Existing scripts/verify-editor-usability.mjs passed: previous toolbar/native menu, fonts and both panel controls/persistence.
- Receipts: ignored output/playwright/text-color.json and text-color.png; /private/tmp/dynote-color-final-tests.log, dynote-color-final-build.log, dynote-color-final-runtime.log and dynote-color-editor-regression.log.

This turn updates source only. It does not replace the installed app or publish a release. No clipboard reads/writes. Concurrent Planner changes remain untouched.
