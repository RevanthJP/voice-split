# Kitty: post-benchmark reliability audit

**Date:** 7 November 2026
**Scope:** audit only. No code changed, no Groq calls, nothing deployed or committed.
**Evidence used:** the current code (`reader.py`, `server.py`, `public/static/app.js`), `bench/results/stageA-report.md`, `bench/results/stageB-report.md`, and the saved per-item results (`stageA-*.json`, `stageB-*.json`), re-analysed offline.

---

## Summary and priorities

| # | Proposal | Why | Risk | Area | Size |
|---|---|---|---|---|---|
| **P1** | Count every speech call and save Whisper's per-segment signals in benchmark results | Needed before tuning silence or judging the prompt; costs nothing | None (benchmark only) | `bench/run.py` | Small |
| **P1** | Reject a small list of known Whisper invented phrases as silence ("Subtitles by the Amara.org community", …), only when the whole transcript is that phrase and has no digits | The silence probe passed through; no real expense contains these phrases | Very low | `reader.py`, silence check only | Small |
| **P1** | New card check: "**the payer isn't sharing this, and it wasn't said to be a treat**" | Offline on the saved results: flags 3 wrong answers that today's checks missed or mislabelled, and **0 correct answers in 4 runs** | Low: may fire on "I paid for A and B" phrased without a treat word | `reader.py` `review()` only | Small |
| **P1** | Run the three-way prompt experiment (section C) before real-speaker testing | The name prompt reproducibly helps some words and harms others; we need to know which setting to test with | None to the app; 90 speech calls, 0 reading calls | `bench/` only | Medium |
| **P2** | Name-aware and script-aware WER/CER (section D) | Today's scores punish correct names written in another script, and Hinglish in Hindi script | None (benchmark only) | `bench/` only | Medium |
| **P2** | Calibrate the amount note with a small number-word checker; show the words the amount came from on voice input | 5 of 6 typed "amount from words" notes were false alarms; but the same note caught two real errors | Medium: done carelessly, it could hide a real misheard amount (see B) | `reader.py` `review()` only | Medium |
| **P2** | Reduce "Kitty put you" false alarms (7 on correct answers, 1 on a wrong one) | Low precision teaches people to ignore notes | Low | `reader.py` `review()` only | Small |
| **P3** | On Groq's JSON error, retry the **same** main model once before the backup | Keeps the main and backup models apart (fewer invalid comparisons); the backup was wrong 2 of 3 times in Stage B | Adds ~1 s on that error; must fit the time budget | `reader.py` `read_expense()` | Small |
| **P3** | Skip uploading when the microphone level never rose (no speech) | Saves Groq calls on empty recordings | Medium: quiet microphones; needs real-phone testing | `app.js` | Small |

Recommended order: **benchmark signals → silence phrases → payer-not-sharing check → prompt experiment**, then decide the prompt setting for real-speaker testing. P2 and P3 can follow.

---

## A. Silence handling

**Where silence is detected today**
1. **Browser** (`app.js` `startRecording`): recordings under 0.8 s are refused. The level meter is drawn but not used to decide anything.
2. **Server** (`reader._is_silence`), after each Whisper call. A transcript counts as silence if any of these is true:
   - it's empty, or exactly one of `_SILENCE` ("thank you", "bye", "நன்றி", "धन्यवाद"…);
   - it's an echo of the prompt (the fixed rule);
   - Whisper's **average** `no_speech_prob` across segments is above 0.6.
3. **Server** (`server.read_audio`): an empty transcript returns 422 "We couldn't hear anything".
4. **Browser** (`heardNothing`): if the reading has no amount, nobody but You, and You as payer, the card doesn't open and the mic screen says "I couldn't hear an expense".

**How "Subtitles by the Amara.org community" gets through**

The phrase isn't in `_SILENCE` and isn't a prompt echo. Its `no_speech_prob` must have averaged 0.6 or less; the probe didn't save that number. So the transcript goes on to the **reading model (one wasted reading call)**. Then:
- **If the model returns no amount and no people:** `heardNothing` keeps the card closed. That's the likely outcome.
- **If the model treats "Amara" as a person:** the card opens with a missing amount. Save stays disabled until the person types an amount, so **nothing can be saved without a deliberate action**, but it's confusing.

**Signals that could help**
- **Whisper's segments:** Groq's `verbose_json` returns, per segment, `no_speech_prob`, `avg_logprob` (confidence) and `compression_ratio`. Kitty uses only the average `no_speech_prob`. Whisper's own reference rule treats a segment as silent when `no_speech_prob > 0.6` **and** `avg_logprob < -1.0`. We have **no recorded values** for Kitty's clips, so any new threshold would be a guess today.
- **The transcript itself:** invented phrases are a short, well-known set ("Subtitles by …", "Thanks for watching", "Please subscribe", Hindi "सब्सक्राइब"). They contain no digits and no expense words.
- **The browser's level meter:** it already measures loudness while recording. Digital silence would never rise above zero.

**A narrow fix that won't reject real short expenses**
1. **(P1) Exact-phrase list.** Treat the transcript as silence only when, after removing case and punctuation, it **equals** one of a short list of known invented phrases, or one such phrase plus "the"/"by"/"community"-type filler, **and contains no digits**. A real expense like "Ravi 500" or "Dinner with Arun" can't match. Start the list with the phrase actually seen; add others only from evidence.
2. **(P1, benchmark only) Record the segment signals** for every clip, so a confidence-based rule (2b) can be judged on data.
   - **(2b, later)** Add the confidence rule only if the recorded values show it separates silence from short real speech in the synthetic set and, later, real clips.
3. **(P3) Level gate in the browser.** Don't upload if the level never passed a very low floor. It needs real-phone testing first (quiet microphones, Bluetooth headsets).

**Tests for the P1 fix:**
- The Amara phrase, and the same phrase with different case and punctuation, count as silence.
- "Ravi 500", "Dinner with Arun and Ravi, I paid", "Thanks Ravi 500" and the nine-names sentence do **not**.
- All existing silence and echo tests still pass.

---

## B. Financial reliability

**How amounts are read and checked**
- **Reading:** only the reading model reads amounts. Its instructions list Tamil and Hindi number words (aayiram, ainooru, dedh hazaar, sau…), and `to_expense` accepts plain numbers or digit strings ("2,500", "₹750"), never guesses. An unreadable amount becomes *missing*, and the card asks for it.
- **Checking** (`review`):
  - **Digits in the transcript:** the total must equal one of them or a sum of them (1.2k and 1.5 lakh handled), otherwise "isn't a number that was said".
  - **No digits:** the note always says "worked out from the words said. Check the amount". **Nothing checks what the words actually mean.**

**Are Tamil, Hindi and code-mixed number words handled well enough?** Not reliably. Evidence:
- **Typed Tamil "ஐநூறு" (500) was read as ₹150** in Stage A (current run). Same input as the baseline, so it was model noise.
- **"dedh hazaar" was heard as "Dead Hazard"** in both versions, so the amount was lost.
- **"800" was heard as "आज सौ"** ("today hundred") with the friend-name prompt, so it was read as ₹100.

In all three, the only safeguard was the soft "worked out from the words" note, which also appears on most correct number-word amounts (5 of 6 typed notes were on correct answers).

**Can a changed payer word be detected?** Not directly: at runtime there's no reference to compare with. But its **effects** can:
- In `b-tg-soundalike`, losing "kuduthen" (paid) made the reader drop You from the sharers. The payer was You, yet You weren't sharing, with no treat.
- In `b-hi-hotel`, Ravi was the payer but missing from the sharers.

The proposed **payer-not-sharing** check (P1) catches exactly this pattern. Simulated on all four saved Stage A/B runs:

| Run | Flagged | Of which wrong answers | Correct answers flagged |
|---|---|---|---|
| Stage A current (typed) | 0 | 0 | 0 |
| Stage A baseline (typed) | 0 | 0 | 0 |
| Stage B current (voice) | 3 (`b-hi-hotel`, `b-hg-chhod-ke`, `b-tg-soundalike`) | 3 | 0 |
| Stage B baseline (voice) | 1 (`b-hg-chhod-ke`) | 1 | 0 |

It stays quiet on the genuine treat sentence (`b-en-treat`, which says "as a treat"). **Risk:** "I paid for Arun and Ravi" without "treat", "for them" or "kku kuduthen" would be flagged. That's acceptable, because it's a "check" note, not a block.

**Can a financial mistake reach Save without user confirmation?**
- **No save without the user.** There's exactly one save path: the card's Save button (`app.js` lines 374–378). Nothing is saved without the person tapping it.
- **When Save is disabled:** only when the shares can't be worked out (missing amount or people, or a split error).
- **Checks never block Save.** So a wrong amount, payer or person **can be saved after one tap, with no warning**, whenever no check fires. In Stage B (current) this happened for 2 of 8 wrong answers:
  - `b-hi-hotel`: Ravi missing. The proposed check would catch it.
  - `b-inen-myself`: Satish versus Sathish. Not catchable without a friend list; with Sathish as a known friend, the existing one-letter match would show "matched to your friend".

---

## C. Prompt experiment

**Question:** for speech recognition alone, which prompt gives the best transcripts?

| Arm | Whisper prompt |
|---|---|
| **A: original** | The language hint only, no names (what the baseline sent) |
| **B: all names** | Hint plus every known friend, up to the token budget (today's behaviour) |
| **C: selective** | Hint plus **only the current group's members**, at most 6, in the friend list's spelling |

**Keeping it fair (avoiding confounds)**
- **Same code for all arms.** Run all three on the *current* code. Only the `people` list passed to `transcribe` differs (`[]` for A, all friends for B, the selection for C). Nothing in the app changes; the benchmark chooses the list.
- **Same audio, same settings:** the same 30 clips, `whisper-large-v3`, temperature 0, auto language, and the same second-pass rule.
- **Score transcripts only, with no reading model.** This removes the run-to-run noise and the main/backup mix that invalidated Stages A and B. Whisper gave identical transcripts across runs (30/30, 28/28), so **one run per arm is enough** and the differences are caused by the prompt.
- **Count and label every speech call,** first and second pass, per arm. If one arm triggers more second passes, that's part of its effect and must be reported.
- **Give every clip a realistic friend list.** Today 17 of 30 clips have **no friend list**, so all arms send the same prompt and those clips can't show a difference. For the experiment, use a separate experiment file that gives every clip 4–9 friends: the sentence's people plus non-mentioned "decoys", some sound-alike (Priya/Priyanka). Arm C keeps the group subset; arm B gets the full list. The original benchmark dataset is not edited.
- **Fix the decision rule before running**, to avoid choosing after seeing results. Proposed: prefer **C over A** only if C (1) loses no amounts or payer words that A keeps, (2) improves name accuracy, and (3) inserts no friend names. Prefer **B over C** only if B is at least as good on all three. Otherwise keep **A** for real-speaker testing.
- **Measures per arm:**
  - amount still present in the transcript (digits or number words);
  - payer words kept ("I paid", "naan … kuduthen", "maine … diye");
  - expected names present, with alias matching;
  - friend names inserted;
  - name-aware CER (section D);
  - second passes used.
- **Cost:** about 90 speech calls plus any second passes, 0 reading calls. That's well within the free speech limit (2,000 requests a day).
- **Limitation:** computer voices. The result decides what to use **for** real-speaker testing; real clips then confirm or overturn it.

---

## D. Benchmark improvements (benchmark code only)

1. **Count speech calls.** Wrap the speech call the same way the reading call is wrapped. Record each call with:
   - its pass (first, or second with forced language);
   - the language detected;
   - the result;
   - the segment signals (`no_speech_prob`, `avg_logprob`, `compression_ratio`).

   Summaries show first and second passes separately. Test with a fake client returning a "translated" first pass.
2. **Name matching across scripts.**
   - Extend `name_aliases.json` with each name's spellings for the language actually spoken; where possible, include the forms Whisper produced in Stages A and B (कार्थिक, दिव्यया).
   - Keep yes / no / uncertain.
   - Add a report line for "uncertain because no spelling is listed for this script", so the list can grow from evidence.
3. **Hinglish and mixed-script WER/CER.**
   - **Report two numbers:**
     - **raw WER/CER**, as today;
     - **comparable WER/CER**, where each known name in either script is replaced by its canonical name before scoring.
   - **Script mismatch is not comparable.** For clips where the transcript's script differs from the reference's (all 6 Hinglish clips), mark WER/CER "not comparable: script mismatch". Leave them out of the overall average and list them separately.
   - **Optionally**, add a second, hand-written Devanagari reference for each Hinglish clip and score against whichever reference matches the transcript's script. This needs your approval, since it adds data to the dataset; no transliteration library is needed.
4. **Uncertain versus confirmed.** In the summary, every diagnosis gets two counts: confirmed and uncertain. Uncertain name matches, script mismatches and "amount from number words" (where the benchmark can't verify the words) never count as confirmed errors.

Tests:
- fake speech client with first and second passes;
- name-normalised WER on "Suresh Petrol-க்கு" versus "சுரேஷ் பெட்ரோலுக்கு", which should no longer count Suresh as an error;
- a Hinglish clip shown as "not comparable";
- uncertain counts kept apart in the summary.

---

## E. Warning calibration (offline, from the saved results)

Card notes in the **current** version, Stage A (typed, 34) and Stage B (voice, 30), excluding items with no result:

| Note | On correct answers (false alarm) | On wrong answers | Pointed at the actual error |
|---|---|---|---|
| "₹X was worked out from the words said" (typed) | 5 | 1 | 1 (ஐநூறு → ₹150) |
| same, voice | 0 | 1 | 1 ("आज सौ" → ₹100) |
| "Nobody was said to have paid, so Kitty put you" | 7 (2 typed, 5 voice) | 1 | 0 (on `b-tg-soundalike` it fired, but the real error was You dropped from the sharers) |
| "Check the spelling of X" (voice) | 5 | 6 (across 3 items) | 1 (the invented person "Meen") |
| "Check who paid" (model said payer unclear) | 0 | 1 | partly |

**Wrong answers with no note at all:** 2 of 8 (`b-hi-hotel`, `b-inen-myself`).

What this shows:
- **Amount note:**
  - **Typed:** mostly noise. **Voice:** the only guard against misheard number words.
  - **Proposal:**
    - add a small, offline **number-word checker** (Tamil, Hindi and English units, hundreds, thousands, lakh; romanised and native script);
    - **typed input:** drop the note when the checker reads the same number from the words; show a **stronger** note when it reads a different one ("ஐநூறு is 500, Kitty read ₹150");
    - **voice input:** keep the note but **show the words it came from** ("₹100, from 'आज सौ'"), because the checker would agree with a misheard word and wrongly hide the warning.
  - **Tests:** ஐநூறு, dedh hazaar, saadhe chaar sau, aayirathi irunooru, "आठ सौ" vs "आज सौ", 1.5 lakh.
- **"Kitty put you":** 1 useful in 8.
  - Most false alarms come from the speaker's "I" being garbled (मैं heard as "मेन", "Main Day") or dropped ("Paid 1.5 lakh …").
  - **Proposal:** count a sentence-initial "paid"/"spent"/"diya"/"kuduthen" with no other named payer as first person, and include the commonly garbled forms of मैं in Devanagari.
  - **Don't** add "mein" (it also means "in").
  - **Tests:** "Paid 1.5 lakh …" gives no note; "Dinner 1200 with Senthil and Pooja" still gives the note.
- **Spelling notes:** mostly a **benchmark artefact**.
  - They fire for every unknown name in Tamil or Hindi transcripts, and most benchmark items have **no friend list**. In real use, friends are known, so the note fires only for genuinely new names.
  - **Proposal:** merge them into one line ("Check the names: Rahul, Meen, Sameer").
  - Measure precision again only after friend lists are realistic (section C's experiment file).
- **New payer-not-sharing check:** see section B. 3 useful, 0 false alarms in the saved runs.
- **Never block Save.** The notes remain "check", not errors. This keeps one tap for correct answers, which is most of them.

---

## F. Groq JSON errors and the backup model

**What happened:**
- The main model failed Groq's JSON check in **every run so far**: 1–2 per 30–34 calls.
- The backup model answered 3 times in Stages A and B: **1 right, 2 wrong**.
- Each backup use also made the comparison invalid.

**Proposal (P3):** on this specific error (400, JSON validation failed), retry the **same main model once** if the time budget allows, then use the backup.
- **Benefits:** keeps results single-model more often, and keeps the backup for real outages.
- **Risk:** about 1 s more on that error.
- **Tests (fake client):**
  - a JSON error then success on the main model means no backup;
  - a JSON error twice falls back to the backup;
  - with no time left, no retry.

**Not proposed:** switching to strict JSON-schema output. It would change how expenses are extracted, which is outside this scope.

---

## G. What not to change

These are unaffected by every proposal above:
- the money maths (`splits.py`);
- the reading model's instructions;
- storage format, UI layout, deployment;
- the main → backup architecture;
- the friend-name prompt itself, until the experiment (C) decides.

**Waiting for approval before implementing anything.**
