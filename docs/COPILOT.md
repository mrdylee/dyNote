# Copilot in Dynote

관리자가 회사 Git 채널을 배포한 Local PC에서는 오른쪽 Copilot 탭으로 Cloud PC에 질문할 수 있습니다. [Cloud Copilot Ask 사용 안내](CLOUD-COPILOT-BRIDGE.md)

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

## 스크린샷 검토

GitHub Copilot에 직접 연결된 패널의 질문창에 이미지를 붙여 넣으세요
(Windows `Ctrl+V`, macOS `⌘V`). PNG·JPEG·WebP 한 장을 첨부할 수 있습니다.
미리보기 옆의 ×로 첨부를 지울 수 있습니다. 모델 목록에서 **이미지 지원** 표시가 있는
모델을 선택하고 질문을 보내세요. **Ask**와 **Agent**에서는 이미지만 보내도 검토를 요청합니다.
**Edit**에서는 이미지와 함께 문서에서 수정할 내용을 입력하세요.

## 문서 첨부와 최근 대화

질문창에서 `#문서명`을 입력한 뒤 목록을 클릭하거나 위·아래 키와 Enter로 선택하면 현재 보관함의 참고 문서로 첨부됩니다. Esc로 목록을 닫을 수 있습니다. 한 번에 참고 문서 다섯 개까지 보낼 수 있습니다.

직접 연결 Copilot에서 **⋯ → 최근 대화**를 열면 현재 보관함의 대화를 다시 볼 수 있습니다. 앱을 재시작한 뒤에도 이어서 질문할 수 있습니다. 다시 연 대화는 **Ask · 문서 없음**으로 시작합니다. 이미지 이름은 기록되며, 이미지를 다시 검토하려면 원본을 다시 붙여 넣으세요.

답변 아래의 **복원 지점 → 대화 복원**을 누르면 해당 질문과 답변까지 남습니다. 이후 대화는 최근 대화 기록과 다음 질문에 전달하는 대화 내역에서 제외됩니다. 노트와 초안은 그대로 유지됩니다.

**⋯ → Skill · MCP 관리**에서 Skill 폴더나 MCP 설정 JSON을 등록합니다. 등록된 경로와 MCP 서버 이름을 확인하고 연결을 해제할 수 있습니다. 설정은 이 PC의 Agent 연결에 적용되며, 해제한 원본 파일은 유지됩니다.

## 프로젝트 코드와 터미널

로컬 Copilot 패널의 **Agent → 코드 프로젝트 선택**에서 작업 폴더를 엽니다. 파일 이름과 원하는 변경을 입력하면 Copilot이 프로젝트를 읽고 새 파일이나 수정할 코드 조각을 표시합니다. **코드 적용**을 누르면 해당 파일에 저장됩니다.

빌드나 테스트를 요청하면 프로젝트 경로와 터미널 명령이 나타납니다. **명령 실행**을 누르면 현재 사용자 권한으로 실행하며, Copilot은 출력을 읽고 작업을 이어갑니다. 명령에는 프로젝트 밖에 영향을 주는 동작도 포함될 수 있으므로 실행할 명령을 확인하세요. **거절**은 해당 작업만 취소합니다. **프로젝트 해제**를 누르면 다음 요청에서 프로젝트 도구가 빠집니다. 대화 복원은 이미 적용한 코드와 실행한 명령에 영향을 주지 않습니다.

## Ask and revise

- **문서 없음:** excludes the current note. Explicit attachments and optionally
  allowed vault search/read still apply in Copilot.
- **현재 문서:** also sends the open Markdown note, including unsaved edits.
- **선택 영역:** sends only selected text from the source/Live Preview editor.
  It does not send the rest of that note. Explicit attachments and optionally
  allowed vault search/read can provide other notes.
- **Ask (질문):** displays a streamed text response.
- **Edit (수정 제안):** asks for replacement Markdown for the selected scope. Review
  **변경 내용 확인**, then click **문서에 적용**. The normal editor undo command
  can undo this edit. Applying uses local autosave and the existing Git schedule.
- **Agent (문서 작업)** (Copilot): reads the current snapshot, then applies each
  completed append/prepend/replacement or new-note tool operation to a live draft. Ask
  “현재 문서 끝에 시험 체크리스트를 추가해 줘” or “참고 문서를 요약해서 새 문서로 만들어 줘”.
  The center editor shows changes in green before the answer finishes. This is
  completed-tool streaming, not token-by-token text animation. **변경 유지** saves
  the draft; **변경 되돌리기** discards it. Use these buttons to resolve Agent
  changes. **원본·초안 비교** shows the original and AI draft. New notes also
  preview in the center editor before Keep creates the file.
- **참고 문서:** search by name and attach up to five Markdown notes.
- **보관함 검색·읽기 허용:** off by default. When enabled, the Agent can search
  note names/content and read additional vault notes. Search snippets and read
  content are transmitted to Copilot. Tool progress lists the work performed.

Agent mode stages changes; it never writes note files autonomously. New-note creation
rejects existing paths. Markdown replies render formatting and code blocks;
remote images and navigation links are not activated. Markdown tables render in the chat. Completed fenced `mermaid` blocks render as sanitized SVG diagrams; while streaming they remain code. Invalid diagrams stay as readable source with a syntax hint.

**Enter** sends the question; **Shift+Enter** inserts a newline on Windows and macOS. IME composition Enter does not send. Agent/Ask/Edit and model selection (including Auto when available) are compact controls below the input. **중지** cancels an active response and keeps
the prompt. Completed Agent edits remain available after Stop or an error.
Agent mode retains conversation/drafts when switching notes;
Ask/edit mode clears them. Switching vaults or changing the context scope starts
a new conversation. Closing the right panel cancels
its pending operation; pending drafts remain accessible in the center editor.
Saved direct Copilot conversations are available from the recent conversations menu.

Pending Agent drafts are journalled in local app storage, outside the vault and
Git, and recovered when the same vault reopens. Resolve them before sending
another request, changing vaults, reloading, renaming, deleting or restoring notes.
Ordinary notes retain local autosave. Keep uses the existing Git backup schedule.
Typing in a pending draft stops further AI application and preserves your edits.
Destructive Undo is disabled in that case; choose Keep or **복구본 저장**.
If a disk revision conflicts, Keep cannot overwrite it. **복구본 저장** creates
a separate note containing the current draft, AI draft and original, and restores
the source view from disk. The recovery journal is limited to 2 MiB; if storage
fails, the app reports it and retains the in-memory draft. Resolve it before closing.
For Edit mode, changed buffers still require a new proposal.

Context is limited to 64 KiB, prompts to 8 KiB, retained dialogue to 32 KiB and
answers to 128 KiB. Oversized input is rejected, not silently shortened.
Attached notes have a combined 128 KiB limit. The note tools in an Agent request allow up to
24 tool calls, 256 KiB of reads and five distinct draft documents. Cumulative
emitted draft content totals at most 256 KiB, including repeated edits.
Model availability, quota and organization policy are controlled by GitHub.
Requests use the connected account's Copilot allowance. This is cloud inference;
the chosen text and dialogue are transmitted to Copilot when sent.

## Implementation and verification

`@github/copilot-sdk` is pinned to 1.0.23 with runtime 1.0.100. Its SDK account-flow
API is currently marked experimental. Agent sessions expose the four Dynote note tools and any explicitly registered skills and MCP servers. The selected JSON controls which tools each MCP server exposes. Ask and Edit use the supplied context. Project-enabled Agent sessions expose the SDK file viewer and shell plus Dynote’s reviewed code creation and editing tools in the chosen folder. Other sessions use the private runtime workspace. Automatic configuration discovery stays disabled.
The four tools use `skipPermission` because they only read explicitly permitted
snapshots or stage drafts. Actual note writes still require Keep (Agent) or
reviewed Apply (Edit), and use the vault's path, exclusive-create and revision checks.

Desktop sign-in uses the SDK's `copilot-cli` client mode because SDK 1.0.23
forcibly disables the OS keychain in `empty` mode. Dynote explicitly sets the
restricted session defaults and clears installed plugins for both login and
chat sessions. It still rejects plaintext credential storage.

SDK sessions are temporary and deleted after each request. Dynote stores direct-panel conversation history in the app's local user-data directory, scoped by vault. Subsequent questions use bounded dialogue from the open conversation. A runtime crash can leave temporary SDK files in Dynote's application
data directory; these are not included in vault Git backups.

`npm run package:mac`, `package:win`, and `package:linux` include the matching SDK
native runtime outside app.asar. Cross-platform packaging installs the target
runtime in the packager's temporary directory, not the source checkout.

`node --test tests/copilot.test.mjs` covers context bounds, stale proposals,
permissions, streaming, cancellation, OAuth-state handling and cleanup.
`tests/copilot-agent.test.mjs` covers note-tool access and request limits.
`scripts/verify-copilot-tools.mjs` verifies the native SDK offered-tool list and
dispatch without inference. `scripts/verify-copilot-agent-runtime.mjs` checks
attachments, safe replies and multiple pending documents in Electron.
`scripts/verify-copilot-live-edits.mjs` checks live batches, scoped edits,
Keep/Undo/Stop, user typing, disk conflicts, restart and panel-close recovery
with deterministic inference and real vault writes. The opt-in
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
