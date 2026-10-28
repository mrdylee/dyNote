# Original Obsidian plugin runtime

2026-10-28. User approved original-plugin execution support, starting with downloaded Recent Files 1.7.10 and Calendar 1.5.10. This supersedes the native-only architecture for these two exact runtime targets; the existing eleven-plugin native portfolio remains separate.

## Evidence and decision

REA analyzed Obsidian's shipped 1.14.5 app.js and both downloaded main.js/manifests. Loader evidence: `ev_08c14f3c59b2c82c17dff87814b594292c2bb177f664700ff0858093a1f153e1`. Recent Files: `ev_b59a17350330254b5d7e594a9d563d66b8ebb50e772450b9d3374d602f5ca6ae`. Calendar: `ev_6ff013a64bd22fa534fb0348ba1819d8bda444ba6491d6e8e1359715f0203822`. Static coverage is partial; no parse failures. Exact source contexts and full REA bundle stay under ignored output/research/rea-plugin-import. Previous isolated Obsidian execution proves representative commands, views, recent persistence and unload/reload of these exact downloads.

Obsidian reads main.js, wraps CommonJS require/module/exports, constructs the exported Plugin, loads its lifecycle and CSS, then unloads registered resources. Reimplement this boundary independently; do not redistribute Obsidian app.js or modify downloaded plugin source.

Options considered: native equivalents do not satisfy this request; execution inside the main renderer gives plugins unnecessary access to the entire product UI; a separate sandboxed window provides original DOM views and a narrow bridge without changing the main renderer.

## Implementation boundary

Import a user-selected local plugin folder containing manifest.json and main.js, optionally styles.css. Retain byte-identical files under app data. Validate IDs, regular files and sizes; reject symlink programs. The initial runtime supplies obsidian and moment CommonJS modules and observed DOM helpers. Unimplemented imports/APIs fail visibly rather than silently pretending success. No Node, shell, external network or arbitrary filesystem bridge.

One sandboxed/context-isolated window per enabled plugin and vault. A dedicated preload exposes only initialization, plugin data saving, note creation, note opening and runtime state. The window displays the original plugin views/settings and commands. Main commands also appear in Dynote's command palette. Closing the view hides it; disabling unloads it, removes commands and destroys the instance. Quit and vault changes dispose all owned plugin windows. State and data are isolated by vault ID and plugin ID, stored outside .obsidian; private existing plugin data is not imported.

The compatibility model provides file metadata and content, read-only metadata cache, file-open/create/modify/rename/delete events, view leaves, lifecycle cleanup, commands, setting controls, notices, menus and modals required by the selected plugins. Calendar's default daily-note settings are YYYY-MM-DD with no template/folder, with its own original settings controlling calendar behavior. File writes use existing Vault.create protections; existing documents are not overwritten. Plugin UI can request opening a note in Dynote. Plugin status explicitly identifies limited compatibility and reports runtime errors.

## Acceptance

- Import exact downloaded files and confirm hashes; no proprietary runtime or third-party source enters the repository.
- Recent Files original command/view opens, tracks two Dynote documents in order, exclusion setting works, saves data, and survives app restart.
- Calendar original view visibly renders; existing date opens a Dynote document; new date creates a real Markdown file through the original confirmation flow.
- Both register original commands; disable removes commands and unloads views; re-enable restores runtime.
- Vault switch/restart isolates enabled state and plugin data; stale windows cannot mutate another vault.
- Unsupported module fails explicitly. Traversal, symlink inputs and stale sender operations are refused. Plugin renderer has no Node or main notes bridge.
- Existing tests and build pass; verify actual macOS Electron workflow. Windows runtime remains unverified.
