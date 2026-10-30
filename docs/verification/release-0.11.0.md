# Dynote v0.11.0 release verification

## Source and package

- `npm test`: 275 passed, 0 failed, 0 skipped.
- `npm run build` and `git diff --check`: pass.
- Mac arm64 and Windows x64 packages: 268 source/build/license files match per platform; bundled Copilot native runtime, WASM and GLB present; development sources, personal fixtures and HANDOFF excluded.
- Mac `codesign --verify --deep --strict`: pass on packaged and final ZIP extracted app. Signature is ad-hoc; no Developer ID signing or notarization.
- Both ZIP CRC checks pass. Extracted Mac ASAR matches packaged ASAR: `74dabe469ea37f906fe67c7b5dfebb5631c0f8daca4579c8837459b8a5431b9b`.

## Packaged Mac runtime

All checks use isolated temporary note folders and profiles.

- Text color: selection formatting/reset, reading view and Live Preview, Markdown structure, stable colored heading anchors and outline navigation, save/restart persistence.
- Editor usability: five scenario groups covering toolbar/shortcuts, actual native right-click menu and undo, font preferences, pointer/keyboard/cancel panel resizing, restart/reset.
- AI send/version: current visible note scope, advertised model selection, explicit blocking reasons, pending-draft Ask behavior and Agent/Edit protections. Deterministic IPC; no live prompt submitted.
- Account layout: compact connected/disconnected header, refresh/new chat, narrow menu containment and dismissal. Deterministic IPC; no credential mutation.
- Planner review: five scenario groups covering 99 candidates with 60/39 pagination, two-pass progress, missing/merged row flags, source acknowledgement, and audit error/cancel retaining initial results.
- Existing editor tools: six groups covering Outliner moves/undo/folding and Mermaid creation/rendering.

Windows is cross-packaged; native Windows runtime has not been tested. Capture recognition still requires manual comparison with the source. Current user profile's missing former temporary vault is a separate configuration issue; tests do not replace or infer the user's actual note folder.

## Archives

| File | Bytes | SHA256 |
| --- | ---: | --- |
| Dynote-0.11.0-macos-arm64.zip | 291861537 | fbc04358906fe26f72eded57165ac366d006ea63e4d7b2279684e0043f2ff41b |
| Dynote-0.11.0-windows-x64.zip | 380446919 | 00f148360b508fff5334ab6aa868e4fb82c9f85db6543812802f57469c0371c6 |

Public publication, exact downloaded hashes, installed-app replacement and launch are verified separately after publication. Build artifacts and receipts under `release/` and `output/` are ignored and do not ship as source.

Windows was subsequently built and launched on a Windows runner and publicly published. The public native Windows ZIP differs from the earlier local cross-package above; use [Windows publication verification](windows-release-0.11.0.md) for the actual download digest and runtime evidence.
