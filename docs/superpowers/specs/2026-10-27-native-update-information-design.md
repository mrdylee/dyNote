# Native update information

Approved UPDATE-01: replace Plugin Update Tracker's user workflow with Dynote application release information, since native features have no separately installed Obsidian plugin programs to update. Provide explicit check, current/latest version, release notes, stable/prerelease selection, ignored-version restore and official release/download links. Installation is user-directed through the published release; the app never executes downloaded programs or overwrites itself.

Fetch only the fixed public `mrdylee/dyNote` GitHub releases endpoint in the main process, with a bounded request timeout. No network runs at startup. Treat returned names/body as plain text; derive canonical release URLs and admit asset links only from the same repository release-download prefix. Compare semantic versions including numeric prerelease parts; exclude drafts and prereleases unless selected. Persist ignored versions/channel preferences in the application profile, not each vault.

V-model: fixture release feeds test semantic ordering, draft/beta filters and hostile URLs/text -> native settings screen -> actual explicit update check, visible result/failure and safe release navigation. A failed request must never claim latest/up-to-date. This completes the defined update-information capability, not an automatic installer.
