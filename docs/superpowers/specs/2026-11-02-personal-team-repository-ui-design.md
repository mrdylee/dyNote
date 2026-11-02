# Personal and team repository UI

The user approved separate personal and shared notes, then requested UI that explains separate Git repositories. Implement an understandable space setup and identity, without moving notes or publishing anything.

## Chosen interaction

Extend existing vault settings instead of adding another onboarding wizard. A permanent space identity opens these settings. Two explanatory cards connect personal or team folders. Existing folders remain unclassified until the user chooses their purpose. Each registered folder displays its path, purpose and active status; users can change purpose and open its existing Git settings.

Git settings identify the current purpose, local path and configured remote before the connection form. Explain separate folder / separate Git repository, local save versus Git upload, and that purpose labels do not change repository access rights. Existing automatic backup remains explicit and unchanged; no automatic repository connection or remote selection is added.

Alternative considered: explanatory text alone would not preserve the user's choice or identify the current space. A separate setup wizard would duplicate existing folder/Git flows. Extend the existing settings with persisted purpose metadata.

## Data and boundaries

Keep existing `vaultRoot` and `vaults` settings. Add `vaultPurposes`, keyed by canonical folder path with `personal` or `team`. Legacy entries have no inferred purpose. Purpose changes only alter local app settings, never note contents, Git config, credentials or server visibility. Removing an inactive entry also removes only its purpose metadata.

Canonicalize paths before selection. Reject personal/team roots that contain one another; a nested personal folder could otherwise be inside a team's Git tree. Same-folder selection keeps one entry. Changing purpose is a classification action, not publication or migration. Missing legacy folders stay recorded as before.

Expose the new registered-folder purpose mutation through validated IPC. Use existing folder selection, safe flush/switch and per-vault Git services. Renderer metadata must be associated with the current vault ID so an asynchronous response from a prior space cannot label the new one. Search and AI continue to use the existing active-vault boundary.

## Verification

Test legacy migration, restart persistence, switching, canonical aliases, opposite-purpose nesting rejection, invalid input and unchanged settings on rejection. Native fixtures use two disposable repositories to verify setup cards, current identity, purpose selection, nested-folder rejection, separate Git configuration, saved edits/search isolation, and restart. Check layout at 1050×700 and narrower sizes, keyboard labels, full unit/build checks, and existing settings/Git/journal regressions.

No Office viewer, cross-space copying, PR creation, code-repository subfolder support or public release is part of this change. Existing personal data and unrelated local files remain untouched. A verified local package may replace the installed app only after an ordinary saved/idle quit and backup.
