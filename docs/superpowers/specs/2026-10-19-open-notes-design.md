# Open Notes v0.1 design

Approved: 2026-10-19. New desktop application, independent of the reviewed open-obsidian repository.

## Scope and assumptions

Build a Korean-first, light desktop notebook: folder selection, nested Markdown files, creation, editing, automatic save, full-text search, wikilinks, backlinks, headings, and a basic interactive graph. macOS is the available execution/packaging target. Windows/Linux build commands are included but must not be described as verified installers. Existing Markdown remains the source of truth.

No ZIP import, plugin runtime, sync/account/server, mobile app, deletion, or original Obsidian plugin compatibility in v0.1. Images render as placeholders, including local images; attachment bytes are untouched. External links open only after an explicit link click through a protocol allowlist.

## Evidence and independence

Static REA inspection used installed Obsidian 1.12.7, not a personal vault. Sources: `/Applications/Obsidian.app/Contents/Resources/app.asar` and `obsidian.asar`. Analysis receipts and complete retained evidence are in `../research/obsidian-1.12.7/`. The real main module yielded two BrowserWindow syntax observations and 42 literal IPC main handlers. The UI bundle contains 195 recovered module candidates. Semantic coverage is partial and UI analysis reached the 12,000-node ceiling. These observations guide separation of responsibilities, not a claim of runtime equivalence. Native-addon integrity contradictions in the bootstrap package were retained as untrusted data. Do not copy proprietary source, CSS, assets, or bundled libraries into the new app.

## Architecture

- `electron/main.mjs`: native directory picker, strict IPC sender validation, private recovery storage, window lifecycle, blocked network/navigation/permissions, custom `notes://app` static protocol.
- `electron/preload.cjs`: context-isolated, sandbox-compatible bridge exposing only snapshot, folder picker, create, save, refresh, recovery folder, and explicit external link opening.
- `core/vault.mjs`: realpath-bounded Markdown-only filesystem operations; skip hidden paths and symlinks; hash revisions; sequential writes; private pre-save recovery copies; same-directory temporary write and atomic rename. Reject external modifications instead of silently overwriting them.
- `core/knowledge.mjs`: safe Markdown parser, wikilink tokens, relative/root/basename resolution, ambiguity detection, backlinks, graph, search, and headings. Parse code as code. Disable raw HTML and remote image loading.
- `src/`: React shell, CodeMirror editor, sanitized preview, file/search navigation, command switcher, graph, metadata sidebar. No Node integration or arbitrary IPC exposure.

## Saving and error behavior

The initial vault is a synthetic example directory inside application data. A native picker is the only way to select another root. Editing queues debounced saves by note path and expected SHA-256 revision. Switching notes retains unsaved buffers. Saving is serialized; another editor's change raises a conflict and preserves the user's draft. Refresh warns about dirty buffers and requires an explicit reload to discard them. Closing flushes drafts, and leaves the window open if saving fails. Recovery copies live in app data, outside the chosen vault. No autosave write may target a root different from the one for which the draft was created.

## Security boundaries

Use contextIsolation, sandbox, no Node in the renderer, no eval, restrictive CSP, denied permissions/popups, IPC main-frame origin validation, and a custom protocol limited to built UI files. Network requests in the application session are canceled. Both markdown-it with HTML disabled and DOMPurify sanitize previews; image tokens produce text placeholders. Only `.md` paths with no dot directories, symlink components, absolute forms, or traversal are readable/writable through the bridge. A malicious local process racing filesystem operations remains outside the intended boundary; Node's path checks do not provide an OS directory-handle sandbox.

## Acceptance

1. Korean notes survive save and relaunch; old content exists in recovery.
2. Path traversal, hidden config writes, symlink reads/writes, and stale revisions are rejected; binary neighbors remain byte-identical.
3. Relative, aliased, heading and ambiguous wikilinks behave predictably; backlinks/graph update after edits; code examples do not create false links.
4. Preview emits no active script, handler, remote image, iframe, or unsafe protocol.
5. A real Electron window opens and supports edit, autosave, note switching, search and graph through native UI interaction.
6. Production build, core/security tests, dependency audit and a local macOS app package are checked. Unsigned packaging is disclosed.
