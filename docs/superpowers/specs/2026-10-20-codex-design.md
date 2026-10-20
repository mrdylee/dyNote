# Codex in the Dynote right panel

User direction: add Codex beside Copilot in the right panel and install the
result on this Mac. Preserve vaults, local saving and daily Git backup.

Use the official local Codex App Server, not a hosted token proxy. It supports
managed ChatGPT browser authentication, account/model discovery and streaming.
A direct API-key integration would require separate API billing; embedding a
terminal would lose the existing note-context and edit-review workflow.

The panel gains a Copilot/Codex selector. Both use the existing note, selection
and no-document scopes, bounded conversations, cancellation and reviewed edits.
Changing providers remounts the conversation, cancels work and clears context.
Provider model selections are stored separately. No automatic model fallback.

Codex runs from an installed native CLI (minimum 0.144.5), with an app-owned
Codex home and empty workspace outside the vault. Do not import other CLI
credentials/configuration. Use ChatGPT managed browser login and OS keyring
storage. No API keys or tokens cross renderer IPC. Open only allowlisted
OpenAI/ChatGPT HTTPS auth URLs. Report missing CLI or failed login in the panel.

Requests create ephemeral threads with empty environment and dynamic-tool lists.
Disable shell, apps, plugins, hooks, skills instructions, memories, browser,
computer use, web search, image generation and multi-agent features. Deny any
server approval/tool request. Only explicit supplied text is needed; no autonomous
file changes. Use the existing editor/save queue for user-approved replacements.

Validate RPC lifecycle, auth completion/cancel, no token forwarding, request
bounds, response item ordering, errors, timeouts, provider isolation and shutdown.
Probe the actual installed CLI with an isolated profile. Verify the real runtime's
tool surface with a local fixture backend, not a paid model call. Verify packaged
UI, Copilot regression and installed Mac behavior. Live authenticated inference
requires user login and is reported separately.

References: https://learn.chatgpt.com/docs/app-server and the installed CLI's
generated 0.144.5 protocol schema. No GitHub publication requested in this turn.
