# Copilot note agent implementation

Execute inline, following the approved design and preserving the existing keychain fix.

1. Add `tests/copilot-agent.test.mjs`: tool access, selection containment, drafts without writes, unsafe paths, budgets/cancel; run it and confirm failure before adding `core/copilot-agent.mjs`.
2. Extend `core/copilot.mjs` request validation and isolated custom-tool session options. Wire `electron/copilot-controller.mjs` and vault callbacks in `electron/main.mjs`. Verify `node --test tests/copilot*.test.mjs`.
3. Extend `Vault.create` with validated initial content and exclusive creation; test collision and invalid content before changing storage.
4. Extend `src/CopilotPanel.jsx` with Agent mode, attachments, explicit vault access, progress, multiple reviewed proposals and safe Markdown. Extend `src/App.jsx` apply handling using existing save queue/revision checks. Add narrowly scoped CSS.
5. Add native SDK tool-dispatch and Electron runtime verification covering center-document changes, undo, new notes, stale/conflicting edits and unchanged existing chat behavior.
6. Run `npm test`, `npm run build`, package Mac to a new ignored output directory. Verify bundled sources, install with a recoverable previous-app copy, inspect actual installed UI, and record verification limitations. Commit the implementation locally; publication is not requested.
