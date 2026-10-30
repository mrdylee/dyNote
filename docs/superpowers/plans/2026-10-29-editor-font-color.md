# Selected text color implementation plan

Goal: extend the existing Markdown writing toolbar with selected text color, safe persistence and default-color restoration.
Assumption: color belongs to selected document text, not the application theme. Reuse the current branch and preserve all unrelated Planner edits.

1. Write failing regression tests for color-only spans, CodeMirror selection/undo/reset, reading rendering, Live Preview and inert unsupported HTML/code/escapes.
2. Add a narrowly parsed canonical `<span style="color:#rrggbb">text</span>` representation; keep generic HTML disabled. Share range recognition between Markdown and editor grammar.
3. Add color picker/apply/reset to the existing writing toolbar; reuse CodeMirror transactions/history and readonly guard.
4. Verify full tests/build and isolated Mac Electron color selection, save/read/live/reopen/restart/undo/reset. No clipboard access or release publication.
