# Native Obsidian workflow support

Approved direction, 2026-10-27: implement native Dynote equivalents for all eleven enabled community plugins and core functionality. Do not execute Obsidian plugin files. Implement in independent, verified slices; completing one slice does not complete the whole request.

## Design and boundaries

Reuse Vault's validated paths, exclusive creation, revision checks and SaveQueue. Keep renderer sandboxing and context isolation. Share native capabilities where plugins overlap rather than building eleven duplicate subsystems. Persist Dynote preferences by vault ID; do not import private plugin settings, credentials, proprietary source or assets. Original plugin programs may be inspected and executed only in a synthetic research vault.

Native features are the selected direction over either an Obsidian API runtime or combined runtime/native support. The latter two introduce lifecycle/API compatibility work outside this approved direction. Built-in Dynote views expose user tasks rather than plugin implementation details.

## Portfolio and V-model requirements

| ID | Capability | Original coverage | Acceptance evidence |
| --- | --- | --- | --- |
| NAV-01 | Persistent recent files and bookmarks | Recent Files; core bookmarks | Restart, two vaults, deduplication, rename/delete, actual click navigation |
| CMD-01 | Command palette independent from document switcher | Core command palette; entry points for all native functions | Keyboard search/execute, disabled state, Escape and input focus |
| JOURNAL-01 | Calendar and periodic daily/weekly/monthly/quarterly/yearly notes | Calendar, Periodic Notes, Diarian, core daily notes | Original command behavior; same-period reuse; date/template boundaries; actual calendar click/save/reopen |
| TEMPLATE-01 | Choose and insert a Markdown template | Core templates; periodic templates | Date/time/title tokens; selection and undo; preserve line endings |
| OUTLINE-01 | Subtree indent/outdent, move, folding and focus | Outliner; core outline | Exact nested-list input/output and undo in actual editor |
| MAP-01 | Markdown mindmap editing | Markmind basic; Enhancing Mindmap | Parse/edit/save/reopen original basic frontmatter; preserve unrelated metadata |
| MAP-02 | Rich mindmaps | Markmind rich | Capture original rich JSON schema and controlled operations before implementing; preserve original files |
| DIAGRAM-01 | Mermaid authoring commands | Mermaid Tools | Original insertion families, selection and undo; render results |
| PDF-01 | PDF selection, links, annotations and backlink navigation | PDF++; core PDF reader | Controlled PDF selection/link roundtrip and persisted annotations; preserve source bytes unless explicitly editing |
| GIT-01 | Required backup, pull and source-control operations | Git | Disposable local/remote repositories; preserve dirty/conflicted files; startup timing |
| UPDATE-01 | Native feature/app update information | Plugin Update Tracker equivalent | Explicit check, version comparison and failure state; no automatic execution/install |
| CORE-01 | Existing files/search/graph/backlinks/tags/properties/Canvas/Bases/outline/recovery | Core plugins | Existing regression suite plus runtime for changed interactions |
| CORE-02 | Remaining enabled core workflows | Composer, hover preview, word count, audio/web viewer where selected | Separate original actions and synthetic acceptance fixtures |
| SYNC-01 | Synchronization | Core Sync and Git workflows | Native Git transport is independently implementable; Obsidian's account/service access is not established by a local artifact and cannot be claimed compatible |

Personal-vault enabled metadata is a starting inventory, not proof that every plugin setting or command was used by the user. Capture representative workflows before mapping them to product support. Paid/licensed Markmind behavior and remote account services require available original runtime evidence, never invented parity.

## Slice 1: navigation and calendar/journal

- A distinct command palette opens with Cmd/Ctrl+P; Cmd/Ctrl+K keeps document switching.
- Native recent-files and bookmarks panels list documents, persist per vault, and discard deleted entries. Rename updates entries only after a successful vault mutation.
- A journal panel offers a calendar, period selector, and a chronological list of existing period notes. Daily, weekly, monthly, quarterly and yearly notes share one date/path service.
- Use local dates and explicit locale/week semantics. Default daily format `YYYY-MM-DD`, weekly `gggg-[W]ww`, monthly `YYYY-MM`, quarterly `YYYY-[Q]Q`, yearly `YYYY`. Set locale explicitly; avoid global date-library mutation. Weekly is locale week-year, not silently ISO.
- Preferences expose folder, format and optional template file for each period. Validate generated paths in the main process through Vault. Same-period open reuses the existing note. Creation is exclusive; concurrent operations never overwrite. Missing calendar dates require explicit creation; an Open/Create action makes that choice visible.
- Templates support date/time/title replacement through the shared formatter. New notes receive template content only on first creation. Existing/unsaved notes are never re-templated.
- Next/previous navigation chooses an existing periodic note rather than silently creating a missing date.
- Use the existing mutation/SaveQueue protections; stale-vault replies cannot write into the active vault's UI.

## Implementation decomposition

1. Navigation/journal spec and plan, date/path/template services, persistent navigation, command UI, calendar, runtime verification.
2. Outliner/Mermaid/composer editing operations, each with exact input/output and editor undo checks.
3. Basic/rich mindmap formats and native editing, beginning with original controlled serialization evidence.
4. PDF text/selection/link/annotation workflows and backlinks.
5. Git/source-control and update information; remaining core workflows and platform verification.

Each subsystem receives its own concrete implementation plan after its original behavior is captured. Required questions still lacking evidence remain open in the investigation ledger. No blanket Obsidian compatibility promise or Windows execution claim follows from Mac tests.
