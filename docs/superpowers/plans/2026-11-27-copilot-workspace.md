# Copilot workspace implementation plan

Use superpowers:executing-plans for continuous inline implementation.

**Goal**  Attach notes from the prompt, resume vault conversations, rewind conversations to a completed reply and manage local Agent extensions.

**Architecture**  Keep the React composer and existing extension IPC. Store chat turns under Electron userData by vault. Rewind only the selected conversation.

**Tech stack**  React, Electron IPC, Node filesystem and test runner, Playwright Electron.

- [x] Connect the caret token in src/CopilotPanel.jsx to the existing references array. Verify Enter selects before sending and Escape preserves ordinary text.
- [x] Surface aiExtensions, aiImportMcp, aiAddSkills and aiRemoveExtension in the panel. Exercise file picker cancellation and connection removal.
- [x] Add a serialized Electron history store with atomic writes. Record user turns before dispatch, persist terminal replies and list by vault. Verify reopen and isolation using temporary directories.
- [x] Keep the selected exchange and remove later turns from the stored conversation and future model context. Verify the viewer still has the expected latest request before truncation.
- [x] Run Node tests with real disposable vaults, build the application and run the Electron composer flow with deterministic model transport. Verify the actual panel controls, recent conversation reopening and a restore.
