# Planner capture recognition latency investigation

Date: 2026-11-01. This is a measurement and implementation recommendation, not a shipped performance change.

## Verified current behavior

- Image preparation/import happens before the first inference.
- Studio sends the same image twice, sequentially: initial extraction, then independent row/label audit. It displays the first extraction in the review panel, but waits for the audit before automatic board registration. The UI remains busy during the audit.
- The audit asks for a full corrected item list as well as the row-label inventory. This repeats output generation rather than returning only changes.
- The selected provider/model is reused. Codex does not currently set a per-turn reasoning effort.

## Real account experiment

Runner: `scripts/verify-studio-codex-live.mjs`, using the installed Mac app with a disposable profile/vault and its existing authenticated Codex account. Only a generated two-row public test image was transmitted; no private capture or note was sent. Both calls used `gpt-6.1-sol`.

The original PNG was 2,400 × 1,800 and 9,202,696 bytes. The existing background conversion produced a 2,860,588-byte JPEG with the same dimensions; the original was retained byte-for-byte. This fixture tests transport/compression and two known dates, not a dense timeline.

| Run | Preparation/import | First result, from upload | End of second response, from upload | Outcome |
| --- | ---: | ---: | ---: | --- |
| Default 1 | Not recorded | Not recorded | Not recorded | Extraction valid; audit JSON malformed |
| Default 2 | 1.231 s | 6.957 s | 12.422 s | Extraction valid; audit JSON malformed; automatic save did not complete |
| Explicit `low` effort | 1.614 s | 7.118 s | 13.044 s | Both rows/dates correct; both AI drafts automatically saved |

Individual inference times were 5.726 s + 5.459 s for Default 2, and 5.504 s + 5.923 s for `low`. The benchmark checked that the selected model advertised support for `low` before applying that test-only override. The thread response reported a null effort in the default runs; these measurements do not establish the effective server default.

Receipts (local ignored output):

- `output/playwright/planner-speed/default-1/`: raw extraction/audit answers and failure report.
- `output/playwright/planner-speed/default-2/`: measured failed audit, raw answers and screenshot.
- `output/playwright/planner-speed/low-1/`: successful end-to-end run, report, answers, exact original/transmitted images and screenshots.

The default-run failures were missing JSON closing delimiters, not size-limit errors. They are recorded as failures, not successful latency samples. A single successful `low` sample and two default attempts cannot establish a quality or speed advantage for either setting.

## Recommended next change

Keep the user's provider/model and independent completeness check, but let the first extraction become usable immediately:

1. Save the first extraction as AI drafts, including unknown dates and uncertainty. Show that completeness checking is still in progress.
2. Continue the row/label audit in the background. Do not hold the main schedule UI busy for this second call.
3. Reconcile by stable identity and original source. Update only drafts untouched since the audit began; preserve user edits, deletions and newly added items. Do not resurrect a deleted draft or add a second copy when an audited item matches an edited draft.
4. Save missing items and corrections once the audit completes. Revision conflicts must not silently overwrite newer board content. On cancellation/failure, keep the first saved drafts and mark the completeness check incomplete.

In the successful small fixture this would make the drafts available after approximately 7 s instead of 13 s. That is an inference from stage timing, not a tested implementation or an accuracy/performance promise for the user's dense capture. It improves time until useful results; it does not reduce total model work.

For total runtime, a subsequent measured optimization is to return audit changes instead of rewriting every unchanged item. It needs explicit matching tests for split/merged activities and differing source labels, since the prior audit recovered items omitted by extraction. Do not remove the audit or silently switch to a different model as a shortcut.

## Alternatives considered

- Lower reasoning effort: no measured speed improvement in this small sample; leave production effort unchanged.
- Further JPEG compression/downscaling: preparation was about 1–2 s and the majority of measured time was model inference. Smaller text may become harder to read. No aggressive resolution reduction recommended from this evidence.
- One extraction call only: removes the audit wait but loses an independent check that has previously recovered omitted rows. Do not make this the default without an explicit workflow decision.
- Schema-constrained Codex output: worth testing to reduce malformed-JSON retries. It was not exercised here and is not a demonstrated speed gain. Copilot/Claude need their own capability checks.

OpenAI's [latency guidance](https://developers.openai.com/api/docs/guides/latency-optimization) supports reducing generated output and sequential work. The [Codex App Server documentation](https://learn.chatgpt.com/docs/app-server) documents per-turn `effort`/`outputSchema` and model effort metadata. Neither source establishes application-specific performance; the timings above come from the local real-account runs.

## Scope and validation

Only the opt-in benchmark runner was instrumented for alternate output paths, per-request timestamps, model effort capability checks and an optional `low` test override. Production code and the installed app were not changed during this investigation. The previous automatically saved user drafts remain untouched.

Before shipping the recommended workflow, verify first-pass persistence before the audit finishes; usable schedule interaction during the audit; preservation of edits/deletions across reconciliation; no duplicates for target-prefixed labels; cancellation/failure/revision-conflict behavior; and unchanged dates/completeness on dense fixtures. Benchmark more than one run before claiming a performance gain.
