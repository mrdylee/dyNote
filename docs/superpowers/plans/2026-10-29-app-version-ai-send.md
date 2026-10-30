# App version and AI send availability

User expectations: see app version; typing a prompt must not leave a silently disabled send control. The current visible note is the default AI context and follows note switches.

Observed actual Mac app: authenticated account, Auto model, nonempty prompt; no loaded vault/note because the recorded temporary vault no longer exists. Keep the vault/auth/data-loss safeguards.

1. Reproduce a missing-vault send button with absent explanatory status; use isolated real Electron plus deterministic transport, no live prompt submission.
2. Expose package version on clickable titlebar badge and explicit About text.
3. Derive and display actionable send-block reason, connect missing-vault action to existing folder picker, retain current-note context. Choose advertised Auto if saved model absent; preserve valid explicit model.
4. Keep pending-draft protection for writing modes, let Ask read the current note while unaccepted drafts exist. Validate context before submission; preserve prompt on blocked/failure.
5. Run unit/full tests/build and real Mac missing-vault->folder recovery, current-note send/switch, model/error states, Ask versus Agent draft behavior and version UI.
