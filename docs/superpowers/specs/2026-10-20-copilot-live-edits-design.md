# Copilot live document edits

User approved proceeding after actual VS Code GUI and REA investigation. Implement completed-tool-batch live edits, not simulated token animation. Alternative full token/patch streaming is deferred; existing proposal-after-answer remains only for Edit mode.

Agent emits cumulative proposals per path as each edit tool completes. Renderer overlays drafts in the center editor immediately and highlights the changed range. A request may edit the same note multiple times, but cannot broaden selection scope. Distinct file count and aggregate tool budgets stay bounded.

Drafts keep original content, revision, latest AI text, current editable draft and request identity. They live in a vault-keyed local app journal outside the vault/Git. Keep writes through existing exclusive-create/revision APIs; Undo removes a draft only if no user edits would be lost. Stop/error retain completed draft batches. New requests require pending drafts to be resolved.

User typing cancels further AI application and is journalled. Conflicting Undo is disabled; a read-only original/AI/current comparison and separate recovery-note save preserve all versions. Disk conflicts are checked at each batch and Keep. Switching tabs does not change targets. Closing the panel stops generation while center drafts remain. App close retains the journal; restart recovers pending drafts. Vault switching, rename/trash/reload/restore operations must not discard pending sessions. Independent ordinary notes retain autosave.

Tests: cumulative tool read/edit and bounds, scoped selection/CRLF, real Electron mid-response updates, repeated batches, Keep/Undo/Stop, user typing, disk conflicts, tab switch, panel close, restart recovery, unchanged disk until Keep, and isolated package validation. Windows native IME and actual token cadence are not claimed.
