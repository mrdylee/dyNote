# Markdown editing, context menus and side panels

User scope: accessible font properties while writing Markdown, working right click and adjustable left/right panel widths.

## Reference evidence

REA analyzed installed `/Applications/Obsidian.app/Contents/Resources/obsidian.asar` (bundled version **1.12.7**, SHA256 `2b2483b2e1246772e0d25367ec055cbc5047ea2f0091b667c35656678f86d712`). Parent `ev_5037e6af05086d41f5a8cacda57c77b283e6f4b69f9561927a06bce861af326b`; asset view `ev_80ca2f07941a8f223500f425ea4538dd06ec82f68835c8f7e0af0d90b11878e2`.

Static code identifies separate interface/text/monospace fonts and live CSS updates; editor formatting submenu; left/right drag resize and serialized width. Native menus default on macOS. This is static evidence with partial semantic coverage; no Obsidian runtime behavior is claimed. Prior updated synthetic1.14.5 is a different target.

## Implementation and acceptance

- FONT: writing toolbar opens existing device font/size/line-spacing settings. Portable Markdown bold, italic, strike and code commands share toolbar, shortcuts and native menu; preserve selection and CodeMirror undo history. No arbitrary HTML font styling. Existing global font preferences keep their presentation-only behavior.
- CONTEXT: main window native menu supplies standard edit roles, editor history/formatting and font settings. Normal form controls retain native history; reading context disables cut/paste. This scope covers editor/general edit actions, not full Obsidian file-menu parity.
- PANELS: draggable, keyboard accessible vertical separators; opposite resize directions; bounded widths reserve center space; persist device preferences; hide/reopen/tab switch preserve widths; pointer cancellation ends resizing; double-click resets either panel.

## Verification

- New regression tests: `tests/markdown-format.test.mjs`, `tests/context-menu.test.mjs`, `tests/panel-widths.test.mjs`:13 tests covering Korean selection, nested styles, boundary whitespace, multiselection, undo/redo, backtick fences, read-only guards, native menu routing and malformed/narrow-window widths.
- `npm test`:246 passed, zero failures/skips. `npm run build`:passed (existing bundle size warning).
- `scripts/verify-editor-usability.mjs`:actual isolated Mac Electron source app; toolbar and keyboard formatting, rendered bold, native menu after actual right click, native-menu formatting/undo, direct font settings, panel pointer/keyboard/cancel/hide/tab/narrow-window/restart/reset, and font persistence. No renderer errors.
- Existing `scripts/verify-editor-tools.mjs`:Outliner move/undo/fold and Mermaid20-family insertion/render regression passed.
- Receipts/screenshots:ignored `output/playwright/editor-usability.json`, `editor-usability.png`; source logs under `/private/tmp/dynote-editor-*`.

Native clipboard role invocation is wired but full system clipboard round-trip remains unverified: automatic approval review rejected reading or replacing the user's existing clipboard without explicit authorization. The final runtime script excludes clipboard access. No Windows execution, installed-app replacement or release publication is claimed.

Unrelated concurrent Planner changes and original untracked HANDOFF.md were preserved.
