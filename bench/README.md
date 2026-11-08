# Kitty benchmark

Measures how well Kitty hears and reads expenses, on sentences that were **not** used to write the prompts or rules (those are in `cases.json` and `cases_heldout.json`). Don't tune prompts on these items, or the numbers stop meaning anything.

## What's here

| Path | What it is | In git? |
|---|---|---|
| `text.json` | 34 typed sentences: English, Indian English, Tanglish, Tamil script, Hinglish, Hindi script. Covers exclusions, treats, unequal splits, number words (aayiram, dedh hazaar, munnooru, lakh, 1.2k), other payers, pronouns, friends who weren't mentioned, sound-alike friends (Priya/Priyanka, Karthik/Karthika) and an unstated payer. Each has the right answer: who paid and what each person owes. | yes |
| `audio/synthetic.json` + `audio/synthetic/` | 30 clips of those sentences read by the Mac's Indian voices (Rishi: Indian English; Lekha: Hindi; Vani: Tamil). Remake with `python3 bench/make_synthetic.py`. | list yes, audio no |
| `audio/real.json` + `audio/real/` | Real recordings. Five exist (en1, hi1, ta1, ta2, tg1); **none has its reference words written down yet, so they aren't scored**. | list yes, audio no |
| `run.py` | Runs the pipeline and scores it. | yes |
| `name_aliases.json` | Each test name's certain spellings in Tamil and Hindi script (Amit = अमित). Names are compared as yes / no / uncertain: an inflected Tamil form or a script with no listed spelling is reported as uncertain, never silently counted as a match or a miss. Spelling variants (Sathish/Satish) are deliberately not listed. | yes |
| `.baseline/` | `reader.py` and `splits.py` as they were before Phase 2 (commit fa04e83), for before/after runs. | no |
| `results/` | `<label>-<mode>.md` summaries (in git) and `.json` raw results with transcripts (kept local). | md only |

## Measures

- **Final expense correct:** right payer and every person's share right to the paisa. The headline number.
- **Amount, Payer, Participants:** each part on its own, so a failure shows where it went wrong.
- **Names:** every expected person is there, spelled as expected, and nobody was invented.
- **Word error rate and character error rate (audio):** how far the transcript is from the words actually spoken. Character error rate is fairer for Tamil and Hindi script.
- **Names heard:** the share of expected names that appear in the transcript, in English letters or the native script.
- **Wrong results that the card flagged:** of the wrong answers, how many showed a "Check …" note or a missing-field prompt. This is what stops a wrong answer being saved unnoticed.

## Running it

Needs `GROQ_API_KEY` in `.env` in the project folder. Free-tier cost per run: text about 34 model calls; synthetic audio about 30–45 speech calls plus 30 model calls. The model's free limit is about 200,000 tokens a day (roughly 100 readings), so do text one day and audio the next; see `docs/benchmark-guide.md`.

Every result records which model answered (gpt-oss-20b, or the backup gpt-oss-120b). `compare` marks a comparison **INVALID** if the two runs weren't answered by the same single model.

```bash
python bench/run.py text --code baseline --label baseline
python bench/run.py text --code current --label current
python bench/run.py compare baseline-text current-text
python bench/run.py audio --set synthetic --code baseline --label baseline-synth
python bench/run.py audio --set synthetic --code current --label current-synth
python bench/run.py compare baseline-synth-audio current-synth-audio
```

`--sleep` (default 8 s) spaces calls out to stay under 8,000 tokens a minute. A rate-limited call waits 65 s and is tried once more.

## Real recordings still needed

Synthetic voices are clean and evenly paced, so they say little about real use. For a real number, record **60–100 clips from 8–10 people**, 3–10 seconds each, on phones, as people would normally speak, some indoors and some with background noise (restaurant, traffic, fan).

| Language | Clips | People |
|---|---|---|
| Tamil and Tanglish | 25 | 3+ (Chennai, Madurai, Coimbatore accents if possible) |
| Hindi and Hinglish | 25 | 3+ |
| Indian English | 15 | 3+ (South and North Indian) |
| Mixed, noisy, fast | 15 | any |

For each clip, add a row to `audio/real.json`:

```json
{"file": "real/ravi-01.m4a", "kind": "real", "lang": "tanglish", "speaker": "S1",
 "reference": "exact words as spoken, in the script they were spoken",
 "people": ["Arun", "Ravi"], "payer": "You", "owed": {"You": 400, "Arun": 400, "Ravi": 400},
 "name_forms": {"Arun": ["அருண்"]}}
```

Ask permission before recording anyone, use a speaker code rather than their name, and keep the audio off GitHub (the folder is git-ignored).
