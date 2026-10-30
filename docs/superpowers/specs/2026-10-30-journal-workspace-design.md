# Journal workspace and weekly updates

Approved direction: the user requested continued implementation and review using Superpowers on 2026-10-30. Preserve the existing HANDOFF.md and unrelated behavior.

## Document workspace
Drag a Markdown file or tab to a left/right edge to add a pane, up to three distinct documents. Show the drop target before committing the layout; cancel changes nothing. Resizable panes retain independent editors, selections and scroll. The focused pane supplies toolbar, selection and Copilot context. External file drops continue to import attachments. Opening an existing pane focuses it. Closing one never deletes a file. Retain the existing single-document preview and non-Markdown viewers.

## Journal start
Start in a journal feed by default; settings can select last-document restoration. Reuse per-vault date-format, folder and template preferences. New daily settings default to Journal/YYYY-MM-DD.md without changing existing configured journal locations. Show today's entry and earlier records in reverse chronological order with bounded loading. Create today's file on explicit creation or first edit, not by viewing the feed. A midnight rollover refreshes the heading without interrupting an editor. Do not reset the user's workspace on same-vault snapshots.

## Classification
After a journal save, derive suggestions by heading sections and existing folder/topic overlap. Offer a review showing the exact excerpt, destination path and source. No network transmission or file mutation occurs during suggestion generation. Users can change paths, exclude entries and confirm selected entries. Confirmation preserves the source journal and inserts verbatim excerpts with source links into separate Markdown notes. Use source-path and excerpt-digest markers in destination files to avoid repeated identical inserts. Changed excerpts are visibly appended as additional versions only after confirmation; existing derived text is never overwritten. Compare source and target revisions and reject stale previews. Applying one suggestion is a recoverable, revision-guarded mutation. Unknown topics remain unclassified until the user chooses a destination. Preserve relative links in excerpts by resolving them from the source document and emitting links valid from the destination.

## Weekly updates
Persist enabled, background-download, prerelease and last-successful-check settings in the main process. Check after seven days while running, on startup and after sleep; manual checks bypass the interval. Retry failures with bounded delay. Select only newer releases having an asset for the exact OS/architecture/channel. Download to application cache, verify SHA256, then report completion; discard corrupt/partial files. Never alter vault data.

Existing ZIP distributions have no installer: downloaded archives are labelled manual-install and offer their containing folder. This implementation covers weekly checks, background downloads and readiness notifications. Automatic application replacement requires a separate installer/signing distribution change. A release without a trusted SHA256 digest offers the official release page instead of verified readiness.

## Validation
Node tests cover pane limits/placement/focus/cancellation state, journal startup settings, source preservation/deduplication/stale source and target/link relocation, exact asset selection, seven-day scheduling and download-integrity failures. Isolated Electron runtime covers drag targets, multiple live editors, journal restart/settings, confirmation/exclusion and update settings. Run the complete existing suite and production build, inspect the diff and record remaining platform/distribution limits. No public release is authorized.
