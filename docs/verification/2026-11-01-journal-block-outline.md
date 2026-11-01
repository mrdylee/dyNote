# Journal-only hierarchical blocks

## Scope

The user explicitly confirmed Tab-based parent/child blocks, restricted the feature to journals, and asked for REA investigation, superpowers brainstorming, implementation, verification and deployment. Their motivation is to retain useful structure for later AI organization.

New daily journals start with `# DATE\n\n- ` in the focused Write editor. Journal-only Enter/Tab/Shift+Tab/Shift+Enter behavior, indentation guides, fold controls and an explicit add-block action use the existing Markdown editor and subtree operations. Normal documents and custom templates retain their prior behavior. Existing prose journals are not automatically rewritten.

AI context remains raw Markdown. Synthetic native UI verification confirmed that parent/child structure reaches the selected provider, the file remains unchanged before approval, and reviewed application/save/restart preserves the hierarchy. This does not measure actual model understanding, add automatic AI organization, or remove existing AI request bounds. No private note or capture was transmitted.

## Reference evidence

- Latest official Logseq desktop 2.0.2 arm64 DMG: 177,591,867 bytes; SHA256 `b9a16b6ddef1659aa3c2301ce37a0336377644bbf1016051e3d19d1a66776314`, matching the official GitHub release digest. Mounted read-only without installing it or selecting a personal graph. ASAR SHA256 `aac5f9e5af43837157c9f3b576752d156cca086e43fae23acf2a2e3e566c8b6d`.
- Partial REA static parent: `ev_fdadd2662332fbffd38a79fe6306ebdf295e64b8e61993170bb3f6d70c0c6502`. Exact selected paths: package metadata, preload and main renderer. The 16 MB renderer exhausted the selected 1 GiB worker heap; only preload facts were recovered. Unselected sources remain unknown. Two unpacked native-integrity mismatches were explicitly retained as untrusted; the authenticated download does not resolve every ASAR integrity contradiction.
- Official web demo controlled scenario: `ev_cd422e51df0273da84b4eab82daa1b46ff9787c4c878058efb7d9d739c0a6024`. After settled Enter/Tab/Shift+Tab actions, the DOM observed Project A at level 0, Decision A at level 1, and Action A at level 0. Shift+Enter plus text produced one Action block containing a newline. Fresh browser profile, synthetic data, no account. All requested steps/captures complete, no page errors. Earlier immediate snapshots were insufficient to establish settled behavior and are not used as parity evidence.
- Expanded-parent Enter: `ev_961c02d68a8a7188ae9ab5535a5b214f5d432f358710c13114f79f586da76c5a`. A new level-1 block appeared before the existing level-1 child; the next level-0 sibling stayed separate. Complete within the declared scenario.
- Desktop 2.0.2 is the DB release. Browser observations establish the tested web interactions, not complete desktop equivalence. Dynote independently implements these interactions using ordinary Markdown; no Logseq code or database is included.

Official references: [Logseq tutorial](https://github.com/logseq/docs/blob/master/pages/tutorial.md?plain=1), [Logseq 2.0.2 release](https://github.com/logseq/logseq/releases/tag/2.0.2).

## Verification

- New native test failed before implementation because the initial daily journal lacked a bullet. Command regressions failed before the new implementation existed. An additional regression exposed Tab from a soft-line continuation failing to move its owning block; the repaired behavior preserves descendants and cursor position.
- 360 unit tests pass, zero failures/skips on the local Mac. Production build and diff/syntax checks pass. The existing Vite large-chunk advisory remains.
- Final Mac package passed six native scenario scripts, totaling 35 grouped checks: new journal/AI hierarchy 7, existing journal workspace 8, editor tools 6, focused Write/9,438,761-byte UTF-8/BOM/CRLF roundtrip 3, provider/Agent/reasoning 4, Planner drafts 7. No renderer errors.
- Final-package REA controlled process replay: `ev_88125d1b6caafd3ce2dc88b795b48de8ad1f2665504a54feb1eb1e155cfbae36`, observed exit 0, no output/filesystem/process-budget truncation, quiesced settlement. REA sampled the Node runner and descendants and retained selected script/report filesystem snapshots. Sampling can miss short-lived descendants; snapshots are not syscall traces; inherited environment and complete OS image binding remain unknown. The Node executable digest does not authenticate every descendant binary. Package identity is verified separately.
- The first combined replay stopped at the previous large-document test's old expectation that Enter continued prose; the expected journal bullet was updated to match the new journal behavior, then the complete replay passed. No product workaround was added for that expectation.

Canonical REA records, screenshots and JSON receipts are under ignored `output/verification/` and `output/playwright/`. Release CI independently tests the exact committed source and native Mac/Windows packages before publishing. Publication and local installation receipts are separate from this implementation report.
