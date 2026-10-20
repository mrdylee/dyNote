# Copilot in Dynote

Open the **Copilot** tab in the right panel. The sparkle button in the document
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

- **문서 없음:** sends the question and this conversation, without note text.
- **현재 문서:** also sends the open Markdown note, including unsaved edits.
- **선택 영역:** sends only selected text from the source/Live Preview editor.
  It does not send the rest of the note or other files in the vault.
- **질문하기:** displays a streamed text response.
- **수정 제안:** asks for replacement Markdown for the selected scope. Review
  **변경 내용 확인**, then click **문서에 적용**. The normal editor undo command
  can undo this edit. Applying uses local autosave and the existing Git schedule.

Ctrl/Cmd+Enter sends the question. **중지** cancels an active response and keeps
the prompt. Switching documents or vaults clears the conversation; changing the
context scope also starts a new conversation. Closing the right panel cancels
its pending operation. Conversations are not restored after reopening.

If the buffer changed while Copilot was answering, request a new proposal.
External disk changes still trigger Dynote's normal conflict protection: they
are not silently replaced. Keep/copy the unsaved draft and resolve the conflict
before refreshing.

Context is limited to 64 KiB, prompts to 8 KiB, retained dialogue to 32 KiB and
answers to 128 KiB. Oversized input is rejected, not silently shortened.
Model availability, quota and organization policy are controlled by GitHub.
Requests use the connected account's Copilot allowance. This is cloud inference;
the chosen text and dialogue are transmitted to Copilot when sent.

## Implementation and verification

`@github/copilot-sdk` is pinned to 1.0.23 with runtime 1.0.100. Its SDK account-flow
API is currently marked experimental. The runtime runs outside the vault with
empty tool exposure, rejected permission requests, no configuration/skill/hook
discovery, no host Git context or shared session store. Dynote exposes no
arbitrary filesystem or command tools to the model.

SDK sessions are temporary and deleted after each request. Dynote holds its
visible dialogue in memory, and sends that bounded dialogue for subsequent
questions. A runtime crash can leave temporary SDK files in Dynote's application
data directory; these are not included in vault Git backups.

`npm run package:mac`, `package:win`, and `package:linux` include the matching SDK
native runtime outside app.asar. Cross-platform packaging installs the target
runtime in the packager's temporary directory, not the source checkout.

`node --test tests/copilot.test.mjs` covers context bounds, stale proposals,
permissions, streaming, cancellation, OAuth-state handling and cleanup.
`scripts/verify-copilot-runtime.mjs` exercises real Electron, the actual bundled
SDK startup/auth-status path, and deterministic chat responses injected only in
the test process. Those injected responses do **not** prove live model access.
The account authorization/model round trip requires a user-authenticated check.
No Windows native execution is claimed by the macOS runtime checks.

Sources: [SDK](https://github.com/github/copilot-sdk),
[authentication](https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate).
