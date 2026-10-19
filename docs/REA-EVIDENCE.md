# REA evidence used for Open Notes

Analysis date: 2026-10-19. Reference: installed Obsidian **1.12.7** on macOS. Only installed application packages were inspected. No personal vault was opened, no reference application code was executed by REA, and no recovered source or assets were copied into this project.

## Retained observations

| Input | SHA-256 | Analysis |
| --- | --- | --- |
| `/Applications/Obsidian.app/Contents/Resources/app.asar` | `d8e392731d32feb97e80dd5fb8938d54c61bb7221f9eff5ff95965f6febeefdb` | Bootstrap, bridge and native-addon syntax |
| `/Applications/Obsidian.app/Contents/Resources/obsidian.asar` | `2b2483b2e1246772e0d25367ec055cbc5047ea2f0091b667c35656678f86d712` | Selected main-process and renderer sources |

- Bootstrap parent evidence: `ev_1edb6ab3753312e6b037e2108dc307fd8166ffbc42b690b343f037d42b86d9da`. The small `app.asar` alone does not establish the complete application architecture.
- Main parent evidence: `ev_f22eaee716af14858f2543e8c09de835b85afefa7020ae2192a3ab5ce58f686e`. Selection: `package.json`, `main.js`, `index.html`. REA observed two BrowserWindow construction sites and 42 literal main IPC handlers. These are syntax observations; runtime reachability and security enforcement are not established.
- Renderer parent evidence: `ev_51248e14d2a6b4e8a100c1288987d9e88abd1aeb530b1ccdeb12523b95dda038`. Selection: `app.js`, 3,728,534 bytes. REA recovered 195 module candidates without parse failures. Semantic analysis was truncated at the selected 12,000-node ceiling; 35 inventoried sources were not selected. This is not whole-app reconstruction or verified behavioral equivalence.

The bootstrap analysis recorded ASAR integrity contradictions for unpacked native modules and continued under `record-and-continue`, retaining the actual bytes as untrusted. Signing/stripping after archive construction is a possible explanation, not a verified cause or a malware diagnosis. Native addons were not executed or adopted.

Local receipts: `/Users/james_black/work/project/REA/research/obsidian-1.12.7/analysis-receipts.json`. Complete evidence export: `/Users/james_black/work/project/REA/research/obsidian-1.12.7/rea-evidence-2026-10-19.json` (outside this repository; approximately 170 MiB).

## Translation into the independent design

The useful observation is the boundary between local storage/native operations and the editor/workspace. Open Notes implements that boundary with a small, fixed preload API, not a generic IPC dispatcher. Linked-note relationships and the editor are implemented against new synthetic examples and tests. The new app deliberately omits a plugin runtime and ZIP importer, motivated by the separate open-obsidian security review.

All Open Notes feature claims must be supported by its own tests and UI observations. The reference analysis does not certify the new application's correctness or security and does not establish compatibility with every Obsidian feature.
