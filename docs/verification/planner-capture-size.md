# Planner capture size and progress — 2026-10-29

The planner rejected screenshots above 6 MiB before importing them, even though vault attachments support 25 MiB. If Copilot was disconnected or no vision model was available, importing a smaller capture stopped without explaining why recognition had not started.

## Change

- Keep the existing 25 MiB original-attachment limit and the existing 6 MiB AI image limit. Original attachment bytes are preserved.
- Validate image decoding before import. Images already within the AI limit are transmitted unchanged. Larger images are re-encoded at their original dimensions: PNG first, then JPEG at descending quality down to 0.8. If that cannot fit, show an instruction to crop the relevant schedule area; do not silently reduce dimensions.
- Show preparation/connection progress, a GitHub connection instruction, and a visible error when no image-capable model is available. Recognition is disabled for unauthenticated accounts.

## Verification

- Before the fix, the new Electron check failed waiting for the missing disconnected-account instruction. A separate run reproduced the exact 6MB rejection with a synthetic large PNG.
- `scripts/verify-planner-capture.mjs`: six grouped checks pass in actual macOS Electron with an isolated synthetic vault and mocked Copilot transport. Covers disconnected/no-vision feedback, unchanged small-image transport, large capture, exact original file bytes, bounded AI payload accepted by `prepareRequest`, original dimensions, schedule registration and invalid/over-25MiB errors. No renderer errors.
- Large fixture: 9,711,446-byte PNG -> 2,926,691-byte JPEG; both 2400 x 1400. This is transport/registration evidence; the inference response is a deterministic fixture, not a live OCR accuracy measurement.
- `scripts/verify-planner.mjs`: all ten existing grouped Electron flows pass, including real clipboard paste, selective registration, duplicates, edits, brainstorming, drag/undo, restart, conflicts and vault switch.
- `node --test tests/planner.test.mjs tests/copilot.test.mjs`: 26 pass. Final `npm test`: 242 pass, zero failures/skips, including the concurrent editor/panel tests after those changes settled.
- Production build passes with the existing chunk-size warning. `git diff --check` passes.

Evidence: `output/playwright/planner-capture/runtime.json`, `large-review.png`. Installed apps and public releases were not replaced by these source/runtime checks. Concurrent editor/panel changes are separate from this fix.


## Follow-up: small screenshots ignored after sidebar navigation

Reproduced on 2026-10-29: clicking the sidebar planner button leaves keyboard focus on that button, outside the planner section. The old section-only paste handler therefore never receives the paste. The previous clipboard test clicked the planner heading first and masked this case.

The planner now listens for image paste on its window while mounted, ignores text inputs/editable elements and open dialogs, and removes the listener on unmount. The new test first failed at the sidebar-paste step before the fix and now passes without clicking the planner body.

- Final full suite: 246 pass, zero failures/skips. Build and diff checks pass.
- Actual packaged macOS app: eight capture checks pass, including real clipboard paste immediately after sidebar navigation, input/dialog exclusion, listener cleanup, unchanged small image, compressed large image, exact source bytes and registration. Existing ten planner workflow checks also pass. No renderer errors.
- Strict deep code-signature verification passes. Installed app.asar SHA256 equals the tested package: `a5168bec2ab81c1ecbf3b085ab22f3a9c12d5e7142e37e7242b61dffd8e45306`.
- Updated `/Users/james_black/Applications/Dynote.app`; previous installation preserved at `/Users/james_black/Applications/Dynote-backups/20261029-planner-paste-k6xqbkh2/Dynote.app`. Old running installed/downloaded copies were closed after their UI showed saved state. Source includes the concurrent editor/panel changes validated by the full suite.
- Actual installed app relaunched, PID 79947 verified, new capture instructions observed in its planner. Existing notes/settings and OS security settings were preserved. No public release was published.

The user's actual Mac profile points to the missing `/private/tmp/open-notes-ui-vault-20261019` vault. Both older running app windows showed that missing-vault error. The updated app still needs the user's real notes folder; do not recreate the old temporary fixture or guess a personal vault path. The installed app's chat UI completed initialization and showed a connected Copilot account. A separate Node-based live-vision probe reported unauthenticated and stopped before any image request; it does not verify installed-app inference. No new live OCR success is claimed.

Packaged evidence: `output/playwright/planner-capture-packaged/runtime.json`, `installation.json`, and `output/playwright/planner-focus-packaged/`. Pending user input: affected environment confirmation and real vault path.


## Recognition review repair — 2026-10-29

Implemented after the supplied reference exposed a valid 99-item response being rejected by the single-batch 60-item parser, incomplete/merged recognition, and unreported stream activity.

- Retain the single-batch 60-item parser, existing 500-item board cap, 6MiB image and 128KiB answer bounds. Validate larger responses in batches and show at most 60 review entries per page. Invalid rows and aggregate overflow remain visible errors; no silent truncation.
- Independently audit the original image row by row after first extraction. The second request receives only this capture's candidate labels, not vault notes. Locally compare inventory labels against separate items; flag missing/merged labels, retain unmatched initial candidates, and require source-row acknowledgements before registration.
- Show reading/audit phases, elapsed seconds and actual delta activity. Audit error/cancel retains editable initial results. Late request events are ignored.
- Overlapping labels such as item1/item10 or CV-test/CV-test-start use longest matches, preventing false merge reports while still detecting a missing shorter activity.

### Final evidence

- RED: seven new boundary/audit tests and actual Electron missing-progress regression failed before implementation. Follow-up short-label duplication and overlapping-label false merges were each reproduced before their fixes.
- `npm test`: 255 passed, zero failures/skips. Production build and diff checks pass; existing bundle-size warning remains.
- Final macOS package: five new review scenarios, ten existing planner scenarios and eight capture scenarios pass with no renderer errors. These use deterministic inference transports and isolated vaults.
- Supplied JPEG, actual connected Copilot in the signed app: first pass63 -> independent row audit103 -> editable review and Markdown save103, across nine source groups. LCS CV/DV/PD/PV are separate; Pack2/12,3/14–3/23 and4/13 dates checked. Source JPEG remains byte-identical at4032x1692. This is a bounded reference test, not proof of perfect/global OCR completeness.
- Final postprocessing refinement verified by replaying those exact two real responses in the final package: all103 survive, no false merged-label warnings, source confirmation and registration pass. No new inference is claimed for this replay.
- 266 source/bundle files match final ASAR. Strict deep macOS signature verification passes. Final ASAR SHA256: `0901daa8b8fb0c55fabaa92b921c0a470da1b36f4ca8c2effaa0a2489cd79122`. Private images/replies, test outputs, docs and HANDOFF are excluded from the package.
- Local installation receipt: `output/playwright/planner-review-final/installation.json`. Previous app is preserved in its recorded backup. Existing settings, notes and security settings are preserved. No public release/push or Windows runtime verification.

Ignored deterministic evidence: `output/playwright/planner-review-final/`, `planner-existing-final/`, `planner-capture-final/`. Supplied-image responses/screenshots stay outside git under `/private/tmp/dynote-reference-test/repaired/` and `repaired-final-replay/`.

The real user profile still needs a valid vault folder; do not substitute a test vault or recreate the missing old temporary folder. HEIC remains unsupported; use the user-requested JPEG. Two AI passes increase inference time; progress and explicit source review are part of the intended flow. The audit is an independent model observation plus local checks, not a guarantee of exhaustive recognition.
