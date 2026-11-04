# v0.15.1 review and v0.15.2 verification

The user explicitly requested another review, correction and deployment. This review is bounded to the v0.15.1 journal ergonomics changes and their deletion/state boundaries. No unrelated dirty files or installed application are replaced.

## Findings and fixes

1. **Folder deletion could follow a replaced vault root outside the selected vault.** The v0.15.1 handler validated path components below the stored root, but did not validate the root itself. An isolated native fixture renamed the selected root and put an external link/junction in its place; the old handler returned successful system trash for the outside fixture directory. The fix checks the root realpath before snapshot/trash, resolves the final candidate again, and requires a genuine descendant. Native regression verifies rejection and exact outside bytes, then a successful valid folder operation proves the mutation lock is released after refusal. No real user directory was touched.
2. **Journal controls remained over unrelated views.** The active journal persists while Planner, Graph or an attachment is displayed. Rendering was gated only against the journal feed. Controls now hide in full-screen Planner/Graph/ESS and attachment views. Native tests exercise Planner, Graph and an image attachment; the fixed journal row behavior remains covered by the existing ergonomics scenario.
3. **Help could not be hovered or dismissed with Escape.** Pointer-events and the gap between button and overlay made the explanation disappear when the pointer entered it. Help now accepts the pointer with a transparent gap bridge. Escape dismisses visible hover/focus help; a subsequent hover/focus reopens it. Review of the first fix additionally reproduced swallowing a second Escape after dismissal; the listener now matches only non-dismissed help. A native window-event regression verifies normal handling resumes.
4. **The explanation described an option absent from the actual dialog.** ClassificationReview and JournalClassifier retain the original and copy selected excerpts; there is no original-handling selector. Copy now explains checking the destination path, previewing, and copying while retaining the original journal.

## Reproduction and local validation

- The actual public v0.15.1 Mac app was tested with isolated fixtures: eight expected behavior failures in ten grouped checks, zero renderer errors. The follow-up Esc regression failed against the first v0.15.2 candidate and passed after its targeted fix.
- Final review scenario: 11 checks passed, zero failures/renderer errors, including outside-path refusal and error recovery. Attachment checks wait for the actual attachment view to load before inspecting its controls.
- Full unit suite: 394 passed, zero failures/skips. Dependency audit: zero vulnerabilities.
- Production build and final Mac arm64 packaging succeeded. Strict deep ad-hoc signing and exact package source/bundle comparison passed for 280 files. The existing large-bundle advisory remains.
- All 14 final native Mac package scenarios passed: new review, previous ergonomics, selected regions, threading, journal commands/templates/focus, multi-pane workspace, source/read/live modes, original Outliner/Mermaid, vault spaces/history, Git, deterministic AI review and large Markdown save/restart.
- Release metadata/manifests and the two-platform workflow were parsed and checked. Both Mac arm64 and Windows x64 native jobs must pass before publication. The new review scenario runs on both OSes.

Ignored local receipts are under `output/playwright/journal-review`, `output/verification/v0152-package-mac.json` and `/private/tmp/dynote-v0152-review`. After publication the public tag/commit, all seven re-downloaded assets, GitHub/SHA checksums, ZIP CRC/paths, DMG checksum/signatures and public ASAR identities are independently checked. Public Mac review is rerun from the downloaded app; final evidence is retained under ignored `output/verification/v0152-public-release.json`.

Mac remains ad-hoc signed and not notarized. AI scenarios use deterministic fixtures, not live account login or paid inference. Windows runtime claims come from native Windows CI. User notes/accounts and the installed app are outside this publication task.
