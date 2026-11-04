# Journal ergonomics review and verification

## Requested behavior and review

The follow-up requests are a stable journal writing layout, tree file/folder trash actions excluding built-in folders, Live Preview defaults, and a classification explanation on hover. The prior review/fix/publication authorization continues for v0.15.1. Unrelated existing dirty files remain excluded.

The cause of the repeated layout movement was `status === "saved"` gating classification suggestions and conditionally mounting the notice. Real v0.15.0 samples alternated between editor-area top 190.5px and 157.5px during three autosaves (33px movement). The fixed row remains mounted while its action reflects saved suggestions; new samples all measured 201.5px (0px movement). Hover/focus help is absolutely positioned and remains inside a 760px window.

The context menu uses the existing file confirmation/revision/recovery/undo flow. Folder removal uses Electron system trash after flushing saves, locking mutations, validating vault identity and the relative path, and checking every directory component. The confirmation/toast explicitly identify the system-trash recovery route. Pure policy and native checks protect built-in and configured journal/template folders, their containing ancestors, and case variants, while allowing ordinary siblings and individual documents. Review additionally found that the actual attachment root is `_attachments`; a failing regression preceded adding it to the protected list. Symlink/junction, outside-vault, non-directory and stale-vault targets are rejected.

Markdown first-open/reset/add defaults are Live Preview. Per-document explicit view choices survive navigation. Journal feed/creation no longer force source mode; structured documents and explicit editing tools retain their dedicated modes. Native existing journal tests verify creation focus, Enter/Tab hierarchy, templates, exact saves and restart.

## Evidence and local checks

- Unit regressions for first-open/default-mode retention and protected folders failed before the corresponding implementation. Focused final checks: 5 passed. Full suite: 394 passed, zero failures/skips.
- Public v0.15.0 native reproduction: 10 expected behavior failures, including measured layout movement, missing explanation/menu and old view defaults. The baseline dispatches the renderer context event when the new bridge is absent, avoiding the unrelated OS edit menu. The updated app uses actual right mouse clicks.
- New native scenario: 15 grouped checks cover defaults, explicit mode retention, three autosaves, hover/focus/narrow tooltip, menu dismissal, file cancel/trash/undo, protected defaults/configured parents, ordinary folder cancel/system trash, IPC boundaries, exact restart and zero renderer errors.
- The existing three-pane drag scenario read React DOM state immediately after dispatch and intermittently saw zero drop indicators. It now waits for the expected visible indicator before asserting its count; the assertion and behavior coverage remain intact. No production drag behavior was changed.
- Audit: zero vulnerabilities. Production builds succeeded; the existing large-bundle advisory remains.
- v0.15.1 Mac package source/bundle verification matches 280 files and verifies strict deep ad-hoc signing. All 13 native Mac package scenarios passed locally; both release OS jobs rerun the full source, security and native suite before publication. Public evidence is retained separately after re-download verification.

Local receipts/logs are under ignored `output/playwright/journal-ergonomics`, `output/verification/v0151-package-mac.json` and `/private/tmp/dynote-v0151-review`. The public receipt is written to ignored `output/verification/v0151-public-release.json` after publication; source success alone is not publication evidence.

## REA boundary

REA inspected the actual public v0.15.0 ASAR (SHA-256 `2fb09c254c85451521c6b4b12ac0b17069924ee836292ba00c6d424247199d31`) with only `core/journal-sections.mjs` and `core/document-workspace.mjs` selected. Summary evidence: `ev_3aace01fe24e4dca78a04559afdfbb5ae1ccc964d82af637d4d53ae1adea0260`; retained parent: `ev_f71a2db59868e7983a496bb80b2c45eb4178ea021169660f2af7cc0b7e309bd0`. This is static evidence, not execution. Unselected sources remain unknown. ASAR-declared hashes of eight unpacked SDK native binaries differ from the signed companion bytes; record-and-continue retained these explicit limitations. No SDK behavior/integrity conclusion is inferred from this bounded source analysis. Runtime claims come from isolated native scenarios, not the static graph.

Mac is ad-hoc signed and not notarized. AI-provider tests use deterministic fixtures without account authentication or paid inference. The installed application and real user notes/accounts are not replaced.
