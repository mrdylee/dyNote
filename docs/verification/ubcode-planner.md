# ubCode planner evaluation — 2026-10-28

Evaluated the official macOS arm64 `ubc 0.38.0` standalone CLI with only synthetic planner requirements. No license was purchased or installed. No personal notes or project documents were sent to a service.

## Reproduce

Download the CLI following [official installation](https://ubcode.useblocks.com/basics/installation.html). Set `UBCODE_BINARY` to that binary, then run `node scripts/verify-ubcode-planner.mjs` from this repository. The script copies `examples/ubcode-planner/` into isolated evaluation directories under ignored `output/research/ubcode/evaluation/`.

- 3 requirements: editable capture dates, no invented missing year, source image retention.
- 2 designs: review workspace and vault persistence.
- 3 tests linked back to those requirements.
- `schemas.json` requires an incoming test link for every requirement. This is an explicit configured rule; ubCode does not infer all desired completeness rules automatically.

## Observed results

1. Baseline `ubc check --output-format json`: exit 0, no errors/warnings.
2. Remove `TEST_YEAR` → `REQ_YEAR`: exit 1, `needs.schema_network_violation`, correctly identifies `REQ_YEAR` and zero incoming tests instead of the required one.
3. Change `REQ_REVIEW` and run `ubc diff --project base --project changed --impact --impact-depth 2`: exit 1, license refusal. The CLI did not recognize the isolated directories as open-source projects and no active license was installed. No impact-analysis success is claimed.

Machine-readable results are in local `output/research/ubcode/evaluation/verification.json`; raw diagnostic output is `baseline.json`, `missing-link.json` and `impact.txt`. The fixture and verification script are committed, the downloaded binary and generated caches are not.

## Product boundary

Dynote's native evidence cards record note links, observed revisions and an explicit unknown/pass/fail result. They work without ubCode. This release does not embed or redistribute ubCode, invoke arbitrary commands from the UI, or claim a working MCP bridge. The tested CLI JSON diagnostics provide a concrete route for a future adapter; change-impact support needs a permitted evaluation/license context before integration is claimed.

Linked test definitions do not prove the tests ran or passed. Runtime/test reports remain separate evidence. The example uses MyST directives, not arbitrary Dynote Markdown properties.
