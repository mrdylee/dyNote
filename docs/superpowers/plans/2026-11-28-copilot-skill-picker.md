# Copilot skill picker implementation plan

Use Superpowers executing-plans inline. Implement one explicitly selected registered skill per direct Copilot Agent request with React, Electron IPC and the existing SDK integration.

- [x] Add failing controller coverage in tests/copilot-extensions.test.mjs for explicit instructions reaching sendAndWait and rejection after unregistration.
- [x] Reuse the registered skill scan from electron/ai-skills.mjs in the picker IPC and request controller. Validate the selection in core/copilot.mjs.
- [x] Extend the Electron workspace test to select, remove and send a skill, check one-turn consumption, and retain document mention coverage.
- [x] Extend src/CopilotMentions.jsx and src/CopilotPanel.jsx for selection and feedback. Store the sent name with its turn in electron/copilot-history.mjs.
- [x] Build, run Copilot and preload tests, run the Electron workspace and composer checks, and inspect the final diff.
