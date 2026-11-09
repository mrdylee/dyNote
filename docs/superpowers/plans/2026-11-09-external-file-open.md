# Readable external files implementation plan

Use the already loaded executing-plans skill for continuous inline work. No subagents.

1. Extend temporary-document tests to Markdown, structured documents, every supported media extension and UTF-8 text. Verify copy fidelity, invalid binary/text rejection, original launch boundaries and existing Word behavior.
2. Generalize the temporary service and IPC; share the existing attachment signature validator. Preserve revisions, bounded reads and cleanup.
3. Reuse read-only format viewers in one external-file preview, generalize menu filters/drop handling and preserve internal drags and attachment paste.
4. Extend native tests for menu/drop, actual Markdown rendering, text escaping, media/structured previews, source refresh and vault/original preservation. Run full unit/build/package/native checks, review and release.

## Local verification

- Full unit suite: 465 passed with no failures or skips. New tests first failed because the generic service was absent, then passed with real temporary files.
- All existing supported attachment extensions, exact copy bytes, UTF-8 text, source launch boundaries, Markdown over 25 MiB and structured/media limits passed.
- Production build and Apple Silicon packaging passed. Packaged source verification matched 292 files.
- Both source and packaged native checks passed rich Markdown, external replacement refresh, escaped text, PNG/PDF/WAV decoding, read-only Canvas/Bases, original/vault preservation and temporary cleanup.
- Word menu/button/drop and internal drag pass-through passed. Daily journal template movement and the broader native tree transfer checks passed.
- Windows/macOS release CI must pass before publication. Actual Microsoft Word editing and Polarion round-trip remain untested.
