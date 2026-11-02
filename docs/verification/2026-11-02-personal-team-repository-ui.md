# Personal / team Git repository UI verification

## Result

Added personal/team setup cards, grouped registered folders with purpose selectors, persistent current-space identity, and Git settings showing the active folder and configured remote. Legacy folders stay unclassified until the user chooses. Purpose changes do not move notes, change access permissions or connect Git. Canonical personal/team roots cannot contain one another. Existing per-vault backup settings are retained.

Validated the implementation locally on macOS arm64. This is a local build based on v0.13.1, not a new public release. The running `/Applications/Dynote.app` has not been replaced: computer-use reported the Mac locked and requiring manual unlock, so its saved/idle state could not be checked. A verified package is retained for a normal backed-up installation later.

## Evidence

- Before implementation, registry regressions failed for absent purpose metadata, persistence and nesting rejection. The native control regression failed on the previous UI. A filesystem-root nesting edge case also failed before correcting the path boundary.
- Final unit suite: **365 passed, 0 failures/skips**. Registry cases cover legacy migration, purpose persistence, switching, canonical paths, invalid requests, nested roots, retained note bytes and forgetting an inactive registration.
- Production build, syntax checks and `git diff --check` passed.
- Final packaged app: **21 native groups passed**, zero reported renderer errors: space setup/separation **5**, existing vault/history **3**, Git workspace **4**, journal outline **9**.
- Two disposable repositories verified personal and team notes reach their separately configured remotes; the team repository contains no private fixture note. All remote URLs were redirected to local bare repositories using the isolated fixture Git configuration. No real user account or private vault was used.
- Switching spaces flushes an edited team note, restores the personal Git address, and limits search to the active space. Choices survive restart. UI screenshots checked at 1050×700 and 800×700; settings had no horizontal overflow.
- All **278** packaged source/bundle/license files match the workspace; strict deep code signature verification passed. Final ASAR SHA-256: `c5ae4b0237a2a1a82d1cacf6fcac04e53a2df11dde0b29eb3855b6efda7c4e83`.

Native verification caught a missing former picker callback in the AI panel, which was corrected to open space management before final packaging. Fixture-only path assertions were canonicalized for macOS `/var` → `/private/var`, and asynchronous identity checks wait for the completed switch.

## Artifacts and scope

- `output/playwright/vault-spaces-personal.png`, `vault-spaces-git.png`, `vault-spaces-compact.png`
- `output/playwright/vault-spaces.json`, `vault-history-runtime.json`, `native-git-workspace.json`, `journal-outline.json`
- `output/verification/vault-spaces-package.json` and final ready-package receipt
- Package: `/private/tmp/dynote-vault-spaces-package/Dynote-darwin-arm64/Dynote.app`

No notes were migrated, no Git remotes or repository visibility were changed for the actual user, no source branch was pushed, and no release was published. Windows runtime and the actual installed-app update are not claimed.
