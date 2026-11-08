# Kitty benchmark: execution guide

**For:** completing the accuracy evaluation of the Phase 2 code, before any Phase 3 work.
**Date:** 7 November 2026
**Status:** no benchmark has been run yet. Nothing here claims an accuracy change.

---

## 0. Before you start

All commands run in Terminal from the project folder, and each terminal session needs the Groq key loaded once:

```bash
cd ~/voice-split
```

```bash
set -a; . ../Unscam/.env; set +a
```

This loads `GROQ_API_KEY` into that terminal only. It isn't printed or saved anywhere new.

**Free-tier budget.** Groq's published base limits for the reading model are about 8,000 tokens a minute and 200,000 a day, which is roughly 100 reads a day per model. If the main model (gpt-oss-20b) runs out partway through a run, the code switches to the backup (gpt-oss-120b). Then baseline and current are no longer judged by the same model, and the comparison is unfair. So:

- **Day 1:** text benchmarks, about 68 model calls.
- **Day 2:** synthetic audio, about 60 model calls and 60–90 speech calls.
- **Day 3 onward:** real recordings.

Every result now records which model answered. Each summary starts with a line like `Models that answered: openai/gpt-oss-20b × 34`. If a run used the backup at all, its summary says **Mixed models**, and `compare` marks the comparison **INVALID**; repeat that run on a day with fresh quota. Saving the screen output with `| tee` is still useful for spotting errors.

**Results.** Every run writes `bench/results/<label>-<mode>.md` (a summary) and `.json` (every item, with the transcript and the AI's raw answer). Different `--label` values keep runs from overwriting each other.

---

## 1. Text benchmark: baseline and current

The baseline is the code before Phase 2, saved in `bench/.baseline/`. The current code is the working folder.

```bash
./.venv/bin/python bench/run.py text --code baseline --label baseline | tee bench/results/log-baseline-text.txt
```

```bash
./.venv/bin/python bench/run.py text --code current --label current | tee bench/results/log-current-text.txt
```

Each run takes about 7 minutes (34 sentences, 8 seconds apart) and writes `baseline-text.md` and `current-text.md`.

Phase 2 barely changed the text path. The model, prompt and rules are the same; what's new is sturdier number parsing, the backup model on more errors, and the "Check …" notes. So **expect the text scores to be about equal.** The useful new number is "Wrong results that the card flagged", which is always 0 for the baseline because it has no notes.

---

## 2. Synthetic audio benchmark

The 30 clips already exist in `bench/audio/synthetic/`. If that folder is ever empty, remake them (free, no network):

```bash
python3 bench/make_synthetic.py
```

Then:

```bash
./.venv/bin/python bench/run.py audio --set synthetic --code baseline --label baseline-synth | tee bench/results/log-baseline-synth.txt
```

```bash
./.venv/bin/python bench/run.py audio --set synthetic --code current --label current-synth | tee bench/results/log-current-synth.txt
```

These write `baseline-synth-audio.md` and `current-synth-audio.md`. The current code passes each sentence's known people into Whisper's prompt; the baseline doesn't. **Only 13 of the 30 clips have known people,** so the name-prompt effect is measured on 13 clips, which is too few to decide anything on its own.

---

## 3. Comparing baseline and current

```bash
./.venv/bin/python bench/run.py compare baseline-text current-text
```

```bash
./.venv/bin/python bench/run.py compare baseline-synth-audio current-synth-audio
```

It first says whether the comparison is fair:

- `Valid: every reading in both runs was answered by openai/gpt-oss-20b.` The numbers can be compared.
- `INVALID COMPARISON: the runs used different models (...)`. The numbers are shown for diagnosis only. **Don't present them as a before/after result.** Repeat whichever run used the backup model.

Then it prints each measure side by side, and every item whose final result changed, with the model on each side (`changed: b-hi-hotel: False -> True [openai/gpt-oss-20b -> openai/gpt-oss-20b]`).

**How to read a difference:**
- With 34 text items, one item is about 3 points; with 30 clips, about 3.3 points.
- The model isn't perfectly repeatable even at temperature 0, so **treat a difference of 1–2 items as noise.**
- To be sure, run the current text benchmark a second time on another day with `--label current-2` and see whether the same items change.
- An improvement is real only if it holds across runs **and** the changed items make sense: open the `.json` and read why each one changed.

---

## 4. Scoring the five existing recordings

The clips are in `bench/audio/real/` (`en1`, `hi1`, `ta1`, `ta2`, `tg1`). Their rows in `bench/audio/real.json` have no reference words yet, so they're shown but not scored.

1. **Listen to each clip and type exactly what was said**, in the script it was spoken in. Do this before looking at any Kitty transcript; copying Whisper's output as the reference hides Whisper's own mistakes.
2. **Fill in the row.** Example for a Tanglish clip:

   ```json
   {
    "file": "real/tg1.m4a", "kind": "real", "lang": "tanglish", "speaker": "S01",
    "reference": "Petrol ku naan 1200 kuduthen, Arun Ravi kooda split pannu",
    "people": ["Arun", "Ravi"],
    "payer": "You",
    "owed": {"You": 400, "Arun": 400, "Ravi": 400}
   }
   ```

   - `people`: the friend names the app would know when this was said. These are passed to Whisper's prompt and the reader, as in real use.
   - `owed`: what each person really owes, **including You**, in rupees. Leave out anyone who owes nothing.
   - `payer`: the person who paid, written exactly as in `owed` (`You` for the speaker).
   - `name_forms` (optional): other spellings or scripts of a name that should count as heard, for example `{"Arun": ["அருண்"]}`.
   - For a clip where the amount was deliberately not said, use `"missing": "amount"` instead of `payer` and `owed`.
   - Delete the `"note"` line.
3. **Check the file before spending any calls:**

   ```bash
   ./.venv/bin/python -c "import json; [print(r['file'], 'NEEDS reference' if not r.get('reference') else 'NEEDS owed' if not (r.get('owed') or r.get('missing')) else 'ok, total ' + str(round(sum((r.get('owed') or {}).values()), 2))) for r in json.load(open('bench/audio/real.json'))]"
   ```

   Each line should say `ok`, and the total should match the amount spoken.
4. **Run both versions:**

   ```bash
   ./.venv/bin/python bench/run.py audio --set real --code baseline --label baseline-real | tee bench/results/log-baseline-real.txt
   ```

   ```bash
   ./.venv/bin/python bench/run.py audio --set real --code current --label current-real | tee bench/results/log-current-real.txt
   ```

   ```bash
   ./.venv/bin/python bench/run.py compare baseline-real-audio current-real-audio
   ```

Five clips from probably one speaker show whether the pipeline works on real voices. They can't support a percentage.

---

## 5. Recording new samples from 8–10 speakers

**Aim:** 60–100 clips, 3–10 seconds each, ideally from 8–10 people. A spread is more useful than a large number from one person.

| Group | Clips | Speakers | Notes |
|---|---|---|---|
| Tamil and Tanglish | 25 | 3 or more | Mix of Chennai, Madurai and Coimbatore speech if possible |
| Hindi and Hinglish | 25 | 3 or more | |
| Indian English | 15 | 3 or more | South and North Indian accents |
| Hard cases | 15 | any | Noisy (restaurant, traffic, fan), fast, phone held away, two names that sound alike |

**How:**

1. **Ask each person's permission** and explain that the clips stay on your laptop and are used only to test Kitty. Give them a code such as `S01`, `S02`; don't use their name.
2. **Give each speaker a friend list** of 4–6 names that becomes their `people`. Include:
   - names Kitty's prompts don't already mention. Arun, Ravi and Kavya appear in Kitty's own prompts and hints, so they're always "primed" and hide the effect of the name prompt. Use names like Karthik, Divya, Senthil, Ankit, Pooja, Lakshmi;
   - **sound-alike pairs** in some lists: Priya/Priyanka, Karthik/Karthika, Arjun/Arun, Sneha/Neha. These are the cases where a name can be wrongly matched to another friend.
3. **Give situations, not sentences to read.** Reading a written sentence produces unnaturally clean speech, and copies the benchmark's own style. Show one situation card at a time and let them say it their own way:
   - "You paid for dinner for you and two friends. One of them didn't have drinks."
   - "Your friend paid for the cab and you're splitting it three ways."
   - "You bought groceries; you and your flatmate split it 60–40."
   - "You paid a lump sum for a trip hotel; one friend had already given you some money." (Kitty can't handle this yet; it's useful for Phase 3. Mark it `"phase3": true` and leave it out of scoring for now.)
   - "Say an expense but forget the amount."
   Write 15–20 such cards and spread them across speakers.
4. **Record** with the phone's own voice recorder (Voice Memos on iPhone gives `.m4a`; the Android Recorder app is also fine). One expense per file. Leave half a second before and after speaking.
5. **Name the files** `S03-tg-07.m4a` (speaker, language, number) and copy them to `bench/audio/real/`. The folder is git-ignored, so voices never reach GitHub.
6. **Straight after each session,** write down what each person was asked to describe (the situation card) and their friend list, so the right answer can be filled in later.

---

## 6. Organising ground truth

All real clips go in one file, `bench/audio/real.json`, one row per clip, in the format shown in section 4. Rules:

- **`reference` is verbatim, in the speaker's own script and spelling:** Tamil script if they spoke "proper" Tamil, Latin letters for Tanglish or Hinglish, and digits only if they said the number in a way you'd naturally write as digits. Include fillers like "um" only if they're clear words.
- **`owed` must add up to the total the speaker meant,** to the paisa. For splits that don't divide exactly (2,500 three ways), write `833.33` for each; the scorer allows one paisa either way.
- **The expected answer is what the speaker meant,** not what Kitty should guess. If what they said was genuinely unclear, the right answer is a `missing` field (`"missing": "people"` or `"missing": "amount"`), not a guess.
- Add `"condition": "noisy"` or `"quiet"`, and `"speaker": "S03"`, so results can be split later.
- Keep a separate speaker sheet (not in git) with each code's region, languages and phone model.
- Have a second person check about 20% of the references. Disagreements usually show the clip is too unclear to score; drop or mark those.

---

## 7. Keeping evaluation separate from development

The checks I ran (read-only, no AI calls):

- **No benchmark sentence is a copy of a development example** (`cases.json`, `cases_heldout.json`).
- **About half are close paraphrases of one,** with a text similarity of 0.6–0.84. They use the same patterns ("didn't have drinks", "naan … kuduthen") and some of the same names. Worst pairs: `b-ta-petrol` / `ta-script-payer` (0.84), `b-tg-munnooru` / `tg-750` (0.80), `b-en-percent` / `en-percent` (0.79).
- **Arun, Ravi and Kavya are in Kitty's own prompts:** "Arun" and "Ravi" in the Whisper hint itself, and all three in the reading rules.

So the typed benchmark and the synthetic audio are **near held-out, not truly independent.** The same person wrote them, the prompts and the development examples. They're good for catching regressions and comparing baseline with current; they're likely to **overstate** real-world accuracy.

**Rules from now on:**

1. **The real recordings are the true held-out set.** They're spoken by other people from situation cards, not written sentences, and use names outside the prompts. Report their numbers separately from the typed and synthetic numbers.
2. **Never copy a benchmark item into `cases.json`, the prompt or the rules.** When a benchmark item fails, add a *different* sentence showing the same problem to `cases.json`, and fix against that.
3. **Never change prompts while looking at real-clip failures one by one.** Look at the totals, decide the change, then rerun once.
4. **Freeze each set by date.** Once real clips are scored, don't edit their rows unless a reference was transcribed wrongly, and note any such correction.

---

## 8. What each measure means

| Measure | Meaning | Good sign | Watch out for |
|---|---|---|---|
| **Word error rate (WER)** | Of the words actually spoken, the share that the transcript got wrong, missed or added. 0.10 means about 1 word in 10 wrong. | Lower is better. Clean English is often under 0.10; code-mixed speech is much higher. | **Spelling variants count as errors:** "kooda"/"kuda", "pannu"/"pannunga". **A script switch counts every word wrong:** Tanglish reference in Latin, transcript in Tamil script, so WER near 1.0 even when Whisper understood perfectly. For Tamil, Tanglish and Hindi, trust CER and the expense measures more than WER. |
| **Character error rate (CER)** | The same, counted in letters. | Lower is better. Fairer for Tamil and Hindi, where one word carries many parts. | Still inflated by script switches. |
| **Names heard** | Share of the people who should be in the expense whose name appears in the transcript, in any listed spelling or script. | Close to 1.0. | Measures hearing, not understanding. A name can be heard and still put in the wrong role. |
| **Amount** | The total Kitty read equals the real total. | | A wrong total with a low WER means the *reading* went wrong (number words, lakh, k), not the hearing. |
| **Payer** | The right person is recorded as having paid. | | Kitty assumes You when nobody is said to have paid, so a wrong payer often means an assumed one. |
| **Participants** | Exactly the right set of people owe something: nobody missing, nobody extra. | | Fails both for a dropped exclusion (Akash should be out) and an extra friend (prompt bias). |
| **Names (spelling, none invented)** | Every expected person is present, spelled as expected, and no name appears that isn't in the sentence or the friend list. | | Names from the friend list count as allowed, so this does **not** catch a friend wrongly added (see below). |
| **Final expense correct** | The right payer, and every person's share right to the paisa. The headline number: it's what reaches the money. | Higher is better. | A single wrong person or amount fails the whole item, by design. |
| **Wrong results that the card flagged** | Of the wrong answers, how many showed a "Check …" note or a missing-field prompt. | Higher is better: a flagged mistake is caught before saving. | Always 0 for the baseline, which had no notes. |
| **Time per clip / item** | Seconds per speech call and per reading call. | Under about 10 s in total. | Groq speed varies by time of day; compare runs made close together. |

---

## 9. What the benchmark detects

Updated 7 November 2026, after the benchmark-only fixes. No app code changed. Each summary now has a **"Why results went wrong"** table, and every item in the `.json` has a `diagnosis`.

| Error type | Now | How it shows |
|---|---|---|
| **A friend inserted into the transcript because they were in Whisper's prompt** | **Detect** | Audio: "friend name in transcript but not said" lists friends whose names are in the transcript but not in the reference. Text and audio: `friend_added` lists friends in the expense who were never said. Test item: `b-hg-friends-unsaid` (four friends, one mentioned). 13 synthetic clips have a friend list. |
| **A correct name recognised as a different friend** | **Detect** | `friend_swapped`, for example "Priya → Priyanka". Name matching treats Priya/Priyanka, Karthik/Karthika and Neha/Sneha as different people while still accepting endings like Ravi-kku, Rahul-ne, Arun's. Test items: `b-en-soundalike`, `b-tg-soundalike`. |
| **A wrong amount despite a correct transcript** | **Detect** | `amount_error` says either "read wrong (amount was in the text)", "heard wrong (amount missing from the text)" or "from number words". |
| **Tamil and Tanglish code-switching errors** | **Partly** | `script` flags "translated or wrong script" (Tamil or Hindi speech returned without its script) and "switched to Tamil/Hindi script". Results are split by language. Still only 3 Tanglish and 2 Tamil synthetic clips, and synthetic Tanglish is read by an English voice. **Real recordings remain the only meaningful test of code-switching.** |
| **A wrong payer assumption** | **Detect** | `payer_error` says "assumed You" or "wrong person (…)". Test item `b-en-payer-unsaid` checks whether the card says "Check who paid": shown as "expected card check shown". |
| **A wrong exclusion** | **Detect** | `extra_sharers` names who wrongly owes something; "Type of sentence" in the summary gives the exclusion score on its own (6 items). |
| **Right people and amount, wrong shares** | **Detect** (new) | `split_wrong`, for example an unequal split read as equal. |
| **Which model answered** | **Detect** | Every item records `model` and `models_tried`. Summaries say "Mixed models" when the backup was used, and `compare` marks such comparisons **INVALID**. |

Still not covered:

- **Tanglish and Tamil audio from real speakers.** The Mac voices can't speak natural Tanglish; four Tanglish sentences have no synthetic audio for that reason.
- **Unclear speech.** Every benchmark item has a clear right answer; real people sometimes say things that are genuinely unclear.

---

## 10. Checklist

**Day 1: text (about 15 minutes)**
- [ ] `cd ~/voice-split`, then load the key: `set -a; . ../Unscam/.env; set +a`
- [ ] Run the baseline text command (section 1).
- [ ] Run the current text command (section 1).
- [ ] Check both logs for `RateLimitError`; if found, repeat that run tomorrow.
- [ ] `./.venv/bin/python bench/run.py compare baseline-text current-text`

**Day 2: synthetic audio (about 25 minutes)**
- [ ] Load the key again in a new terminal.
- [ ] Check `bench/audio/synthetic/` has 30 `.wav` files (if not: `python3 bench/make_synthetic.py`).
- [ ] Run the baseline and current synthetic commands (section 2).
- [ ] Check the logs for `RateLimitError`.
- [ ] `./.venv/bin/python bench/run.py compare baseline-synth-audio current-synth-audio`
- [ ] Send me the four `.md` files from `bench/results/`. The `.json` files contain transcripts; send them too if you're happy to.

**Before recording**
- [ ] Decide whether you want the benchmark-only additions from section 9.
- [ ] Write 15–20 situation cards (section 5).
- [ ] Make a 4–6 name friend list per speaker, avoiding Arun, Ravi and Kavya, with some sound-alike pairs.

**Recording (over a week or two)**
- [ ] Get permission and assign codes S01–S10.
- [ ] Record 60–100 clips (mix from section 5), named like `S03-tg-07.m4a`, into `bench/audio/real/`.
- [ ] Type each reference verbatim before running Kitty on it.
- [ ] Fill in `bench/audio/real.json`, including the five existing clips.
- [ ] Run the check command (section 4, step 3) until every line says `ok`.

**Real-audio runs (spread over days, about 50 clips a day)**
- [ ] Run `--set real` for baseline and current with labels `baseline-real` and `current-real`.
- [ ] Compare them, check the logs for `RateLimitError`, and send me the summaries.
- [ ] Only then decide whether Phase 2 improved accuracy, and what Phase 3 should fix first.
