# Journal review fixes — v0.13.1

The user requested fixes for the two reproduced v0.13.0 review findings. Changes are limited to the parent-split condition, CodeMirror extension ordering, regression coverage and patch-release metadata.

## Parent ownership

Previously, the special child-preserving Enter branch ran only at line end. Splitting `- Alpha|Beta` therefore delegated to standard Markdown continuation and made existing children belong to the new root `Beta`. The branch now accepts text positions before existing children, while retaining the prior Markdown fallback inside list markup.

Golden command tests cover root and nested parents, grandchildren, following siblings, caret placement and one-step undo. The native test saves a mid-line split, checks exact Markdown, undoes it, and saves the restored hierarchy. It failed before the source fix.

## Autocomplete priority

The journal and autocomplete keymaps both use highest precedence, but the journal compartment was registered first. Its Enter command consumed a visible wiki-link suggestion. Registering autocomplete before the journal compartment gives completion acceptance priority; normal journal Enter still runs after autocomplete declines the event.

The native test types `[[Gui`, waits for the Guide suggestion and verifies that Enter produces `[[Guide]]` without inserting a block. It failed after the parent fix but before the extension-order correction, then passed with both fixes. The normal-document scope and existing journal behaviors remain covered.

## Validation before packaging

- 362 unit tests passed, zero failures/skips on the local Mac.
- Production build and diff checks passed.
- Nine native journal groups passed, including both new regressions, save/undo, hierarchy, AI context/review, existing prose, templates and restart.
- Tests use disposable synthetic vaults and controlled provider responses. No actual user note was edited or transmitted and no live model-quality claim is made.

Final-package, CI, installation and public-download receipts are retained separately under ignored `output/verification/`. The previous v0.13.0 remains intact.
