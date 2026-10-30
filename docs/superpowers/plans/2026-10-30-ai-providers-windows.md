# AI providers and Windows v0.12.0

User authorized implementation, tests and Windows publication; account login with installed CLIs preferred.

## Design

- Preserve existing Copilot Agent, Ask and Edit. Add Codex (ChatGPT) and Claude (Claude plan) for Ask/Edit with the same bounded context, attachments, streaming, cancellation and explicit replacement review.
- Provider selector remounts the panel; isolate histories and model preferences. Disable switching during work, login and unconfirmed edits. Do not expose unsupported Agent/image capabilities.
- Use installed official CLI executables, app-owned account/config directory and empty workspace. No credential import or renderer credentials. Codex uses app-server managed login. Claude uses auth login/status and print stream-json. Reject unsupported old CLI versions with installation guidance.
- No CLI shell/file tools, MCP, hooks or inherited project configuration. Never run requests in the user's vault. Claude model aliases are choices, not an entitlement guarantee; CLI errors surface without fallback.
- Windows release includes the already implemented document comparison, journal, classification and weekly updater. Existing HANDOFF.md is unrelated and excluded.

## Steps and verification

1. Restore/adapt Codex controller and tests; implement installed CLI discovery and Claude adapter using failing tests first. Verify request boundaries, output limits, cancellation, login, version detection and Windows paths.
2. Wire main/preload and provider selector; verify separate models/history, review before writes, stale edits, vault switch/close cancellation. Run all unit tests and build, then isolated Electron UI smoke.
3. Probe current installed runtimes without account/model inference. Document any unsupported local runtime and distinguish fixtures from live inference.
4. Bump to 0.12.0, release notes and native Windows workflow. Commit intended files only; push release branch/tag after local tests. Native CI runs tests, packages and launches Dynote.exe before publishing.
5. Read back public release, download ZIP, compare checksum and archive contents. Report native Windows smoke and limits separately from model/account inference.

## Sources

- OpenAI Codex app-server protocol: https://developers.openai.com/codex/app-server
- Claude CLI flags: https://code.claude.com/docs/en/cli-reference
- Claude plan usage, updated October 2026: https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
