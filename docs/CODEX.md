# Codex in Dynote

Open **AI 채팅** in the right panel, select **OpenAI Codex**, then click
**ChatGPT로 연결**. Complete browser sign-in with an account that can use Codex.
After connection, choose a model from the account's model list.

Dynote uses the official local Codex App Server. Install Codex CLI **0.144.5 or
newer** first; the app detects Homebrew/PATH native executables and the standard
Windows npm native package location. Restart Dynote after installing the CLI.
The CLI is not bundled into Dynote. The current Mac was verified with 0.144.5.

This integration uses ChatGPT authentication, not an API key. Credentials live
in the OS keyring under Dynote's own Codex home. It does not reuse the Codex
desktop/CLI account or configuration. If the OS credential store is unavailable,
sign-in fails rather than falling back to plaintext credential storage.
Git backup credentials and the Copilot account remain separate.

Use **현재 문서**, **선택 영역**, or **문서 없음** to choose the text to send.
Model requests transmit that text, the question and this panel's conversation to
OpenAI. The account's Codex usage limits apply. No question is sent merely by
selecting a service or checking its connection.

**수정 제안** uses the same comparison, apply and undo flow as Copilot. Changing
services starts a fresh conversation and clears pending proposals; model choices
are remembered separately. Switching is disabled while a response or login is
active. Stop/cancel first. Changing notes clears the conversation.

Threads are ephemeral and run without environment access. Shell, browser,
computer, file editing, agents, external MCP, apps and skills are disabled.
The CLI's internal plan and request-input utilities may remain exposed; Dynote
denies server requests and offers no tool execution or permission grants.
Model text is rendered as text. Only a user-reviewed editor transaction writes
to the vault. The existing stale-content and disk-revision checks still apply.

Verified: native process startup, model discovery, browser authorization URL and
cancellation, actual native protocol streaming against a local synthetic
backend, and Electron context/edit/provider behavior. Actual ChatGPT login
completion and a live account model response have not been verified.
Windows execution has not been verified for this integration.

Official references:
- https://learn.chatgpt.com/docs/app-server
- https://learn.chatgpt.com/docs/auth
- https://learn.chatgpt.com/docs/config-file/config-reference
