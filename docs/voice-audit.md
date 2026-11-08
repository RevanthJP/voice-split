# Kitty voice and language understanding: Phase 1 audit

**Date:** 7 November 2026
**Scope:** the voice recording, speech-to-text, language detection and expense-reading path, as written in the code today (`reader.py`, `server.py`, `splits.py`, `public/static/app.js`, the eval files). No code was changed for this audit.
**Status:** for review. Nothing in the Recommendations section has been built.

---

## 1. Summary

Kitty's voice path is short and sound: record in the browser, run one speech-to-text call on Groq (Whisper large-v3), then one Groq language-model call (gpt-oss-20b, falling back to 120b) that returns JSON. Plain Python code (`splits.py`) does all the money maths, to the paisa. The AI never does arithmetic, and the person always sees and edits a confirmation card before anything is saved. That design is right and worth keeping.

The gaps are in four places:

1. **What Kitty can understand.** The reading model only knows "one expense, one payer, who shares". It has no fields for dates, currency, advances, partial payments, settlements or corrections, so six items on the product-vision list cannot be read today, however good the speech recognition is.
2. **How accuracy is measured.** There are 32 typed test sentences (15 of them English, only 2 in Hindi script) and no automated test on real recordings, so there is no number for speech accuracy at all.
3. **Free-tier capacity.** The language model's token limit (8,000 tokens a minute on Groq's published base limits) allows roughly 3 to 5 voice reads a minute across *all* users. The app's own cap of 300 reads a day isn't enforced reliably on Vercel.
4. **Unused free accuracy levers.** The person's friend names are already sent to the server but not given to the speech model, which is the cheapest name-accuracy gain available.

---

## 2. How it works today

```
Phone browser / installed app
  MediaRecorder (webm/opus; mp4 on iPhone), tap to start, tap to stop, 45 s cap
  live level meter only (no silence trimming, no auto-stop)
        │  multipart upload: audio + friend names ("Arun|Ravi|…") + language ("" always)
        ▼
FastAPI on Vercel  (server.py  /api/read-audio)
  size check (4 MB), in-memory daily counter (300)
        │
        ▼
reader.transcribe()                                   Groq  whisper-large-v3
  call 1: no language set, short hint sentence ─────▶ text + detected language + no_speech_prob
  silence check: stock phrases + average no_speech_prob > 0.6
  if detected Tamil/Hindi but no Tamil/Hindi script in the text (likely translated):
  call 2: same audio, language=ta/hi, native-script hint ─▶ text
        │ transcript
        ▼
reader.read_expense()                                 Groq  openai/gpt-oss-20b (temp 0, JSON mode)
  system prompt with number words, name and pronoun rules   on rate limit only → gpt-oss-120b
  user message: "Known people: … / Expense: <transcript>"
        │ JSON: description, total, payer, participants, mode, values, items, missing
        ▼
reader.to_expense()   name clean-up: known-name match, one-letter fuzzy snap, pronoun drop,
                      "Arun Ravi" → two people unless a surname, missing amount/people flags
        ▼
splits.owed_shares()  exact paise maths, raises a plain-English error if it can't add up
        ▼
Confirmation card (app.js showCard): the transcript in quotes, editable description, amount,
payer, sharers, items; /api/check recalculates after edits with no AI call → Save to phone
```

Typed input takes the same route from `read_expense()` onward (`/api/read-text`).

---

## 3. Findings against the 14 audit questions

| # | Question | What the code does |
|---|---|---|
| 1 | Speech provider | Groq Cloud, through the `groq` Python SDK (`reader._client`, `max_retries=1`, `timeout=25`). |
| 2 | Model and configuration | `whisper-large-v3`, `response_format="verbose_json"`, `temperature=0`, a `prompt` hint per language (`_SPEECH_HINT`), `language` set only on the retry. |
| 3 | Recording | `MediaRecorder` in `app.js startRecording()`. `getUserMedia({audio: true})` with no explicit constraints, so echo cancellation, noise suppression and gain control are whatever the browser defaults to. Tap to start, tap to stop, automatic stop at 45 seconds, and recordings under 0.8 seconds are rejected. |
| 4 | Format, sample rate, encoding | The first supported type of `audio/webm;codecs=opus`, `audio/webm`, `audio/mp4`, `audio/ogg`. No sample rate or bitrate is set: the browser's default (usually 48 kHz Opus). Groq downsamples to 16 kHz mono itself. |
| 5 | Upload and processing | One multipart POST with the audio, friend names joined by `|`, and a language field. The server reads up to 4 MB into memory, then makes Whisper call 1, maybe Whisper call 2, then the model call, all one after another. The browser gives up after 40 seconds. |
| 6 | Language detection | Whisper's own detection. The app used to offer a language choice, but `paintLangs()` now always sends an empty language, so detection is always automatic. If Whisper says Tamil or Hindi but the text has no Tamil or Hindi script, the audio is sent a second time with the language fixed. |
| 7 | Transcription prompts | One hint sentence: English for auto-detect, a Tamil-script and English mix for `ta`, and Hindi script for `hi`. The friend names are **not** included. |
| 8 | Language-model integration | Groq chat completions, `openai/gpt-oss-20b` at temperature 0 with `response_format={"type": "json_object"}`. It falls back to `gpt-oss-120b` only on a rate-limit error. The reasoning effort is the default, not set. |
| 9 | Transcript to expense | One model call returns the JSON. `to_expense()` cleans the names and flags missing parts. `splits.py` does the maths. |
| 10 | Validation | Names: exact match to a known friend, one-letter-off snap when only one friend fits, pronoun removal, surname rule. Amount: only "missing or zero" is checked here; `to_paise` rejects non-numbers later. Items must fit inside the total (in `splits.py`). Nothing checks that the amount or names were actually in the transcript. |
| 11 | Errors and ambiguity | The model fills `missing` (amount, people, payer); the card asks "Add the amount" or "Choose who shares it". If no payer is said, the payer silently defaults to You. Silence or noise that comes back with no amount and nobody else stays on the mic screen (`heardNothing`). Groq failures become a 502 with a plain message. The browser times out after 40 seconds. |
| 12 | How results are shown | The confirmation sheet shows the transcript in quotes, then editable fields, the per-person shares, and any problem. The transcript itself can't be edited and re-read; the person fixes the fields by hand. |
| 13 | Retention | Kitty's server keeps nothing: no database, no audio on disk, and logs record only the error type. Saved expenses live in the phone's `localStorage`. Groq says it keeps no inference data by default, but may log inputs and outputs for up to 30 days to fix reliability problems or investigate abuse, stored in the US, unless the account owner turns that off in Data Controls. Five test recordings sit in `results/audio/` on this laptop; they are git-ignored and not in the public repo. |
| 14 | Security and privacy | No sign-in. The API keys stay on the server. Friend names (not numbers) are sent to Kitty's server and to Groq on every read. Contacts are matched in the browser and never uploaded. The daily cap is an in-memory counter (see 4.4). |

---

## 4. Limitations and risks

### 4.1 Understanding: what the reading model can't express

The JSON has one `payer`, one `total` and one list of sharers. These product-vision items have no field at all:

| Vision item | Today | Example that fails |
|---|---|---|
| Date and time | Not read. The expense is stamped with the moment it's saved. | "Yesterday dinner ku 2500" is saved as today. |
| Currency | Assumed rupees. | "$40 for the Airbnb" is saved as ₹40. |
| Partial payments and advances | Only one payer. | "Hotel 6000 naan pay panniten, Akash already 1000 kuduthutan": Akash's 1,000 is lost or becomes a wrong item. |
| Settlements | No voice path. Settling is done from the balance screens. | "Ravi gave me back 500" is read as a new ₹500 expense. |
| Corrections | Every read is stateless; the previous expense isn't sent. | "No, make that 2,000", "remove Suresh from the last one". |
| Pronouns across sentences | Handled only inside one recording. | "Ravi paid. Split it with him and Arun" works; referring back to an earlier expense doesn't. |
| Several expenses in one go | One expense per read. | "Petrol 500 and lunch 900" becomes one expense. |
| Mixed rupees and items in one sentence | Supported through `items`. | Works today. |

### 4.2 Speech recognition accuracy risks

- **Names are the weakest part.** Indian names are what Whisper gets wrong most often ("Ravi" heard as "Ravivar"), and the code catches only one-letter slips. Friend names already reach the server but aren't put in Whisper's `prompt`, which takes up to 224 tokens and is meant for exactly this.
- **Code-mixed speech can be translated.** With no language set, Whisper sometimes returns English when Tamil or Hindi was spoken. The script check catches Tamil and Hindi, but Tanglish answers in Latin letters look the same as a translation, and nothing covers other Indian languages (Telugu, Kannada, Malayalam and so on are detected but get no retry).
- **Numbers.** Number words are handled by prompt rules in the reading step, not in speech recognition. Hindi script with Tamil sounds (`आईरम` for "aayiram") needs the model to read by sound, which is fragile.
- **One fixed hint per language.** The hint sentences are general. They don't adapt to the person's own vocabulary (friend names, places, "PG rent", "Swiggy").
- **No audio cleaning.** No silence trimming, so long pauses count toward the audio limits and give Whisper room to invent words ("E aí", "Thank you"). The silence check uses a fixed list and an average no-speech threshold.
- **Single speaker assumed.** Background talk in a restaurant or cab goes straight in.

### 4.3 Language-model risks

- `json_object` mode guarantees JSON, not this JSON. A missing key or a string amount ("2,500") is caught late, by `to_paise`, as a confusing error.
- Nothing checks the answer against the transcript. If the model invents ₹1,000 or a person who wasn't said, only the person's eye on the card catches it.
- The fallback model is used only on a rate-limit error. Timeouts, server errors and bad JSON fail straight to "The AI couldn't read that right now".
- The prompt is about 3,300 characters, all rules and no worked examples. It has grown rule by rule as failures were found, and its ordering now affects results.

### 4.4 Capacity and speed on the free tier

Figures are from Groq's public rate-limits page on 7 November 2026, which labels them base limits. The account's own limits page is the final word.

| Model | Per minute | Per day |
|---|---|---|
| whisper-large-v3 | 20 requests, audio 7,200 s/hour | 2,000 requests, 28,800 s of audio |
| gpt-oss-20b | 30 requests, **8,000 tokens** | 1,000 requests, 200,000 tokens |
| gpt-oss-120b | same as 20b, counted separately | same |

- **The token limit is the real ceiling.** Each read is about 900 tokens of instructions plus the transcript plus the model's hidden reasoning, so about 1,500 to 2,500 tokens. That's **about 3 to 5 reads a minute** and **80 to 130 reads a day** per model, across all users together. The fallback model doubles that. The app's cap of 300 a day is set above what the models allow.
- **Every clip costs at least 10 seconds of audio.** A 3-second clip counts as 10, and the translation retry counts again, so the audio budget runs out faster than the clip lengths suggest.
- **The cap isn't reliable.** `_usage` lives in memory. On Vercel each new or extra server instance starts again from zero, so the cap can be crossed, and anyone with the link can use up the shared quota.
- **The waits stack up.** Upload, then Whisper, maybe a second Whisper, then the model with reasoning, all in sequence. The Groq client allows 25 seconds per call with one retry, which is longer than the browser's 40-second limit in the worst case, so a slow read shows "taking too long" even when the server would have finished.

### 4.5 Privacy and security

- **What is good:** no server storage, no contact upload, error-only logging, keys server-side, a 4 MB upload limit, and the privacy note before the contact picker.
- **To disclose:** friend names and the spoken audio go to Groq, a US company, and may be logged for up to 30 days in the two cases above. The app doesn't say so anywhere a user would see.
- **To check in the Groq console:** whether the opt-out of the 30-day troubleshooting logs is switched on for this account.
- **Low risk:** prompt injection. A person can only steer the reading of their own expense, and the card shows the result.
- **Open:** no per-device or per-IP limit, so the shared free quota can be drained by one person or a script.

### 4.6 Testing

- **Text tests:** 24 development sentences plus 8 held back. 7 of the 8 held-back sentences read correctly (the miss: a Tamil-script sentence with the wrong payer).
- **Language balance:** 15 English, 8 Tanglish, 4 Tamil, 3 Hinglish, 2 Hindi. Indian English accents, Telugu, Kannada and Malayalam speakers, and noisy audio aren't represented.
- **Speech:** no automated test. Five local recordings exist but aren't scored, so there is no word-error or name-error number to improve against.
- **Scoring is good:** the eval scores the final money (payer and shares to the paisa), which is what matters. It should stay the headline number.

---

## 5. Recommended improvements (for approval, nothing built)

Ordered by value for zero cost. Every item uses what Kitty already has unless it says otherwise.

| # | Change | Why | Cost | Effort |
|---|---|---|---|---|
| 1 | **Build a real-speech test set and score it.** 60–100 short recordings from 8–10 friends: Tamil, Tanglish, Hindi, Hinglish, Indian English, some in noise. Score transcript errors, name errors, and the final money. Keep audio off GitHub. | Without it, no change can be shown to help. | Free (Groq free tier, ~100 clips a run) | Medium |
| 2 | **Put the person's friend names into Whisper's prompt**, within the 224-token limit, alongside the hint. | Directly targets the weakest part, names. | Free | Small |
| 3 | **Extend the reading schema**: `date` (relative words → a real date in the app), `currency`, `paid_by` with several payers for advances, an `intent` of expense / settlement / correction, and several expenses in one read. The maths stays in `splits.py`. | Six vision items are impossible without new fields. | Free | Large; do in steps |
| 4 | **Send the last expense as context** for corrections ("make that 2,000", "remove Suresh"), and show the change as a before/after card. | Corrections and cross-sentence pronouns. | Free | Medium |
| 5 | **Check the answer against the transcript**: the amount must appear in it (digits or number words), and every new name must appear in it or be a known friend; otherwise flag it on the card. | Stops invented amounts and people silently reaching the card. | Free | Small |
| 6 | **Make the model step sturdier**: strict JSON schema if Groq supports it for gpt-oss (to verify), `reasoning_effort` set low after measuring, fallback on any error not just rate limits, a few short worked examples in the prompt. | Fewer failures, faster reads, fewer tokens. | Free | Small |
| 7 | **Clean the audio in the browser**: ask for mono with noise suppression and echo cancellation on, stop automatically after about 1.5 s of silence using the existing level meter, trim leading and trailing silence. | Less noise, fewer invented words, less audio counted. | Free | Small–medium |
| 8 | **Fix the time limits** so the server always answers before the browser gives up, and tell the person which step is slow. | Removes the "taking too long" case. | Free | Small |
| 9 | **Protect the shared quota** with a real limit per device and per day, held somewhere that survives restarts (a free key-value store, to verify the limits first). | The in-memory cap isn't real on Vercel. | Free tier to verify | Medium |
| 10 | **Say where voice goes**: one line near the mic or in Account, and check Groq's Data Controls opt-out. | Honest privacy. | Free | Small |
| 11 | **Benchmark free open models offline**: AI4Bharat's Indian-language speech models and Whisper large-v3-turbo, on the test set from item 1, using free notebook GPUs (Colab or Kaggle). Only switch if they clearly win. Hosting an open model permanently needs a GPU and isn't free, so this is for measuring, not production. | Shows whether a better free model exists. | Free | Medium |
| 12 | **Try the browser's own speech recognition** (Chrome's `en-IN`, `ta-IN`, `hi-IN`) as a live preview while speaking. It's free, but audio goes to Google and it isn't on every browser, so verify both before relying on it. | Instant feedback, no Groq audio cost. | Free, verify terms | Medium |

**Suggested order:** 1 → 2, 5, 6, 8 (quick wins, measured against item 1) → 3 and 4 (the new understanding) → 7, 9, 10 → 11 and 12 as experiments.

**Keep as they are:** the confirmation card before saving, the paise maths in `splits.py`, contacts staying on the phone, no server storage, and scoring on final money.

---

## 6. Sources

- Groq rate limits: https://console.groq.com/docs/rate-limits (read 7 November 2026; the page says to check the account's own limits page)
- Groq speech-to-text (10-second minimum billing, 224-token prompt, 16 kHz mono, formats, turbo vs large-v3): https://console.groq.com/docs/speech-to-text
- Groq data retention: https://console.groq.com/docs/your-data
- Code: `reader.py`, `server.py`, `splits.py`, `public/static/app.js` (lines 66–80, 170–252, 275–330), `eval_reading.py`, `cases.json`, `cases_heldout.json`, `test-outputs/ai-reading-results.json`
