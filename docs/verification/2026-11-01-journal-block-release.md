# Dynote v0.13.0 public release verification

[Public release](https://github.com/mrdylee/dyNote/releases/tag/v0.13.0) · [Successful Mac/Windows workflow](https://github.com/mrdylee/dyNote/actions/runs/41274461605)

Published prerelease tag and target commit: `63453670ae9bb1b1716d1bcd40d4a6fe3c5f3f36`. No existing release asset or tag was replaced.

| Platform | Unit tests | Native package verification |
| --- | --- | --- |
| Mac arm64 | 360 passed, zero failures/skips | 35 grouped journal/editor/large-file/provider/Planner checks passed |
| Windows x64 | 358 passed, zero failures, two Unix-permission tests skipped | Seven journal input/AI Edit/restart groups passed in the actual Windows executable |

All five public assets were downloaded and their exact sizes and SHA256 values matched the GitHub API. Both archive digests also match the published checksum files. Both ZIPs pass a complete CRC scan. The downloaded Mac ZIP and DMG pass strict deep signature checks and contain the same ASAR. DMG verification passes.

| Public archive | SHA256 |
| --- | --- |
| Mac DMG | `14a48646392c0afca1eeca474d9c39cf4863179b35ece4b25199389da4e4ff8d` |
| Mac ZIP | `68c43e1a70edf3d7fdddec6310ed647dfaa68dbdf7d1ad640aa219e00a25ddaa` |
| Windows ZIP | `4f47828decfdd52152afb359d2ac3c23066c7df22daa71fd7e98469b208cb090` |

Each public ASAR contains the expected 65 core/main-process/license/readme source files from the tag. Mac sources match byte-for-byte. Windows source files match after explicit CRLF normalization. Tests, source JSX, verification outputs, docs and handoffs are excluded from both packages. Public ASAR hashes: Mac `ea3f3320546ce4d817216e7990850f59fabda024c68e0b5bebe4b989674e851b`; Windows `0c04513dee3a1d8e6ed7854090172cc9a4ab0c4a407f07223e6d025179a15236`.

The downloaded Mac app independently passed all seven journal scenarios with no renderer errors, including raw AI context, explicit proposal approval, normal-document scope, old prose, custom templates and restart. Provider events use a synthetic Copilot fixture; this is not a live model-quality benchmark.

The user's local Mac app was backed up, normally quit, updated to the verified local 0.13.0 build and relaunched. Its existing journal retained its exact hash, the journal-only toolbar is visibly present, and the selected Codex account/model remained connected. No user journal was edited or transmitted during verification. The CI-built public ASAR and the local build have separate recorded identities.

Detailed download/source/native/local-install receipts remain under ignored `output/verification/journal-outline-*.json`. Mac signing is ad-hoc integrity signing, not Developer ID notarization. REA scope and limitations are recorded in [the implementation verification](2026-11-01-journal-block-outline.md).
