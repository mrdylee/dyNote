# Selection formatting menu and note highlight implementation plan

Use Superpowers executing-plans for inline execution.

**Goal** · Apply or remove yellow highlighting next to selected Markdown text.

**Architecture** · Extend the existing single-property span parser and rewrite command. A CodeMirror selection tooltip owns its positioning and calls the same formatting commands as the main toolbar.

**Stack** · CodeMirror 6, React, Electron, Node test runner and Playwright.

- [ ] In `tests/text-color.test.mjs`, select a colored bold Korean phrase, apply yellow, inspect rendered output, remove it and undo. Verify the parser rejects extra CSS. Run `node --test tests/text-color.test.mjs` before and after changing `core/text-color.mjs` and `src/editorCommands.mjs`.
- [ ] Register a selection tooltip from `src/selection-toolbar.mjs` in `src/Editor.jsx`. Expose bold, text color, size, highlight and clear. Use CodeMirror selection changes and Escape to control visibility. Give toolbar controls accessible names and style them in `src/styles.css`.
- [ ] Extend `scripts/verify-selection-formatting.mjs` with pointer selection, focused toolbar actions, Escape, saving, restart and preview assertions. Run `npm run build`, the Electron verification and `npm test`. Commit verified changes to the feature branch.
