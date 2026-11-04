# Review, fixes and v0.15.0 public beta release

The user authorized review, correction and deployment of the journal and drag-selected normal/journal mode changes.

1. Review parser/edit/history/selection/visual boundaries and reproduce concrete defects before fixing. Verify focused regressions, all unit tests, audit, production build and native scenarios. Preserve unrelated dirty files.
2. Prepare v0.15.0 notes and a dedicated release branch/workflow based on the existing Mac arm64/Windows x64 release. Include the new region/threading scenarios in both native jobs. Package/verify locally before pushing the reviewed commit; publish only after both CI platforms pass.
3. Re-download the public DMG/ZIP/checksums. Verify public tag/commit, asset digests, ZIP entries/CRC, DMG checksum, Mac signature and public ASAR identities against native CI receipts. Record the verified links and limits. User notes/accounts and installed app replacement are outside this publication task.
