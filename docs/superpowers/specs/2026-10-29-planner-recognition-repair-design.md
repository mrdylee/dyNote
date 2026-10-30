# Planner recognition repair

User approved implementation after systematic debugging on 2026-10-29.

Keep existing image/source/answer/board safeguards. Keep the 60-item single-batch parser. A response bounded by the existing 500-item board capacity is validated in batches and reviewed in pages of 60, without dropping rows. Invalid rows and overflow remain explicit failures.

After initial extraction, perform one independent image audit scanning each visual target row. Return atomic source labels and corrected items per target. Locally compare labels to item source text, detect missing and merged labels, and retain initial candidates not represented by the audit rather than silently deleting them. All selected target rows require a human source-comparison acknowledgement before registration. The audit is a second AI observation, not proof of perfect OCR; unresolved issues stay visible.

Show phase (reading / row comparison), elapsed time and whether actual deltas are arriving. Preserve partial initial results on audit failure/cancel; require manual source acknowledgement. Old request events and unmount cannot advance another job. No personal notes are sent: audit context contains only the current capture's extracted labels.

Alternatives: increasing the parser limit alone addresses rejection but not omissions. Cropping and sending each row individually adds more inference requests and image-coordinate handling; defer it unless the two-pass audit fails the supplied-image acceptance checks. Chosen approach uses two bounded requests and explicit human verification.

Success: 60/61/99 response replay preserves every valid item, with pages <=60; 501 and oversized answers fail; missing CV/PD/PV labels and merged PD/PV rows are flagged; source labels retained on audit loss; errors/cancel retain initial review; progress updates on real events. Existing planner regressions pass. The supplied JPEG is tested in an isolated vault, including LCS CV/DV/PD/PV as separate rows, exact Pack dates, review and save. Package and update the local Mac installation with a recoverable backup. No public publication, HEIC expansion, unrelated editor edits or private image/result commits.
