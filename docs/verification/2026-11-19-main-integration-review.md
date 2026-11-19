# Dynote v0.23.5 integration review

## Scope and branch coverage

Reviewed all 48 local branch references across the four related Git repositories before integration. Every branch tip was already an ancestor of upstream `main` at `4e41bef`; no historical feature needed to be merged again. Original worktrees and recoverable copies of their pending changes were preserved.

After refreshing `origin`, all 32 remote branches were also ancestors of upstream `main` (33 remote refs including the symbolic default-branch ref).

| Repository checkout | Branch | Tip | Included in upstream main |
| --- | --- | --- | --- |
| dynote-journal-idle | `feat/external-file-open` | `b8b9234` | Yes |
| dynote-journal-idle | `feat/external-word-open` | `a5ad253` | Yes |
| dynote-journal-idle | `feat/general-ui-colors` | `f83aefa` | Yes |
| dynote-journal-idle | `feat/update-folder-sticky-theme` | `8b378e0` | Yes |
| dynote-journal-idle | `feat/word-documents` | `9ccb98e` | Yes |
| dynote-journal-idle | `fix/copilot-note-format` | `4e41bef` | Yes |
| dynote-journal-idle | `fix/copilot-session-import` | `ff9d0f9` | Yes |
| dynote-journal-idle | `fix/hourly-copilot-capture` | `106da64` | Yes |
| dynote-journal-idle | `fix/journal-idle` | `94e10cc` | Yes |
| dynote-journal-idle | `fix/journal-navigation` | `8b378e0` | Yes |
| dynote-journal-idle | `main` | `62b3e74` | Yes |
| dynote-journal-idle | `release/dynote-v0.19.0` | `1a2589a` | Yes |
| dynote-journal-idle | `release/dynote-v0.20.0` | `f9c3c2d` | Yes |
| dynote-journal-idle | `release/dynote-v0.21.0` | `67fcadf` | Yes |
| dynote-journal-idle | `release/dynote-v0.22.0` | `c7030e8` | Yes |
| dynote-journal-idle | `release/dynote-v0.23.1` | `62b3e74` | Yes |
| dynote-daily-workspace | `feat/daily-journal-sidebar` | `1d62824` | Yes |
| dynote-daily-workspace | `fix/copilot-personal-import` | `a5d847e` | Yes |
| dynote-daily-workspace | `main` | `c7030e8` | Yes |
| dynote-mermaid-live-preview | `fix/mermaid-live-preview` | `61f7db8` | Yes |
| dynote-mermaid-live-preview | `main` | `c7030e8` | Yes |
| dynote-mermaid-live-preview | `release/journal-editing-v0.16.1` | `56a6c5b` | Yes |
| dynote | `docs/copilot-capture-mcp-design` | `29b223c` | Yes |
| dynote | `docs/personal-team-together-copy` | `ce102dc` | Yes |
| dynote | `feat/copilot-journal-auto` | `a224f03` | Yes |
| dynote | `feat/development-planner` | `fec71ea` | Yes |
| dynote | `feat/editor-font-context-panels` | `f268dab` | Yes |
| dynote | `feat/ess-3d` | `b022317` | Yes |
| dynote | `feat/native-plugin-features` | `96c0f64` | Yes |
| dynote | `feat/obsidian-plugin-runtime` | `fe005b8` | Yes |
| dynote | `feat/personal-team-together` | `13e8412` | Yes |
| dynote | `feat/sticky-note-links` | `dedeb56` | Yes |
| dynote | `feat/sticky-note-titles` | `437bc11` | Yes |
| dynote | `feat/sticky-notes` | `d948968` | Yes |
| dynote | `fix/copilot-personal-import` | `a5d847e` | Yes |
| dynote | `fix/journal-logseq-editing` | `a710297` | Yes |
| dynote | `fix/macos-package-signature` | `5e67b33` | Yes |
| dynote | `fix/mermaid-live-preview` | `61f7db8` | Yes |
| dynote | `main` | `c7030e8` | Yes |
| dynote | `release/copilot-journal-v0.16.0` | `971e181` | Yes |
| dynote | `release/dynote-v0.18.0` | `32c97ec` | Yes |
| dynote | `release/dynote-v0.19.0` | `1a2589a` | Yes |
| dynote | `release/journal-editing-v0.16.1` | `4bffb67` | Yes |
| dynote | `release/journal-ergonomics-v0.15.1` | `8230a51` | Yes |
| dynote | `release/journal-review-v0.15.2` | `a7f8df0` | Yes |
| dynote | `release/outline-regions-v0.15.0` | `b3e4403` | Yes |
| dynote | `release/windows-v0.11.0` | `f4ab720` | Yes |
| dynote | `release/workspace-v0.17.0` | `090ea7a` | Yes |

## Pending work reconciliation

- `dynote-main`: incorporated the right-hand table of contents, source-line/heading navigation, startup stage logging, and their tests. The update download directory and Sticky Note changes already matched upstream.
- `dynote-session-import`: the tracked pending patch passed a reverse-apply check against upstream; the untracked development launcher was byte-identical to upstream. No duplicate implementation was added.
- `dynote-main/output/dynote-toc-install`: incorporated the packaged-app option from the outline verification script and made its development executable platform-aware. The four `* 2` source copies match earlier committed source and are not application inputs. They are preserved in the recovery stash below.
- Workspace Copilot instructions: included `.github/copilot-instructions.md` in the repository so a clone also discovers the Mermaid explanation rules. The rule concerns development Copilot sessions.

## Review fixes

- Resolved integration conflicts while retaining the current Copilot information-note feature and F2 shortcut help.
- Updated UI checks for the renamed Copilot tab and panel visibility button. AI-provider/account checks now explicitly select Copilot because outline is the new default.
- Reconciled older optional Copilot checks with personal-vault setup, the settings-based folder picker, removal of manual MCP/skill controls, and disabled sending for stale selections. Removed delayed test-window destruction that raced with app shutdown.
- Added outline navigation to the native packaged-app release gate for both macOS and Windows.

## Validation

- Unit tests: 487 passed, zero failed.
- Production build: passed; the existing bundle-size advisory remains.
- Development Electron outline checks: 11 groups passed with no renderer errors.
- macOS package: signature verification and byte comparison of 294 source/bundle files passed. Local Finder metadata was removed from the generated bundle before verification.
- npm runtime and complete dependency audit: zero vulnerabilities.
- Native macOS package regression: all 29 release scenarios and 7 Sticky Note tests passed across the full run and focused reruns. The initial text-color and journal-outline failures were obsolete panel selectors and setup; both passed after correction.
- Eight additional Copilot scenarios passed: account layout, connection recovery, send state, planner/provider session sharing, composer/Mermaid rendering, runtime editing, Agent edits, and live edits. Renderer error lists were empty.
- Changed JavaScript syntax checks, whitespace checks, release-version consistency, and original-worktree preservation checks passed.
- Publication is gated by fresh unit tests, dependency audits, packaged-source checks, native macOS/Windows scenarios, and archive/checksum verification in the release workflow. CI reports are attached to the release artifacts.

Native checks use isolated synthetic profiles. AI scenario checks use controlled provider events; they do not establish paid-provider availability. Windows acceptance is performed by the release workflow on its Windows runner.

## Worktree handoff and recovery

The normal `dynote-main` checkout now uses `main`. All 17 existing worktrees were clean after integration. Three stale worktree registrations were left intact; no feature branches or worktrees were deleted.

The original pending work was saved before switching the normal checkout. Tracked patches and every untracked file were compared byte-for-byte with the corresponding stash contents:

| Original checkout | Recovery stash commit |
| --- | --- |
| `dynote-main` | `22804efd1da84050b261b3944ac48ef85a841bce` |
| `dynote-session-import` | `845697587631b1c2e5cc56bb63bb493142914d52` |
| `dynote-main/output/dynote-toc-install` | `c0c4911c548ead085b9e5bafc41eafcfd6af8b83` |

These stashes belong to the shared local Git repository and retain their original bases. They should only be restored deliberately into a suitable separate worktree; their implemented changes are already included in `main`.

## Published release acceptance

- Published [v0.23.5](https://github.com/mrdylee/dyNote/releases/tag/v0.23.5) as a public prerelease at `2026-11-19T00:10:37Z`.
- Release source, tag, and release branch: `f93a58224755840c63311ebf3cd11be5ee2b58e7`. Subsequent handoff documentation does not change the application source.
- [GitHub Actions run 44425363876](https://github.com/mrdylee/dyNote/actions/runs/44425363876): macOS build, Windows build, and publication all succeeded.
- macOS: 487 unit tests passed; 29 native package scenarios and 7 Sticky Note tests passed.
- Windows: 485 unit tests passed, 2 platform-conditional tests skipped, zero failures; 25 native package scenarios and 7 Sticky Note tests passed.
- Both platforms passed dependency audits and source/package comparison of 294 files. Distribution archives were verified before publication.
- Confirmed seven public assets: Mac DMG and ZIP, Windows ZIP, two SHA-256 lists, and two package-verification reports. Downloaded the small reports/checksum lists, checked their GitHub asset digests, and matched all published binary checksums against GitHub's SHA-256 asset digests.

The package-verification JSON files describe the pre-UI source/package check and retain `windowsRuntimeTested: false`. The later native Windows run above supplies the runtime evidence. This release does not establish live paid-model availability, Windows ARM acceptance, Apple notarization, or installation on the user's machine.

During the final post-publication status check, concurrent new edits appeared in the normal checkout for local Copilot Agent Host capture and journal ordering, including a new capture-drafts UI script. Those changes arrived after the reviewed release snapshot and were left untouched. They are not covered by v0.23.5 or the clean-worktree checkpoint above.
