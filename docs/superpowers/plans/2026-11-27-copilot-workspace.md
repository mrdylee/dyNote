# Copilot workspace implementation plan

Use superpowers:executing-plans for continuous inline implementation.

**Goal**  Attach notes from the prompt, resume vault conversations, restore Copilot work by turn and manage local Agent extensions.

**Architecture**  Keep the React composer and existing extension IPC. Store chat turns and change records under Electron userData by vault. Reuse the vault's revision-checked batch writer and trash storage.

**Tech stack**  React, Electron IPC, Node filesystem and test runner, Playwright Electron.

- [x] Connect the caret token in src/CopilotPanel.jsx to the existing references array. Verify Enter selects before sending and Escape preserves ordinary text.
- [x] Surface aiExtensions, aiImportMcp, aiAddSkills and aiRemoveExtension in the panel. Exercise file picker cancellation and connection removal.
- [x] Add a serialized Electron history store with atomic writes. Record user turns before dispatch, persist terminal replies and list by vault. Verify reopen and isolation using temporary directories.
- [x] Capture touched paths on reviewed edits and staged Agent proposals. Track Keep and Undo so restoration can distinguish saved notes and local drafts. Compare the current version with the AI version before applying changes.
- [x] Show a per-question restore preview with explicit conflict choices. Use revision checks, recoverable trash and the existing draft journal. Truncate the selected dialogue only after successful restoration.
- [x] Run Node tests with real disposable vaults, build the application and run the Electron composer flow with deterministic model transport. Verify the actual panel controls, recent conversation reopening and a restore.
