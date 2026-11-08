# Kitty voice pipeline, Phase 2: implementation report

**Date:** 7 November 2026
**Architecture kept:** browser recording → FastAPI → Groq Whisper large-v3 → Groq gpt-oss → Python checks and `splits.py` → confirmation card. No new services, no new dependencies, no change to how expenses are saved.

## Accuracy: not yet measured

**No accuracy improvement is claimed.** The benchmark and the before/after commands are ready, but Groq calls need the API key, which only you run. Until then, the only verified results are the offline tests below and the card check in the browser.

```bash
set -a; . ../Unscam/.env; set +a; ./.venv/bin/python bench/run.py all --code baseline && ./.venv/bin/python bench/run.py all --code current
```

Run it from `~/voice-split`. It takes about 30 minutes and roughly 120 model calls, which fits in one day of the free tier. Then:

```bash
./.venv/bin/python bench/run.py compare baseline-text current-text
```

## What changed

### 1. Benchmark (`bench/`)

- **Text set:** 30 new sentences in six language styles, separate from the development examples, each with the right answer.
- **Synthetic audio:** 26 clips made free on the Mac with its Indian voices. They test the pipeline, not real-world accuracy.
- **Real audio:** five existing clips, unscored until their reference words are written down. `bench/README.md` gives a plan for 60–100 more.
- **Scorer measures:** word and character error rate; names heard in the transcript; amount, payer, participants and names correct; final expense correct to the paisa; how many wrong answers the card flagged; time per step. Results are broken down by language.
- **Before/after:** a snapshot of the pre-Phase-2 code (`bench/.baseline/`) lets any run be compared.

### 2. Name-aware transcription (`reader.py`: `speech_prompt`, `_speech`, `transcribe`)

- **Names in the prompt:** your friends' names, which already reached the server, now go into Whisper's prompt after the language hint, open group first. Groq allows 224 prompt tokens. Without Whisper's tokenizer, the count is a deliberately high estimate with a 190 budget: about 33 names fit with the Tamil hint, 46 with Hindi, 60+ with English.
- **Safe names only:** a name longer than 30 characters or 3 words, or containing digits or symbols, is left out, so it can't carry instructions.
- **Language handling unchanged:** detected automatically, never forced. The existing "came back translated?" second pass still runs, but only if the time budget allows.
- **Echo check:** with silence, Whisper can repeat its prompt ("Names: Arun, Ravi"). A transcript made only of prompt words now counts as silence.
- **Small hint addition:** the English hint gained common Indian expense words (Swiggy, Ola, rent).
- **No word replacement:** the transcript is never edited. Fuzzy name matching is unchanged (exactly one close friend name), but every match now shows on the card ("Heard 'Ravivar', matched to your friend Ravi").

### 3. Checking the AI's answer (`reader.py`: `_number`, `to_expense`, `review`)

- **Amounts are never guessed or changed.** Numbers and digit strings ("2,500", "₹750") are read as they are. Anything else ("about 500", negative, zero) becomes *missing*, and the card asks for it.
- **Bad JSON shapes don't crash or slip through.** That covers participants as text instead of a list, unreadable shares or items, and unknown fields.
- **New checks against what was said**, shown as "Check …" notes on the card:
  - **Amount:** the total isn't a number that was said, and isn't a sum of the numbers said (food 1,200 + drinks 400 is fine; 1.2k and 1.5 lakh are understood). Or it came only from number words, which is a soft note.
  - **Names:** a person who wasn't said and isn't a friend.
  - **Assumptions:** a friend added who wasn't mentioned, unless "everyone", "sab" or "ellarum" was said.
  - **Payer:** a payer who wasn't mentioned, or "You" assumed with no I, naan or maine said.
  - **Shares or items** that couldn't be read.
- **Native-script names** (Tamil or Hindi) can't be compared with English spellings, so for those only unknown names get a spelling note. No false alarms on known friends.
- **Edits only clear notes.** `/api/check` reruns the checks as you edit, so a fixed problem clears. A note can only disappear after an edit, never newly appear, so adding someone yourself doesn't trigger "wasn't mentioned".
- **Maths unchanged:** all of it stays in `splits.py`.

### 4. Errors and speed (`reader.py`, `server.py`, `app.js`)

- **Time budget:** each request gets 38 seconds, shared by every AI call, and the browser now waits 45 seconds. Before, the worst case of 25-second timeouts with retries could outlast the browser's 40-second limit.
- **Retries:** the SDK's hidden retries are off. The backup model (gpt-oss-120b) is now tried on any fixable failure, not just rate limits: busy, timeout, connection, server error, broken or wrong-shaped JSON.
- **Plain messages, no internals:**

  | Status | Cause | Message |
  |---|---|---|
  | 429 | Free AI limit reached | "Wait a minute and try again" |
  | 504 | Too slow | Try again, or add it by hand |
  | 502 | Groq unreachable | Try again in a moment |
  | 400 | Unreadable recording | Record it again |

  The logs record only the error type.
- **No extra AI calls** were added. The second speech pass is now skipped when time is short.

### 5. Bugs found and fixed along the way

- **Tamil vowel signs** were removed as if they were punctuation when splitting words, so "நன்றி" ("thank you", a common Whisper output from silence) wasn't recognised as silence. Fixed with a script-safe word splitter.
- **A string amount** from the model ("2,500") used to fail later with a confusing error. Now it is read exactly.

## Tests

| Check | Result |
|---|---|
| All unit tests (`python -m unittest`) | **83 pass**: the 49 original tests plus 34 new ones for checks, numbers, prompts, the backup model, error codes, the time budget and the scorer |
| Split and settle-up maths (`test_splits.py`) | Unchanged and passing |
| Confirmation card in the browser | Notes show, clear after fixes, Save works, saved expense has the same fields as before (screenshots 19 in `test-outputs/`) |
| Text benchmark, before and after | **Not run yet** (needs your key) |
| Synthetic audio benchmark, before and after | **Not run yet** (needs your key) |
| Real audio | **Can't be scored**: the 5 clips have no reference words, and more recordings are needed |

## Files

| File | Change |
|---|---|
| `reader.py` | Name-aware prompt, echo check, time budget, backup-model retries, number and structure checks, `review()` |
| `server.py` | Error mapping, deadline per request, `checks` in the card response, optional `transcript` on `/api/check` |
| `public/static/app.js` | Browser wait 45 s, shows and refreshes checks |
| `public/index.html`, `public/static/style.css` | The checks list on the card, in existing colours; cache versions bumped (with `public/sw.js`) |
| `test_reader.py`, `test_server.py`, `test_bench.py` | New tests |
| `bench/` | Benchmark: `text.json`, `run.py`, `make_synthetic.py`, `audio/*.json`, `README.md` |
| `.gitignore` | Benchmark audio, baseline snapshot and raw results stay local |
| `test-outputs/` | Card screenshots and notes |

The 430px width change from earlier is in the same working tree (`style.css`, `sw.js`). Nothing is committed.

## Still open

1. **Accuracy numbers:** run the benchmark, then record real clips. Until then, nobody knows whether names in the prompt help or hurt.
2. **The prompt's token count is an estimate.** If Groq rejects a prompt as too long, speech fails with a 400. The 190 budget leaves a margin, but it hasn't been tested against Groq.
3. **Names in the prompt can bias Whisper** toward friend names when someone new is mentioned. The card note and the benchmark's "names invented" measure will show whether this happens.
4. **Number words** (aayiram, dedh hazaar) are still read only by the model. The card now says so, but doesn't verify them.
5. **The daily cap** is still an in-memory counter, so it isn't reliable on Vercel.
6. **Phase 1's understanding gaps are untouched:** dates, currency, advances, settlements, corrections, several expenses at once.

## Recommended next phase

**Phase 3: measure, then teach Kitty the missing kinds of expense.**

1. Run the benchmark and record 60–100 real clips, then decide from the numbers whether to keep names in the prompt and whether to try `reasoning_effort: low`. That setting would cut tokens, roughly doubling free reads a day if accuracy holds.
2. Add the fields Phase 1 found missing, one at a time, each with benchmark cases first: date, then advances and several payers, settlements, and corrections that use the last expense.
