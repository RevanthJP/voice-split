# Stage A report: typed benchmark

Run locally. Results analysed from the saved files.
**Code:** baseline = commit fa04e83 (`bench/.baseline/`); current = working tree (Phase 2 plus the echo fixes). No application or benchmark code was changed for or during this stage.
**Verdict:** **INVALID COMPARISON.** The current run used the backup model for 1 of 34 items. No accuracy claim can be made.

## Pre-checks

| Check | Result |
|---|---|
| Test suite | 114 of 114 pass |
| Git diff | Only expected changes (width, Phase 2, echo fixes, tests, benchmark, docs). Nothing committed. |
| Baseline snapshot | Matches fa04e83 exactly; `splits.py` unchanged |
| Earlier results | Copied to `bench/results/archive-2026-11-07/` (12 files); this stage used new `stageA-` labels |

## Commands and timing (IST, 7 November 2026)

| Run | Command | Start | End |
|---|---|---|---|
| Baseline | `bench/run.py text --code baseline --label stageA-baseline` | 23:19:36 | 23:24:45 |
| Current | `bench/run.py text --code current --label stageA-current` | 23:25:04 | 23:30:17 |
| Compare | `bench/run.py compare stageA-baseline-text stageA-current-text` | after 23:30:17 | |

## API calls, errors and models

| | Baseline | Current |
|---|---|---|
| Items | 34 | 34 |
| Reading (AI) calls | 34 | 35 |
| Rate-limit errors / benchmark waits | 0 / 0 | 0 / 0 |
| Main model (gpt-oss-20b) failures | 1: `b-inen-chai`, Groq "Failed to validate JSON" (400) | 1: `b-tg-shares`, same error |
| What happened next | Baseline has no backup for this error, so the item ended with **no result** | Current retried on the backup **gpt-oss-120b**, which answered correctly |
| Answered by gpt-oss-20b | 33 | 33 |
| Answered by gpt-oss-120b (backup) | 0 | 1 (`b-tg-shares`) |
| Mean reading time | 1.04 s | 1.18 s |

No speech calls were made (typed only).

## Results (shown for diagnosis only: comparison invalid)

| Measure | Baseline | Current |
|---|---|---|
| Final expense correct | 33/34 (97%) | 33/34 (97%) |
| Amount | 32/32 | 32/33 |
| Payer | 32/32 | 33/33 |
| Participants | 32/32 | 33/33 |
| Names | 32/32 | 33/33 |
| Errors (no result) | 1 | 0 |

**By language (final correct)**

| Language | Baseline | Current |
|---|---|---|
| English | 11/11 | 11/11 |
| Indian English | 4/5 (the 1 is the JSON error) | 5/5 |
| Tanglish | 7/7 | 7/7 (1 by backup) |
| Tamil | 2/2 | **1/2** |
| Hinglish | 6/6 | 6/6 |
| Hindi | 3/3 | 3/3 |

## Errors found

| Type | Baseline | Current |
|---|---|---|
| Name | none | none |
| Amount | none | **`b-ta-petrol`**: Tamil "ஐநூறு" (500) read as **₹150**. Payer (Suresh) and people right; the shares were therefore ₹75 each instead of ₹250. |
| Payer | none | none |
| Participant | none | none |
| No result | `b-inen-chai` (JSON error from Groq) | none |

**On the `b-ta-petrol` error:**
- **Same input both times.** The typed reading path sends the same instructions to the same model in both versions; Phase 2 didn't change the reading prompt. So this is most likely the model reading the same input differently on a different run. Earlier evidence agrees: the baseline got this item right in both runs, and on Day 1 the current version got it right too (on the backup model).
- **The card caught it.** It showed "₹150 was worked out from the words said. Check the amount." That's the note the Day 1 review called too noisy; here it flagged a real mistake.

**On `b-inen-chai`:** the baseline failed this item with the same Groq JSON error in both of its runs (Day 1 and Stage A). The current version answered it correctly with the main model both times. Two runs aren't enough to explain why.

## Same-model subset (diagnosis only)

Items answered by gpt-oss-20b in **both** runs: 32. Baseline 32/32 correct, current 31/32. **A one-item difference, within run-to-run noise.** It isn't evidence that either version reads typed text better or worse.

## What can and can't be said

- **Can:** both versions read nearly all typed sentences correctly (33 of 34 each). About 1 call in 34 to gpt-oss-20b fails with Groq's JSON validation error in every run so far (4 of 4 runs). The current version recovers from it via the backup; the baseline returns no result.
- **Can't:** that Phase 2 improved or worsened typed accuracy. The comparison is invalid (mixed models), the difference is one item, and this sentence set sits near 100% for both versions, so it can't separate them.
- **Not measured:** real-speech accuracy.

## Files

`bench/results/stageA-baseline-text.{json,md}`, `stageA-current-text.{json,md}`, `log-stageA-baseline-text.txt`, `log-stageA-current-text.txt`, `log-stageA-compare.txt`, this report.

Stopped here. Stage B (audio) waits for approval.
