# Markdown editing and panel usability implementation plan

Goal: accessible Markdown formatting and font preferences, working context menus and persistent resizable side panels.
Architecture: reuse existing FontSettings and CodeMirror history; native Electron edit menu; small pointer/keyboard separator with bounded per-device preferences.
Assumptions: standard Markdown bold/italic/strike/code; whole-editor font settings remain presentation-only. No arbitrary HTML styling or personal-vault inspection.

1. Add regression tests for formatting/selection/undo/read-only and pane bounds/persistence; observe failures.
2. Implement CodeMirror formatting toolbar and shortcuts; expose existing font settings directly.
3. Attach native context menu with edit roles and editor formatting; preserve selection/focus and editable state.
4. Add accessible pointer/keyboard left/right separators, capture cancellation, double-click reset and local persistence; keep center usable on resize.
5. Run full tests/build and actual isolated Mac Electron checks including clipboard, formatting/undo, both resize directions, narrow window, restart and unrelated editor regression.

REA reference: installed Obsidian runtime static evidence ev_5037e6af05086d41f5a8cacda57c77b283e6f4b69f9561927a06bce861af326b. Static analysis does not prove runtime behavior.
