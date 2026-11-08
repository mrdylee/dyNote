# Copilot and Codex reasoning, Agent, MCP and skills

## Implemented scope

Both right-panel providers now support the four capabilities discussed with the user. This is not general terminal or IDE parity.

| Capability | Copilot | Codex |
| --- | --- | --- |
| Reasoning control | Model-advertised options → SDK `reasoningEffort` | Model-advertised options → `turn/start.effort` |
| Preference retention | Separate preference per provider/model; default sends no override | Same; stale choices resolve to model default and main-process validation rejects unsupported overrides |
| Note Agent | Existing search/read/edit/create note tools | Same four tools through native dynamic-tool requests |
| MCP | Explicit config files → SDK MCP servers and source-qualified tool allowlist | Explicit config files → native per-thread MCP config and native tool allowlist |
| Skills | Selected native skills plus bounded catalog/instruction/resource tools | Bounded selected-skill catalog/instruction/resource tools; ambient native skill discovery stays disabled |
| Document changes | Live pending drafts; Keep/Undo before file persistence | Same editor review and persistence flow |

The shared preference also reaches Planner extraction, independent audit and brainstorming. The audit retains the initial request's effort. No model/provider switch or forced low-effort setting was introduced. Claude remains Ask/Edit with its current runtime default; the adapter rejects an explicit unsupported effort instead of silently ignoring it.

The panel's **MCP·스킬** disclosure provides native MCP JSON-file and skill-folder pickers, connected source names and disconnect actions. Config references persist in app user data. Source config secrets are reread in the main process and passed only to the appropriate native runtime; headers, environment values and service URLs are not returned in panel snapshots. Active AI jobs and native configuration pickers mutually exclude each other in the main process.

Supported config shape is `{"mcpServers":{"name":{"command":"...","args":[],"env":{},"tools":["*"]}}}` for local stdio, or a server with `type: "http" | "sse"`, `url` and optional `headers`/`tools`. Remote transports are adapter-supported but were not exercised against real services in this task. Relative local launch paths/cwd resolve from the selected config file. Neither credentials nor unrelated global CLI configuration are imported automatically.

Selected skill instructions and relative text resources are available. Resource access rejects traversal and symlink escape and is bounded to 64 KiB. The shared bridge scans at most 200 skills/2,048 directories and reports an explicit error rather than silently omitting excess skills. It does not execute scripts; execution-dependent skills need an appropriate configured MCP tool. General shell and external filesystem tools remain excluded.

## REA evidence and findings

1. Shipped Copilot SDK 1.0.23 focused static analysis: parent `ev_c539b083dbeeeb75c0bacd6953fcdf69b1ffe2b5939c7a7c4a3e56d1c8ca5dc3`, artifact digest `b75986b6fb3e3ce055c89b2e2effb1a346418cc4c36cc682e631923d820ebe7a`. Selected `package.json`, `dist/client.js` and `dist/session.js`; unselected dependencies/relationships remain unknown. It confirmed forwarding paths for reasoning, MCP and skill options; runtime execution is established separately below.
2. Before-change installed Dynote ASAR: parent `ev_11233ad7bf49107463a6c329954f09c0aedd0bde661702ba718082feeeda8f41`, SHA256 `e7a0d21f3fc000700873273aba1c25aca01bad103926865d5e9dabfd8152aba0`. Only `electron/codex-controller.mjs`, `electron/codex-rpc.mjs` and `core/copilot.mjs` were analyzed. REA initially rejected ASAR/unpacked integrity mismatches; the explicit `record-and-continue` inspection retained those contradictions as untrusted bytes. Eight unpacked native binaries have archive-declared hashes differing from their observed signed bytes. Packaging signs unpacked binaries after archive creation, but this observation alone does not authenticate every mismatch. Static application/semantic coverage is partial.
3. Native Codex app-server help: `ev_0e3aed837c1518a874a14e3aa95009c767e901c3e0f92fd0d5d2b6ab6d1f9156`, selected executable SHA256 `39acf979729dd290f9a24ee38b2914e036c91b65952872e28ae2a6b88a7db7c1`. Installed version 0.166.0 exports experimental protocol schemas. Help raw output was retained; one rendered-frame budget was exceeded, so this is not an untruncated terminal rendering.
4. Copilot native production-controller replay: `ev_f76b05dee917ae856ed9b8cb05cbab99fe0942a5a9847ba44a3df3c8fae38398`, controlled replay/observed, exit 0, no truncation. Native runtime 1.0.100/protocol 3. Actual native dispatch exercised the exact eight-tool catalog: four note tools, selected MCP echo, native `skill`, and the two selected-skill bridge tools. Selected-only discovery, actual MCP permissions/echo, skill invocation/resource reading, traversal rejection and pending note proposals passed. Runtime fixture uses isolated HOME, disabled keychain and synthetic auth/model/generation; it does not establish live model choice or real service authentication.
5. Codex native production-controller replay: `ev_de7cbe8572d8cab583df89d999a70b830a5d2cd2007a14e0d3a5bb3bf21b583e`, controlled replay/observed, exit 0, no truncation. Seven local backend requests exercised dynamic read→edit, selected skill catalog/instructions/resource, and actual native MCP echo. `low` effort appeared in the native backend request. Subsequent Ask exposed no Dynote/MCP/environment tools; native `request_user_input` remains advertised as in the prior baseline.

Native probing found two important integration constraints. Copilot requires both the MCP/skill options and their source-qualified tool allowlist. Codex's untrusted policy emits a native MCP tool-approval elicitation even with an automatic tool mode. The adapter now accepts only the active Agent's selected-server empty approval form with `codex_approval_kind: mcp_tool_call`; it rejects unknown servers, credential/interactive forms and other approvals. Native `enabled_tools` constrains which server tools can reach this approval path. No blanket approval policy was enabled.

Enabling Codex native skill instruction discovery also exposed unrelated host skill metadata despite the isolated app home. That setting remains disabled. The selected-skill bridge provides the requested functionality without ambient discovery.

REA process observations use sampled process trees, before/after filesystem snapshots and a prelaunch executable digest. They do not establish complete process lineage, syscall-level filesystem activity, atomic OS image binding or live network coverage. Inherited environment observations have their recorded limits. Full records and runnable receipts are under ignored `output/verification/`, including `rea-copilot-extensions-evidence.json`, `rea-codex-agent-evidence.json`, `copilot-extensions.json` and `codex-agent-tools.json`.

Official protocol references: [Codex App Server](https://learn.chatgpt.com/docs/app-server), [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference), [Copilot SDK skills](https://github.com/github/copilot-sdk/blob/main/docs/features/skills.md). Installed runtime probes, rather than current documentation alone, establish compatibility above.

## Validation and local installation

- New tests failed before implementation for missing effort forwarding, unsupported-effort rejection, Codex Agent dispatch, selected skill resources and scoped MCP approvals.
- Full Node suite: 346 passed, zero failures/skips. Production build and diff checks passed; Vite retains its existing large-chunk advisory.
- Native Copilot and Codex controlled replays passed with no paid model inference or private note/capture transmission.
- Native Electron UI checks exercise per-model reasoning lists/persistence/defaults, both capture passes, selected provider retention, source pickers/persistence/disconnect, secret omission, request locks, Codex Ask/Edit/Agent effort forwarding, pending draft/Keep behavior and 240 px reasoning-control layout.
- Final local Mac package: `/private/tmp/dynote-ai-capabilities-package/Dynote-darwin-arm64/Dynote.app`. Strict deep signature verification passed. All 278 source/build/license files matched the workspace byte-for-byte. ASAR SHA256: `04c514a24f6f1b21d70e4feca9d59a5f85330544edfcbadf84111a0aa145c248`. Test outputs, docs, source JSX and session handoff are excluded from the package.

Final-package native UI regressions passed 39 grouped checks: Studio/session 11, provider/effort/Codex Agent 4, live edits 13, Planner draft/review 7, Copilot Agent 4. A stale live-edit script initially looked for file rows while the app's default journal sidebar was open; selecting File List corrected the test setup. No product workaround was added for that failure.

Installed `/Applications/Dynote.app` after normal UI quit and verified its strict deep signature and exact ASAR digest above. Previous app backup: `/Users/james_black/Library/Application Support/Dynote Install Backups/2026-11-01-ai-capabilities-nwk34j1f/Dynote.app`. Installer did not modify user data. Receipt: `output/verification/ai-capabilities-install.json`.

Normal native launch then visibly retained the selected Codex account/model. The real right panel showed Codex Agent, GPT-6.1-Sol, and the reasoning menu populated from that model's live catalog: default (low), low/medium/high/xhigh/max/ultra. Opened the menu and dismissed it without changing the user's preference. Expanded **MCP·스킬** and verified both native-picker buttons are present. No user MCP source or skill folder was chosen on their behalf, and no user note was transmitted.

No public release, new provider login, external-service authentication or Windows runtime verification is claimed.
