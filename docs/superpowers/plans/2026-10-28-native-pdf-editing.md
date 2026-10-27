# Native PDF annotation implementation

Use superpowers:executing-plans and test-driven-development inline.

- [x] Capture a controlled original PDF++ highlight write and its persisted fields.
- [x] Add failing tests for native highlight content/geometry/color, editing/deletion, unchanged other annotations, invalid/encrypted/signed inputs, stale revision and exact recovery.
- [x] Implement bounded native PDF transformation with official pdf-lib and a narrow serialized Vault PDF replacement with outside-vault recovery and revision check.
- [x] Add validated preview/apply IPC and explicit selection/comment/color/annotation controls. Preview does not write; changing parameters clears it.
- [x] Verify actual Electron highlight/preview/save/reopen/edit/delete and external-change refusal; run existing PDF link runtime and full tests/build.
- [x] Review changes and record exact coverage/limits in the verification ledger.
