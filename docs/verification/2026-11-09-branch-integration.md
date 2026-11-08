# Dynote branch integration — 2026-11-09

## Audit scope

Audited 68 local, remote and imported branch references (46 unique heads) from the Denote worktrees, `/Users/james_black/work/project/dynote`, the independent daily/Mermaid clones, and the older REA/open-notes clone. Published baseline: `67fcadf` (v0.21.0). Every audited head is now an ancestor of this main branch.

## Preserved changes

- `f83aefa`: general UI, saved text colors and the native screen eyedropper; removes the ESS viewer and assets. Native color-palette verification is part of release CI.
- `4bffb67`: outstanding development plans, historical verification records and the local handoff. Main archives the obsolete handoff under `docs/archive/2026-10-26-local-handoff.md` so it does not describe the current workspace.
- `090ea7a`: previously uncommitted branding/package changes. File and hunk comparisons found these already present or superseded by published main, including the same icon bytes, titlebar styling, target-runtime pruning and stronger package/settings checks. Merged with the current tree retained to preserve history without reverting newer behavior.
- `106da64`: hourly capture branch. Current session capture already has the hourly scheduler, manual immediate import, enabled-editor checks and newer date/session/WSL handling. Merged with the current tree retained; its three changed files were reviewed against the latest implementation.
- Two ` 2.mjs` script copies in daily-workspace were byte-identical to their canonical tracked scripts. They are preserved locally under `output/integration-2026-11-09/duplicate-scripts/` and excluded from the product tree.

## Verification and boundaries

Feature checkout: clean dependency install and security audit (0 vulnerabilities), 455 unit tests, production build and 7 Electron text-color scenarios passed. The integrated main is checked again before publication. Windows/macOS CI gates publication on tests, package verification, native scenarios and checksums.

Native Chrome sampling returned #2c7b90 for CSS #2c7a90 (delta [0,+1,0]); the exact returned value survived a fresh process using the same isolated profile. Desktop and real Windows screen sampling remain unverified. No new automatic MCP configuration discovery or live AI request is claimed. macOS signing remains ad-hoc and unnotarized.

## Audited heads

| Ref | Commit | Included in main |
| --- | --- | --- |
| `feat/general-ui-colors` | `67fcadfca0ca` | yes |
| `feat/word-documents` | `9ccb98ea0f26` | yes |
| `fix/hourly-copilot-capture` | `106da6418ec4` | yes |
| `fix/journal-idle` | `94e10cc6c46b` | yes |
| `release/dynote-v0.19.0` | `1a2589a088ae` | yes |
| `release/dynote-v0.20.0` | `f9c3c2d827e2` | yes |
| `release/dynote-v0.21.0` | `67fcadfca0ca` | yes |
| `audit-central/docs/copilot-capture-mcp-design` | `29b223cead0a` | yes |
| `audit-central/docs/personal-team-together-copy` | `ce102dcb068f` | yes |
| `audit-central/feat/copilot-journal-auto` | `a224f03c2ff4` | yes |
| `audit-central/feat/development-planner` | `fec71eaa6025` | yes |
| `audit-central/feat/editor-font-context-panels` | `f268dabff953` | yes |
| `audit-central/feat/ess-3d` | `b022317ddf3d` | yes |
| `audit-central/feat/native-plugin-features` | `96c0f641c2a0` | yes |
| `audit-central/feat/obsidian-plugin-runtime` | `fe005b8a0bc3` | yes |
| `audit-central/feat/personal-team-together` | `13e8412f3067` | yes |
| `audit-central/feat/sticky-note-links` | `dedeb568eee3` | yes |
| `audit-central/feat/sticky-note-titles` | `437bc118610b` | yes |
| `audit-central/feat/sticky-notes` | `d948968239dc` | yes |
| `audit-central/fix/copilot-personal-import` | `a5d847e2e7c7` | yes |
| `audit-central/fix/journal-logseq-editing` | `a71029794e2c` | yes |
| `audit-central/fix/macos-package-signature` | `5e67b33a54eb` | yes |
| `audit-central/fix/mermaid-live-preview` | `61f7db8acc95` | yes |
| `audit-central/main` | `1a2589a088ae` | yes |
| `audit-central/release/copilot-journal-v0.16.0` | `971e181a9f2f` | yes |
| `audit-central/release/dynote-v0.18.0` | `32c97ec598ee` | yes |
| `audit-central/release/dynote-v0.19.0` | `1a2589a088ae` | yes |
| `audit-central/release/journal-editing-v0.16.1` | `4bffb67f1bb6` | yes |
| `audit-central/release/journal-ergonomics-v0.15.1` | `8230a5168c66` | yes |
| `audit-central/release/journal-review-v0.15.2` | `a7f8df07fc97` | yes |
| `audit-central/release/outline-regions-v0.15.0` | `b3e4403fd9b2` | yes |
| `audit-central/release/windows-v0.11.0` | `f4ab72081424` | yes |
| `audit-central/release/workspace-v0.17.0` | `090ea7a5104b` | yes |
| `audit-daily/feat/daily-journal-sidebar` | `1d6282436f44` | yes |
| `audit-daily/fix/copilot-personal-import` | `a5d847e2e7c7` | yes |
| `audit-daily/main` | `1d6282436f44` | yes |
| `audit-legacy/feat/canvas-bases` | `1f4994d34ca2` | yes |
| `audit-legacy/feat/desktop-mvp` | `5826b9b4fcad` | yes |
| `audit-legacy/feat/fonts-git-backup` | `fdee35387add` | yes |
| `audit-legacy/feat/live-preview` | `e9aad01050a8` | yes |
| `audit-legacy/main` | `1f4994d34ca2` | yes |
| `audit-mermaid/fix/mermaid-live-preview` | `61f7db8acc95` | yes |
| `audit-mermaid/release/journal-editing-v0.16.1` | `56a6c5b238b8` | yes |
| `origin/feat/ess-3d` | `b022317ddf3d` | yes |
| `origin/feat/native-plugin-features` | `96c0f641c2a0` | yes |
| `origin/feat/obsidian-plugin-runtime` | `fe005b8a0bc3` | yes |
| `origin/feat/sticky-notes` | `d948968239dc` | yes |
| `origin/main` | `67fcadfca0ca` | yes |
| `origin/release/copilot-journal-v0.16.0` | `971e181a9f2f` | yes |
| `origin/release/dynote-v0.18.0` | `32c97ec598ee` | yes |
| `origin/release/dynote-v0.19.0` | `1a2589a088ae` | yes |
| `origin/release/dynote-v0.19.1` | `a2efbef1cec0` | yes |
| `origin/release/dynote-v0.20.0` | `f9c3c2d827e2` | yes |
| `origin/release/dynote-v0.21.0` | `67fcadfca0ca` | yes |
| `origin/release/journal-blocks-v0.13.0` | `63453670ae9b` | yes |
| `origin/release/journal-blocks-v0.13.1` | `7bc410bbebf8` | yes |
| `origin/release/journal-editing-v0.16.1` | `56a6c5b238b8` | yes |
| `origin/release/journal-ergonomics-v0.15.1` | `8230a5168c66` | yes |
| `origin/release/journal-review-v0.15.2` | `a7f8df07fc97` | yes |
| `origin/release/macos-v0.12.2` | `629ced09771d` | yes |
| `origin/release/outline-regions-v0.15.0` | `b3e4403fd9b2` | yes |
| `origin/release/personal-team-v0.14.0` | `2644736fabf0` | yes |
| `origin/release/verify-windows-font-v0.17.0` | `9707e7634285` | yes |
| `origin/release/windows-v0.11.0` | `f4ab72081424` | yes |
| `origin/release/windows-v0.12.0` | `cd2ca4729e7b` | yes |
| `origin/release/windows-v0.12.1` | `9c36c2cfb01d` | yes |
| `origin/release/windows-v0.12.2` | `d3a2c51d3c37` | yes |
| `origin/release/workspace-v0.17.0` | `b85f3dc073db` | yes |

## Integrated main checks before publication

- 455 unit tests passed; dependency audit found 0 vulnerabilities.
- macOS arm64 v0.22.0 package passed deep/strict signature checks and exact source/bundle checks for 290 files, target Copilot runtime, icon bytes and graph WASM. Removed ESS HTML/model assets were absent.
- Packaged text-color workflow: 7 checks passed with no renderer errors. Packaged Word listing/preview/search/original-file handoff/external-save refresh passed. The shell opener is a fixture, not a real Word edit.
- A FinderInfo attribute was re-created on the package under Documents and blocked strict signature validation. Copying the generated package to a temporary directory without those resource attributes passed the unchanged verifier; no signing or security check was weakened.
- Full native release scenarios are also run locally and on both platform CI jobs. Publication remains gated by those jobs and checksum checks.

The local full native run completed every scenario except an intermittent assertion in `verify-journal-workspace.mjs`: it read update preferences before the last checkbox's asynchronous save completed. A focused rerun passed unchanged, confirming the timing dependency. The test now waits until that checked control is enabled again (the existing settings handler has awaited persistence), then performs the unchanged disk assertions. Two consecutive packaged workspace runs passed after this test-only correction. The other native scenarios and all six sticky regressions passed in the full run; CI is rerun on the corrected release commit.

On release CI commit 19f2d4e, macOS completed all build/native/distribution checks. Windows completed the other native scenarios and six sticky regressions, but the newly added color test used Ctrl+Shift+Z for redo. The installed CodeMirror history map binds redo to Ctrl+Y on Windows (Cmd+Shift+Z on macOS). The script now sends those platform-specific keys; the exact color/undo/redo assertions remain unchanged. The packaged macOS color scenario passed again. Both CI jobs are rerun before publication.
