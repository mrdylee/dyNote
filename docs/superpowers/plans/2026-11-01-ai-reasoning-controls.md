# AI reasoning controls and Agent capability review

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for continuous inline implementation. No subagent work is requested.

**Goal:** Select and retain supported reasoning effort in the right AI panel, and implement the discussed Agent/MCP/skill capabilities for both Copilot and Codex using REA-backed runtime evidence.

**Architecture:** Preserve model-advertised effort metadata in Copilot/Codex status. Store effort preferences per provider/model in the existing shared AI session; include the selected value in chat and Planner requests. Validate against fresh model metadata, then send SDK `reasoningEffort` or Codex `turn/start.effort`; an empty choice preserves the runtime default. A shared main-process registry retains explicitly selected MCP config files and skill folders, and both Agent adapters expose those capabilities beside the existing note-draft tools.

**Tech Stack:** React, Electron, Copilot SDK 1.0.23, Codex app-server, Node tests, Playwright.

## Assumptions and boundaries

- Scope is Copilot and Codex effort selection. Claude continues using its current default; it does not advertise model effort metadata through this integration.
- Only values advertised by the selected model are offered. Remember choices separately across models/providers and renderer restart; an obsolete preference resolves to the model default.
- Keep selected provider/model, account authentication and all prior capture/draft changes.
- Both providers use the existing four-tool Dynote note Agent and explicitly connected MCP/skill capabilities. Validate with local synthetic MCP servers without making external-service calls or importing unrelated desktop plugins.
- Alternatives: hardcoding effort levels would misrepresent some models; changing a global CLI config would affect other applications. Use request-scoped controls instead.

## Execution and checks

1. Add failing transport tests in `tests/copilot.test.mjs` and `tests/codex.test.mjs`: advertised options/default preserved; chosen `low` reaches the native request; unknown/stale effort rejected before a session/turn starts; empty choice sends no override. Run `node --test tests/copilot.test.mjs tests/codex.test.mjs` and confirm the new assertions fail before implementation.
2. Add the bounded optional request field and shared capability/validation helpers to `core/copilot.mjs`; preserve metadata and forward effort in both controllers. Explicit effort on the current Claude adapter must fail clearly rather than silently disappear. Re-run affected controller tests.
3. Update `src/useAiSession.jsx`, `src/CopilotPanel.jsx`, `src/Planner.jsx` and the necessary CSS. Put a labeled effort selector below the model row so the 240 px panel remains usable. Snapshot effort for both capture and audit. Verify with a disposable native Electron profile: correct options per model; persistence per provider/model/reload; default-only model; chat/Edit/Agent and both capture requests; disabled controls while a request runs; narrow panel.
4. Run all unit tests, production build, existing Studio/provider/Agent regressions, native Copilot tool/skill inventory and current Codex protocol metadata checks. Record exact coverage and limitations in `docs/verification/2026-11-01-ai-reasoning-agent-review.md`. Package and install the verified local Mac build with backup, preserving user notes/auth/settings. No public release or push.

## Success criteria

The UI selection reaches real provider request parameters, persists correctly, and never supplies an unsupported effort. The same choice reaches initial capture and audit. Both providers expose Agent, selected MCP tools and selected skill instructions/resources; native runtime dispatch corroborates those capabilities. Unselected/ambient tools remain excluded. Existing drafts and note-edit review behavior remain intact.

## User expansion: REA and both providers' Agent/MCP/skills

The user subsequently requested REA inspection of both runtimes and implementation of all discussed capabilities. The final scope is reasoning controls, note Agent, explicitly connected MCP configurations, and selected skill instructions/resources in both providers. It does not mean general terminal/IDE parity.

- Inspect shipped SDK/installed Dynote adapters with focused REA static analysis and both installed native runtimes with controlled replay. Record evidence type, identity, integrity contradictions and incomplete coverage.
- Add a main-process extension registry for chosen MCP JSON files and skill folders, native pickers, disconnect controls, persistence and mutual exclusion with active AI work. Store references rather than duplicating secrets; never send MCP headers/environment to the renderer.
- Retain the existing Copilot note Agent; add configured MCP/native skills plus bounded relative skill-resource access. Validate native tool inventory and actual dispatch without an account or paid model.
- Add Codex dynamic note/skill tools and native per-thread MCP configuration. Dispatch server-initiated tool calls only to the active Agent's allowlist. Accept the native empty MCP tool-approval form only for selected servers; reject credentials, other interactive forms and unrelated permissions.
- Keep native Codex ambient skill discovery disabled after a probe showed that enabling it exposes unrelated host skills. A selected-skill catalog/resource bridge provides explicit instructions without enabling shell/filesystem tools.
- Expose Agent for Codex and use generic AI draft labels. Verify actual editor preview/Keep, cancellation, per-model reasoning persistence and narrow-panel layout.
- Run all unit tests, provider/Studio/Agent UI regression and native runtime fixtures; then install the verified local Mac package with backup. Public release, real external-service authentication and Windows runtime validation are not claimed.
