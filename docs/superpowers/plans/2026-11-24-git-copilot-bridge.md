# Git Copilot Bridge Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for continuous inline implementation. Steps use checkboxes to track verification.

**Goal:** Submit one question from the Local Copilot panel and recover its signed Cloud response.

**Architecture:** A managed role selects the Local client or Cloud worker. A private Git cache exchanges signed JSON records. A Cloud claim precedes use of the existing Copilot controller.

**Tech Stack:** Electron IPC, React, Node crypto, Git CLI, existing Copilot SDK.

- [x] Exercise the transport with a temporary bare repo, two role keys and an injected answer function in `tests/cloud-bridge.test.mjs`. Verify the request prompt, answer, duplicate claim, forged packet and restored client.
- [x] Implement signing and fixed-ref transport in `electron/bridge-git.mjs` and job lifecycle in `electron/cloud-bridge.mjs`. Persist the local receipt before push and the worker result before publication.
- [x] Load the managed policy in `electron/main.mjs`. Give the sandboxed renderer only scoped job status and Ask submission through `electron/preload.cjs`. Guard all Direct Copilot IPC on managed Local PCs.
- [x] Mount the Ask view in `src/CopilotPanel.jsx` for managed clients. Display the persisted question, job status, final response and recoverable connection errors. Keep the existing Direct routes on Cloud PCs.
- [x] Document provisioning and test the build, targeted regressions and real Git integration. Keep live company acceptance separately identifiable.
