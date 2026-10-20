# Dynote Copilot panel

The user approved using their own GitHub Copilot subscription, with chat in the
right panel. Use the official Node SDK, not a webview or a VS Code dependency.

## Scope and flow

- Keep the document information panel; add a Copilot tab, selected by default.
- The panel offers GitHub sign-in, connection refresh, a live model list,
  new conversation, prompt input, streaming answer and cancellation.
- Use the SDK account login flow. User authorization happens in their browser.
  Keep authentication inside the runtime and its OS credential store; do not
  accept tokens in the renderer, note files or Git backup configuration.
- Context is explicitly none, current Markdown document or selected editor text.
  Show the target filename. Limit context to 64 KiB, prompts to 8 KiB and retained
  chat to 32 KiB. Never silently truncate selected notes.
- A separate "수정 제안" mode returns replacement Markdown. Show old and new text
  before the user applies it. Preserve original line endings. Reject application
  if the vault, path or full source buffer changed. Use the existing save queue,
  disk revision checks, recovery and daily Git backup.
- Chat stays in memory in Dynote. Clear it on vault/document context changes.
  Use temporary SDK sessions per request, delete them afterward. No restored
  conversation history, indexing, arbitrary commands, MCP or autonomous editing.

## Boundaries

Run the runtime in an app-owned directory, with explicit empty tool exposure,
denied permission requests and configuration discovery disabled. Do not put the
vault path in the runtime working directory. Use narrow trusted-frame IPC and
allowlisted browser sign-in URLs. Keep renderer network restrictions.

Pin SDK/runtime versions; the account-flow API is marked experimental by the
SDK and must be exercised against the shipped runtime. A missing entitlement,
network failure or quota error must remain visible, with the draft retained.
Authentication is lazy: opening the app does not start login or a model request.

## Verification

Test validation, context isolation, stale edits, CRLF selection mapping, streamed
responses, cancellation during startup, runtime permission defaults and cleanup.
Run the app with an isolated profile, exercise both panel tabs at minimum width,
editor selection, proposal application, undo and external modification conflicts.
Use the real SDK to verify startup/auth status/model-list error handling without
requiring personal credentials. Live account login/model completion needs the
user's browser authorization if no test account is available.

Build a local macOS test app and check the SDK native runtime is included and
can start from the packaged application. Do not claim Windows runtime coverage
from cross-platform source checks. No publishing was requested in this turn.
