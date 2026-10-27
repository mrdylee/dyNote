# Journal details and word count

Approved native Diarian/core scope: add timestamp insertion, daily rating, past records on the same calendar day, existing-note next/previous commands and word/character counts. Bulk import/date conversion remains a separate subsystem; do not call these additions complete Diarian equivalence.

Original controlled runtime: with Korean Moment locale, timestamp insertion into a non-dated empty document produced `— 10/27/2026 11:22 오후 —\n\n`. The installed program includes the current date for a historical/non-dated note and omits it for today's note; it separates the stamp from surrounding text with blank lines. Default formats are `M/D/YYYY` and `h:mm A`. Native insertion uses one undo transaction and keeps existing cursor/selection text; when no editor is open it appends in edit mode.

Daily rating is the YAML property `daily rating`, range 1–5; removing a rating retains unrelated metadata/prose/comments. Use existing metadata parsing and revision-checked SaveQueue. On-this-day lists earlier years matching the selected month/day from the configured daily-note folder/format; leap-day validity and same-year exclusion are explicit. Next/previous commands choose existing period notes and are disabled outside a recognized note.

Original core word count showed 4 words and 24 UTF-16 characters for `# Hello world\n\n안녕 세상\n😀\n`, with identical counts after adding YAML `title: Metadata`. Native statistics therefore exclude frontmatter, retain Markdown characters and use Intl word segmentation for mixed-language word counting. Other language/token edge cases are not asserted identical without original fixtures.

V-model: fixed-clock timestamp and spacing tests, metadata preservation, leap-day/on-this-day filtering, existing-note navigation and original count fixture -> actual editor insertion/undo, rating save/reopen, historical navigation and status-bar checks. No startup network or full-vault scan is added for these commands.
