# Stage B report: synthetic audio benchmark

Run locally, 7 November 2026 (IST). Results analysed from the saved files.
**Code:** baseline = commit fa04e83 (`bench/.baseline/`); current = working tree (Phase 2 plus both echo fixes). No application code, benchmark code or dataset was changed for or during this stage.
**Verdict:** **INVALID COMPARISON** for the expense results: the current run used the backup reading model for 2 of 30 clips. No accuracy claim can be made, and this 30-clip computer-voice set couldn't support one anyway.

## Pre-checks

| Check | Result |
|---|---|
| Tests | 114 of 114 pass |
| Code changes | Same expected set as Stage A; nothing new |
| Baseline snapshot | Matches fa04e83 |
| Earlier results | Kept (`archive-2026-11-07/`, `stageA-*`); this stage used `stageB-` labels |
| Model attribution | On |

## Commands and timing

| Run | Command | Start | End |
|---|---|---|---|
| Baseline | `bench/run.py audio --set synthetic --code baseline --label stageB-baseline-synth` | 23:37:48 | 23:42:54 |
| Current | `bench/run.py audio --set synthetic --code current --label stageB-current-synth` | 23:43:04 | 23:48:07 |
| Compare | `bench/run.py compare stageB-baseline-synth-audio stageB-current-synth-audio` | after 23:48:07 | |
| Probe | `stageB_probe.py` (outside the project; copy in `stageB-probe-script.py.txt`) | 23:48:45 | 23:49:00 |

## API calls, errors and models

| | Baseline | Current | Probe |
|---|---|---|---|
| Speech calls (whisper-large-v3) | 30 first passes, plus an unrecorded number of second passes for possibly-translated Tamil/Hindi | same | 3 first passes, plus possible second passes |
| Reading calls | 30 | 32 | 0 |
| Rate-limit errors / waits | 0 / 0 | 0 / 0 | 0 |
| Main model (gpt-oss-20b) failures | 1: `b-tg-swiggy-k`, Groq "Failed to validate JSON" | 2: `b-tg-swiggy-k` and `b-hg-chhod-ke`, same error | |
| Outcome of those failures | No result (baseline has no backup for this error) | Backup **gpt-oss-120b** answered both; both answers were still wrong | |
| Answered by main / backup | 29 / 0 (1 no result) | 28 / 2 | |
| Mean time per clip: speech / reading | 0.83 s / 1.31 s | 0.87 s / 1.22 s | 0.9–1.9 s |

The benchmark doesn't record how many second speech passes ran. That's a gap to fix later; it doesn't affect the results.

## Targeted checks

| Check | Result |
|---|---|
| **"Dinner with Arun and Ravi, I paid."** (thrown away as silence on Day 2) | **Kept.** Transcribed exactly, read correctly (missing amount asked for). Regression fixed on real Whisper output. |
| **"Dinner 1,200, split with Senthil and Pooja."** (thrown away on Day 2) | **Kept** and read correctly, and the card showed "Check who paid" as intended. The current version also heard **"Senthil"**; the baseline heard **"Saint Thil"** and got the expense wrong. |
| **Exact prompt echo** (the hint read aloud) | **Rejected** as an echo, as intended. |
| **Nine friend names in a row** | **Kept**, as intended. Whisper wrote all nine names in **Hindi script** (कार्थिक, दिव्यया, सेन्थिल …) although they were spoken by an Indian English voice and given in English in the prompt. |
| **Genuine silence** (3 s of digital silence) | **Not rejected.** Whisper invented "Subtitles by the Amara.org community", a known Whisper hallucination that isn't in Kitty's silence list. The app would then spend a reading call; with no amount or people, it should show "I couldn't hear an expense" rather than open the card (not verified here). The silence logic is the same in baseline and current, apart from the echo check, so **this is an existing gap, not a Phase 2 regression**. Digital silence is harsher than a real phone microphone, which always picks up some noise. |

## Transcription (same speech model in both runs, so this part is model-consistent)

- **Whisper is repeatable here:** the same clip gave the same transcript in every run of the same version (Day 2 and Stage B: 30/30 baseline, 28/28 current). So the 12 clips whose transcript differs between baseline and current differ **because of the code change**, mainly the friend names in the prompt, not chance.

| Language (clips) | Baseline WER / CER | Current WER / CER |
|---|---|---|
| English (11) | 0.08 / 0.05 | 0.06 / 0.04 |
| Indian English (5) | 0.07 / 0.06 | 0.07 / 0.06 |
| Tamil (2) | 0.24 / 0.11 | 0.36 / 0.21 |
| Tanglish (3) | 0.38 / 0.11 | 0.34 / 0.14 |
| Hindi (3) | 0.39 / 0.27 | 0.41 / 0.41 |
| Hinglish (6) | 0.88 / 0.81 | 0.84 / 0.76 |
| **All (30)** | **0.307 / 0.235** | **0.302 / 0.247** |

How to read this:
- **Names are written in English letters inside Tamil and Hindi transcripts.** With friend names in the prompt, Whisper now writes those names in English letters even inside Tamil or Hindi script ("Suresh Petrol-க்கு", "Neha के साथ", "Rahul, Amit और Sumit"). The references write those names in Tamil or Hindi script, and WER/CER count a script change as an error, so the higher Tamil and Hindi error rates partly reflect spelling, not meaning. The benchmark's alias list is used for name checks, not for WER.
- **Hinglish error rates are near 0.8–0.9 in both versions** because Whisper writes Hinglish in Hindi script while the references are in English letters (the "switched to Tamil/Hindi script" flag on all 6 Hinglish clips, in both versions). This is a measurement mismatch, not a real error rate.
- **Clear name gains from the prompt:**
  - "Saint Thil" became Senthil.
  - "Puja" became पूजा in the Hinglish exclusion clip.
- **Clear losses:**
  - `b-hi-grocery`: "800" became "आज सौ" ("today hundred"), so the amount was read as ₹100. It happened in both current runs, so it's caused by the prompt change on this clip.
  - `b-tg-soundalike`: "kudathan" became "QD", losing the word that says who paid.
  - `b-en-group-unsaid`: "Meena" became "Mena". The reading was still correct.
- **Ravi heard as रविवार ("Sunday") / "Raviwar"** in `b-hi-hotel`, in both versions. The prompt changed the spelling but didn't fix it.
- **No friend name was inserted by the prompt** in any clip. 0 in both versions; 1 baseline name check was correctly left uncertain (रविवार vs Ravi).

## Expense results (shown for diagnosis only: comparison invalid)

| Measure | Baseline | Current |
|---|---|---|
| Final expense correct | 23/30 | 22/30 |
| Amount | 27/28 | 27/29 |
| Payer | 26/28 | 28/29 |
| Participants | 22/28 | 23/29 |
| Names | 23/28 | 26/29 |
| No result (errors) | 1 | 0 |

Clips answered by the main model in **both** runs: 28. Baseline 23 correct, current 22. A one-clip difference, within noise.

**Final correct by language**

| Language | Baseline | Current |
|---|---|---|
| English | 10/11 | 11/11 |
| Indian English | 4/5 | 4/5 |
| Tamil | 2/2 | 2/2 |
| Tanglish | 2/3 | 1/3 |
| Hindi | 2/3 | 1/3 |
| Hinglish | 3/6 | 3/6 |

**Errors by type**

| Type | Baseline | Current |
|---|---|---|
| Amount | `b-hg-dedh-hazaar` ("dedh hazaar" heard as "Dead Hazard") | `b-hg-dedh-hazaar` (same); `b-hi-grocery` (800 heard as "आज सौ", read as ₹100) |
| Payer | `b-hi-hotel` (You assumed: Ravi heard as रविवार); `b-hg-chhod-ke` (Rajat, the excluded person, made payer) | `b-hg-chhod-ke` (same mistake, on the backup model) |
| Participants | `b-hi-hotel`, `b-hg-dedh-hazaar`, `b-hg-other-payer` ("मेन" read as a person "Meen"), `b-hg-chhod-ke`, `b-inen-myself` (Satish vs Sathish), `b-en-payer-unsaid` ("Saint", "Thil") | `b-hi-hotel`, `b-hg-dedh-hazaar`, `b-tg-swiggy-k` (backup model), `b-hg-other-payer` (same "Meen"), `b-inen-myself` (same), `b-tg-soundalike` (You dropped after "QD") |
| Names | `b-hi-hotel`, `b-hg-other-payer`, `b-hg-chhod-ke`, `b-inen-myself`, `b-en-payer-unsaid` | `b-tg-swiggy-k`, `b-hg-other-payer`, `b-inen-myself` |
| No result | `b-tg-swiggy-k` (JSON error) | none |

**Card checks on wrong answers:**
- **Current:** 6 of the 8 wrong answers showed a "Check …" note before saving. The 2 that slipped through:
  - `b-hi-hotel`: Ravi missing;
  - `b-hg-other-payer`: "Meen" added.
- **Current, false alarms:** 5 correct answers also carried a note.
- **Baseline:** flagged 1 of 6 wrong answers. It has no notes, only missing-field prompts.

## What can and can't be said

- **Can:**
  - The silence-echo regression is fixed on real Whisper output.
  - Exact prompt echoes are rejected.
  - A list of nine friend names is kept.
  - The friend-name prompt **reproducibly changes** transcripts: better names in some clips (Senthil, Pooja), worse words in others (800 became "today hundred", "kudathan" became "QD").
  - No friend names were inserted by the prompt in this set.
  - The card's checks caught most wrong answers in the current version.
- **Can't:** that Phase 2 improved or worsened audio accuracy. The expense comparison is invalid (mixed models), the differences are one clip, the clips are computer voices reading clean text, and Tamil and Tanglish have only 2–3 clips each.
- **Not measured:** real-speech accuracy.

## Issues found, for later (no code changed)

1. **Silence:** "Subtitles by the Amara.org community" (and similar Whisper hallucinations) isn't recognised as silence. Existing gap.
2. **Name script:** names in the prompt make Whisper write them in English letters inside Tamil and Hindi transcripts, and nine English names came back in Hindi script. This affects WER, not meaning; the reading model handled it.
3. **Prompt side effects:** on `b-hi-grocery` and `b-tg-soundalike`, the prompt change made a nearby word worse (an amount and a payer word), reproducibly. Real recordings are needed to judge whether this is common.
4. **Groq JSON errors:** the main model failed Groq's JSON check 1–2 times per 30 calls in every run so far.
5. **Benchmark gaps:**
   - second speech passes aren't counted;
   - WER doesn't use the name alias list;
   - Hinglish references in English letters versus Hindi-script transcripts inflate WER.

## Files

`bench/results/stageB-baseline-synth-audio.{json,md}`, `stageB-current-synth-audio.{json,md}`, `log-stageB-baseline-synth.txt`, `log-stageB-current-synth.txt`, `log-stageB-compare.txt`, `log-stageB-probe.txt`, `stageB-probe.json`, `stageB-probe-script.py.txt`, this report.

Stopped here. Nothing was deployed, committed or pushed, and no real recordings were collected.
