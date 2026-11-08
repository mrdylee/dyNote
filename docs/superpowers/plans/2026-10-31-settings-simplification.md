# Settings simplification

Goal: Load installed fonts automatically and consolidate the three backup settings entries.

Assumption: The requested three entries are Git 백업, Git 변경, and 백업 복원. Keep their existing data operations and confirmation behavior.

Design: One top-level 백업·복원 entry with 자동 백업, 복원, and 고급 Git 관리 inside. Default to automatic backup; existing Git status and command-palette links still select their intended view. Collapse branch, author and upload options behind 세부 설정. Keep connection errors visible. A single long page would increase scrolling; separate top-level tabs would retain the reported clutter.

Implementation and verification:
1. Update the existing settings runtime check to require font enumeration without a load button; run against the previous build to observe failure.
2. Mount FontSettings with an asynchronous effect, loading/failure feedback and cancellation. Retain manual font input and selection persistence.
3. Consolidate App settings navigation, collapse GitSettings details, shorten guidance and update the GitWorkspace navigation hint. Add wrapping for narrow settings menus.
4. Update existing settings/history/workspace runtime scripts for the new navigation. Verify automatic font enumeration, fallback/re-entry, advanced field persistence, backup connection/retry/disconnect, command palette entry, staging/commit/branches, and confirmed restore with recovery copies.
5. Run npm test, npm run build, the three Electron scripts with isolated profiles/vaults, and git diff --check. Inspect screenshots. Existing unrelated release work stays intact.

Execution is inline. Canonical progress is tracked in work_state list 2026-10-31-dynote-settings-simplification.
