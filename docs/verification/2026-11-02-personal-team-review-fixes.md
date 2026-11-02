# Personal / team UI review fixes

Both P2 findings from review of `34f480e` are fixed. This remains a local build based on v0.13.1; no public release or remote push was performed.

## Connection preserves purpose

`checkConnection` rejects reconnecting a registered personal folder through the team action, or a team folder through the personal action. It runs before folder switching and cloning side effects and is also enforced by registry selection. Rejection preserves selected space, settings bytes and notes. Explicit purpose changes still use `setPurpose` and remain available through the existing selector.

## Actual Git versus backup

Git workspace status now reports configured fetch/push URLs read from local Git configuration. The UI shows these separately from the Dynote automatic backup target. This supports existing repositories without backup setup, multiple remotes and distinct push URLs. Reading and refreshing metadata does not perform Git network operations or rewrite configuration. URLs shown to the renderer omit standard URL credentials and query/fragment tokens, including malformed-URL fallback cases.

The display explicitly distinguishes loading, lookup failure, a non-repository folder and a local repository without remotes. Existing parent-repository/worktree restrictions remain unchanged. The footer default is now `Git 백업 미설정`, so absence of app backup configuration is not described as absence of an actual Git connection. Configured URLs are shown, not resolved `insteadOf` transport URLs; Git commands continue using the original configuration.

## Verification

- Registry connection regression failed before the guard; explicit reclassification still passes after it.
- Real-repository remote metadata regressions failed before implementation. Valid/malformed URL credential masking and backup-status wording also have observed RED→GREEN checks.
- **370 unit tests passed**, zero failures/skips on macOS.
- Production build, syntax and diff checks passed.
- **24 native groups passed on the final package**, zero renderer errors: review fixes **3**, personal/team spaces **5**, existing vault/history **3**, Git workspace **4**, journal outline **9**.
- Native fixtures confirm an existing origin is displayed without app backup settings, distinct fetch/push URLs are rendered, a different disabled backup target stays separate, local refresh updates only displayed metadata, lookup failure is not mislabeled, and opposite-purpose connection rejection preserves data. Fixtures use disposable profiles; actual user notes/accounts were not used for inference or changed.
- All **278** packaged source/bundle/license files match the workspace. Strict deep signature verification passed. Final ASAR SHA-256: `3a4147763b949239ba46a3abc271b0cf6395656274ad2d87e3de2b0ca1226c25`.

Receipts: `output/verification/vault-space-review-fixes-package.json`, `vault-space-review-fixes-ready.json`; native results in `output/playwright/vault-space-fixes.json` and the four existing suite reports. Screenshot: `output/playwright/vault-space-fixes-remotes.png`.

The previous ready app is superseded by `/Users/james_black/Applications/Dynote-updates/2026-11-02-personal-team-review-fixes/Dynote.app`. The installed application has not been replaced: computer-use again reported the Mac locked and manual unlock required. Normal saved/idle inspection, backup, quit, replacement and relaunch verification remain pending. No force quit or security-setting changes were made. Windows runtime is not claimed.
