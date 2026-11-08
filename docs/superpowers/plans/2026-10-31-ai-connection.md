# AI connection repair

Goal: Provider selection checks the CLI, and a disconnected provider exposes login and retry actions directly in the panel with unambiguous provider names.

Evidence: Running installed 0.12.2 shows Codex disconnected, a hidden ChatGPT login action, and the combined ChatGPT Codex message. Native Codex 0.166.0 returns an unauthenticated status and successfully starts/cancels browser login in an isolated profile. Local npm Claude is 1.0.127 and cannot meet the existing minimum version.

Scope: Preserve the existing per-app account authentication and controller transports. Keep provider selection as a status check, followed by a visible login action. Do not unexpectedly open browsers on every provider switch.

1. Add failing provider-name/error regressions and an Electron auth workflow check.
2. Expose login/recheck next to the authentication blocker, show checking from initial mount, invalidate authentication on status failure, and name Codex authentication consistently.
3. Verify cancellation, failure/retry, auth-completion refresh, model availability, stale auth invalidation and retained prompt using isolated UI fixtures. Re-run provider Ask/Edit and account-layout checks.
4. Run unit tests/build and native Codex login-start/cancel without exposing URLs/tokens or sending note contents. Document the distinction between transport verification and real account/model verification.
