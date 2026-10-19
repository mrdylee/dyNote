# Font preferences and Git backup

The user approved separate installed fonts for body, code and UI, with previews, size/line-spacing controls and persistent preferences. They also requested entering Git repository information in the app so notes are saved automatically to that repository. This is implementation approval; no real remote was supplied. Use synthetic local repositories for verification.

## Fonts

Add a settings dialog with three font-family inputs backed by a searchable installed-family list. A user action queries Chromium Local Font Access. Permit only `local-fonts` for the trusted application main frame; other permissions and renderer networking stay denied. If unavailable, allow entering an installed family name and show a readable explanation. Store validated preferences locally, apply CSS variables to body/Live Preview, code/source and interface, and show Korean/Latin samples. Include bounded sizes, body line spacing and defaults. Missing families fall back to system fonts; Markdown bytes remain unchanged. Graph labels use the selected UI family as well.

## Git

Use the installed Git executable and existing SSH/credential-helper login. Accept HTTPS and SSH repository addresses, branch, optional commit identity, and a directly editable whole-minute schedule (1–1440 minutes). The user clarified that the default must be 10 minutes and the repository address will be entered later. Existing stored whole-minute settings remain intact; unsupported legacy intervals fall back to 10 minutes. Credentials are never stored in Dynote settings. Git configuration is per vault in app data, separate from the user's documents and existing vault selection file.

Support connecting the current folder to a remote and cloning an existing branch into a user-selected empty folder. The vault must be the repository root, not a subfolder of an ancestor repository or a linked worktree. Do not change the user's branch, origin, global Git configuration or existing staged work. Only supported, non-hidden note/Canvas/Base/image/PDF paths are automatically committed. Ignore other files and symlinks. Disable repository hooks for app-initiated Git operations.

Automatic and manual runs serialize, commit saved local changes and push without force. Missing identity, authentication/network errors, staged changes, active merge/rebase and remote-ahead histories become visible status messages. Local saves remain available. No automatic pull, rebase or conflict resolution is included. Failed pushes retain local commits and retry on the next run. Switching vaults/disconnecting stops that vault's timer. Pending uploaded state is distinguished from local file save state. The timer runs only while Dynote is open.

## Validation

Tests use real temporary Git repositories and a local bare remote via an isolated Git URL rewrite. Verify commit/push, no-change runs, restart configuration, offline retry, divergent remote preservation, scoped paths, staged-work preservation, invalid inputs, folder isolation, clone and timer lifecycle. Verify fonts and settings persistence in Electron, original editor regressions, all unit tests and production build. macOS runtime evidence does not imply Windows runtime verification. No app-code push, real note upload or release publication is part of this task.
