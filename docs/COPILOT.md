# Copilot in Dynote

Open **AI 채팅** in the right panel to use **GitHub Copilot**. The sparkle button in the document
toolbar opens it again when the panel is closed. The document outline and
backlinks remain available under **문서 정보**.

## Connect

Click **GitHub로 연결**, then finish authorization in your browser with the
GitHub.com account that has Copilot access. Dynote uses the official Copilot SDK
and the account's available model list. It does not ask you to paste an API key.
The panel checks for saved credentials when opened. Use its refresh button to
retry a failed connection.

The SDK manages OAuth and the operating system credential store. Dynote refuses
the SDK's plaintext-storage consent fallback. Authentication is stored outside
the note vault, separately from Git backup settings. This version supports
GitHub.com sign-in, not the SDK's Enterprise Cloud or Entra login paths.

## Ask and revise

- **문서 없음:** excludes the current note. Explicit attachments and optionally
  allowed vault search/read still apply in Copilot.
- **현재 문서:** also sends the open Markdown note, including unsaved edits.
- **선택 영역:** sends only selected text from the source/Live Preview editor.
  It does not send the rest of that note. Explicit attachments and optionally
  allowed vault search/read can provide other notes.
- **질문하기:** displays a streamed text response.
- **수정 제안:** asks for replacement Markdown for the selected scope. Review
  **변경 내용 확인**, then click **문서에 적용**. The normal editor undo command
  can undo this edit. Applying uses local autosave and the existing Git schedule.
- **Agent · 문서 작업** (Copilot): reads the current snapshot, then prepares
  append/prepend/replacement or new-note proposals using Dynote tools. Ask
  “현재 문서 끝에 시험 체크리스트를 추가해 줘” or “참고 문서를 요약해서 새 문서로 만들어 줘”.
  Review each proposal, then apply or discard it. New notes open in the center
  editor. Existing document edits support the normal editor undo command.
- **참고 문서:** search by name and attach up to five Markdown notes.
- **보관함 검색·읽기 허용:** off by default. When enabled, the Agent can search
  note names/content and read additional vault notes. Search snippets and read
  content are transmitted to Copilot. Tool progress lists the work performed.

Agent mode stages changes; it never writes files autonomously. New-note creation
rejects existing paths. Markdown replies render formatting and code blocks;
remote images and navigation links are not activated.

Ctrl/Cmd+Enter sends the question. **중지** cancels an active response and keeps
the prompt. Agent mode retains conversation/proposals when switching notes;
Ask/edit mode clears them. Switching vaults or changing the context scope starts
a new conversation. Closing the right panel cancels
its pending operation. Conversations are not restored after reopening.

If the buffer changed while Copilot was answering, request a new proposal.
External disk changes still trigger Dynote's normal conflict protection: they
are not silently replaced. Keep/copy the unsaved draft and resolve the conflict
before refreshing.

Context is limited to 64 KiB, prompts to 8 KiB, retained dialogue to 32 KiB and
answers to 128 KiB. Oversized input is rejected, not silently shortened.
Attached notes have a combined 128 KiB limit. An Agent request allows up to
24 tool calls, 256 KiB of reads and five proposals totaling up to 256 KiB.
Model availability, quota and organization policy are controlled by GitHub.
Requests use the connected account's Copilot allowance. This is cloud inference;
the chosen text and dialogue are transmitted to Copilot when sent.

## Implementation and verification

`@github/copilot-sdk` is pinned to 1.0.23 with runtime 1.0.100. Its SDK account-flow
API is currently marked experimental. The runtime runs outside the vault with
only the four Dynote tools in Agent mode (no tools in Ask/edit), rejected
generic permission requests, no configuration/skill/hook
discovery, no host Git context or shared session store. Dynote exposes no
arbitrary filesystem or command tools to the model.
The four tools use `skipPermission` because they only read explicitly permitted
snapshots or stage drafts. Actual writes still require the panel's reviewed apply
action and go through the vault's path, exclusive-create and revision checks.

Desktop sign-in uses the SDK's `copilot-cli` client mode because SDK 1.0.23
forcibly disables the OS keychain in `empty` mode. Dynote explicitly sets the
restricted session defaults and clears installed plugins for both login and
chat sessions. It still rejects plaintext credential storage.

SDK sessions are temporary and deleted after each request. Dynote holds its
visible dialogue in memory, and sends that bounded dialogue for subsequent
questions. A runtime crash can leave temporary SDK files in Dynote's application
data directory; these are not included in vault Git backups.

`npm run package:mac`, `package:win`, and `package:linux` include the matching SDK
native runtime outside app.asar. Cross-platform packaging installs the target
runtime in the packager's temporary directory, not the source checkout.

`node --test tests/copilot.test.mjs` covers context bounds, stale proposals,
permissions, streaming, cancellation, OAuth-state handling and cleanup.
`tests/copilot-agent.test.mjs` covers note-tool access and request limits.
`scripts/verify-copilot-tools.mjs` verifies the native SDK offered-tool list and
dispatch without inference. `scripts/verify-copilot-agent-runtime.mjs` checks
Electron UI/storage with deterministic inference. The opt-in
`scripts/verify-copilot-agent-live.mjs` checks actual model tool use with synthetic
text only; it requires an explicitly selected, already-connected profile.
`scripts/verify-copilot-runtime.mjs` exercises real Electron, the actual bundled
SDK startup/auth-status path, and deterministic chat responses injected only in
the test process. Those injected responses do **not** prove live model access.
The account authorization/model round trip requires a user-authenticated check.
No Windows native execution is claimed by the macOS runtime checks.

`scripts/verify-copilot-keychain.mjs` checks the native credential-store path
with disposable synthetic data in an isolated SDK profile. It reproduces the
old mode's failure to use the keychain, verifies the desktop mode's keychain
round trip, and removes the synthetic entries. It does not use account tokens
or authorize a GitHub account.

Sources: [SDK](https://github.com/github/copilot-sdk),
[authentication](https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate).
