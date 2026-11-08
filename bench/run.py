"""Kitty's benchmark: how well speech and the expense reader work, scored on real outcomes.

Kept apart from the development examples (cases.json, cases_heldout.json): nothing here is
used to write prompts or rules, so the numbers stay honest.

Run from the project folder, with GROQ_API_KEY set:
  python bench/run.py text  --code baseline --label baseline
  python bench/run.py text  --code current  --label current
  python bench/run.py audio --set synthetic --code baseline --label baseline-synth
  python bench/run.py compare baseline-text current-text

Options: --code current|baseline   --label NAME   --set synthetic|real|both   --limit N   --sleep SECONDS
Results go to bench/results/<label>-<mode>.json (raw, kept local) and .md (summary).

The benchmark never changes the app. It wraps the app's Groq client from outside to record which
model answered each reading (the main gpt-oss-20b or the backup gpt-oss-120b) and every Whisper call
(first or second pass, detected language, per-segment signals). A comparison between runs that used
different reading models is marked invalid.

Speech scores come in two forms: raw WER/CER, and name-normalized WER/CER, where a name's listed
spellings count as the same word. A code-mixed clip (labelled hinglish or tanglish) whose reference is
in English letters but whose transcript is in Tamil or Hindi script is marked not comparable and left
out of the comparable averages. The same mismatch on any other clip stays in those averages and is
flagged for inspection. Raw all-clip scores are always kept. Confirmed errors and uncertain results are recorded and reported separately.
"""
import argparse
import collections
import importlib
import inspect
import json
import re
import sys
import time
import unicodedata
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent
RESULTS = HERE / "results"


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


NATIVE = re.compile(r"[஀-௿ऀ-ॿ]")
SCRIPTS = {"ta": re.compile(r"[஀-௿]"), "hi": re.compile(r"[ऀ-ॿ]")}
# Canonical name -> its certain spellings in Tamil and Hindi script (bench/name_aliases.json).
ALIASES = {k: v for k, v in read_json(HERE / "name_aliases.json").items() if not k.startswith("_")}
SCRIPT_NAMES = {"ta": "Tamil", "hi": "Hindi"}
MODEL_CALLS = []  # (model, "ok" or error type) for every reading call, filled by track_models
SPEECH_CALLS = []  # one entry per Whisper call for the current clip, filled by track_models
SEGMENT_SIGNALS = ("no_speech_prob", "avg_logprob", "compression_ratio")
SCRIPT_SWITCHED = "switched to Tamil/Hindi script"
SCRIPT_TRANSLATED = "translated or wrong script"
# Items labelled as code-mixed in the dataset, whose references are transliterated into English letters.
CODE_MIXED_LANGS = {"hinglish", "tanglish"}


def load_code(which):
    path = HERE / ".baseline" if which == "baseline" else ROOT
    if which == "baseline" and not (path / "reader.py").exists():
        sys.exit("bench/.baseline/ is missing. Recreate it with: git show fa04e83:reader.py > bench/.baseline/reader.py "
                 "(and the same for splits.py)")
    sys.path.insert(0, str(path))
    for name in ("reader", "splits"):
        sys.modules.pop(name, None)
    reader = importlib.import_module("reader")
    track_models(reader)
    return reader, importlib.import_module("splits")


def segment_signals(resp):
    """Whisper's per-segment signals, where the response has them. A missing value stays None."""
    segments = resp.get("segments") if isinstance(resp, dict) else getattr(resp, "segments", None)
    if not isinstance(segments, (list, tuple)):
        return []
    out = []
    for seg in segments:
        read = seg.get if isinstance(seg, dict) else lambda key: getattr(seg, key, None)
        out.append({k: read(k) if isinstance(read(k), (int, float)) else None for k in SEGMENT_SIGNALS})
    return out


def _watch_chat(c):
    create = c.chat.completions.create
    if getattr(create, "__name__", "") == "logged":  # this client is already being watched
        return

    def logged(*a, **k):
        try:
            resp = create(*a, **k)
        except Exception as err:
            MODEL_CALLS.append((k.get("model"), type(err).__name__))
            raise
        MODEL_CALLS.append((k.get("model"), "ok"))
        return resp
    c.chat.completions.create = logged


def _watch_speech(c):
    create = c.audio.transcriptions.create
    if getattr(create, "__name__", "") == "logged_speech":
        return

    def logged_speech(*a, **k):
        # The benchmark always starts with automatic language detection, so a call that forces a
        # language is the app's second pass over audio that came back looking translated.
        entry = {"pass": "second" if k.get("language") else "first", "requested_language": k.get("language"),
                 "detected_language": None, "status": None, "segments": []}
        SPEECH_CALLS.append(entry)
        try:
            resp = create(*a, **k)
        except Exception as err:
            entry["status"] = type(err).__name__
            raise
        detected = resp.get("language") if isinstance(resp, dict) else getattr(resp, "language", None)
        entry.update(status="ok", detected_language=detected if isinstance(detected, str) else None,
                     segments=segment_signals(resp))
        return resp
    c.audio.transcriptions.create = logged_speech


def track_models(reader):
    """Record every reading call (model, and whether it answered) and every speech call the app makes."""
    original = reader._client

    def client(*args, **kwargs):
        c = original(*args, **kwargs)
        for watch in (_watch_chat, _watch_speech):
            try:
                watch(c)
            except AttributeError:  # a client without this API
                pass
        return c
    reader._client = client


# ---------- text measures ----------

def normalise(text):
    """Lower case, digits without commas, no punctuation or symbols. Keeps Tamil and Hindi vowel signs."""
    text = unicodedata.normalize("NFC", str(text or "")).lower()
    text = re.sub(r"(?<=\d),(?=\d)", "", text)
    text = "".join(" " if unicodedata.category(ch)[0] in "PS" else ch for ch in text)
    return text.split()


def edit_distance(a, b):
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]


def wer(ref, hyp):
    r, h = normalise(ref), normalise(hyp)
    return edit_distance(r, h) / max(1, len(r))


def cer(ref, hyp):
    r, h = "".join(normalise(ref)), "".join(normalise(hyp))
    return edit_distance(r, h) / max(1, len(r))


def case_names(case):
    """Everyone this item is about: the people who owe, the payer, the friend list and any per-item spellings."""
    names = [*(case.get("owed") or {}), case.get("payer"), *case.get("people", []), *case.get("name_forms", {})]
    return [n for n in dict.fromkeys(names) if n and n != "You"]


def canonical_words(text, case):
    """The text's words, with each exact listed spelling of a name replaced by that name. Only exact
    matches count: an inflected form or an unlisted spelling is left alone, so it stays a difference."""
    forms = case.get("name_forms", {})
    table = {}
    for name in case_names(case):
        canonical = normalise(name)
        if len(canonical) != 1:  # full names are compared as they are
            continue
        for form in name_forms(name, forms.get(name, [])):
            parts = normalise(form)
            if len(parts) == 1:
                table[parts[0]] = canonical[0]
    return [table.get(w, w) for w in normalise(text)]


def wer_normalized(ref, hyp, case):
    r, h = canonical_words(ref, case), canonical_words(hyp, case)
    return edit_distance(r, h) / max(1, len(r))


def cer_normalized(ref, hyp, case):
    r, h = "".join(canonical_words(ref, case)), "".join(canonical_words(hyp, case))
    return edit_distance(r, h) / max(1, len(r))


def name_forms(name, extra=()):
    """The name plus its listed spellings in other scripts (alias file and any per-item name_forms)."""
    forms = [name, *[f for fs in ALIASES.get(name, {}).values() for f in fs], *extra]
    return list(dict.fromkeys(forms))


def _part_status(part, words):
    """'yes' if a word is this name part (or the part plus a known Latin ending), 'uncertain' if a
    Tamil/Hindi word starts with it and may just be an inflected form, else 'no'."""
    best = "no"
    native = bool(NATIVE.search(part))
    stem = part[:-1] if part.endswith("்") else None  # Tamil names change their last letter before an ending
    for w in words:
        if w == part or (w.startswith(part) and not native and not _longer_name(w, part)):
            return "yes"
        if native and (w.startswith(part) or (stem and w.startswith(stem))):
            best = "uncertain"
    return best


def name_match(name, text, extra_forms=()):
    """Is this person named in the text? 'yes', 'no', or 'uncertain' when it can't be decided: a possible
    inflected Tamil/Hindi form, or text in a script for which no spelling of this name is listed.
    Uncertain names are never silently counted as the same person, or as absent."""
    return name_match_detail(name, text, extra_forms)[0]


def name_match_detail(name, text, extra_forms=()):
    """(status, why it is uncertain or None)."""
    words = normalise(text)
    forms = name_forms(name, extra_forms)
    result = "no"
    for form in forms:
        statuses = [_part_status(p, words) for p in normalise(form)]
        if statuses and all(s == "yes" for s in statuses):
            return "yes", None
        if statuses and all(s != "no" for s in statuses):
            result = "uncertain"
    if result == "uncertain":
        return "uncertain", "possible inflected form"
    for script, rx in SCRIPTS.items():
        if rx.search(text or "") and not any(rx.search(f) for f in forms):
            return "uncertain", f"no {SCRIPT_NAMES[script]} spelling listed"
    return "no", None


def mentions(name, text, forms=()):
    """True only when the name is certainly in the text (see name_match)."""
    return name_match(name, text, forms) == "yes"


def _longer_name(word, part):
    """True when the word is a different, longer name rather than the name plus a suffix:
    Priyanka is not Priya; Ravikku and Arun's are Ravi and Arun."""
    rest = word[len(part):]
    return bool(rest) and rest not in {"kku", "ku", "ukku", "oda", "ode", "um", "ai", "ta", "kitta", "ke", "ko", "ne",
                                            "se", "ka", "ki", "ji", "bhai"}


def names_heard(case, transcript):
    """Share of the expected people whose name (in any listed spelling or script) is certainly in the transcript."""
    expected = [n for n in {*(case.get("owed") or {}), case.get("payer", "You")} if n != "You"]
    if not expected:
        return None
    forms = case.get("name_forms", {})
    return sum(mentions(n, transcript, forms.get(n, [])) for n in expected) / len(expected)


def names_heard_uncertain(case, transcript):
    """Expected people for whom it can't be decided whether the transcript names them, with the reason."""
    forms = case.get("name_forms", {})
    out = {}
    for n in sorted({*(case.get("owed") or {}), case.get("payer", "You")} - {"You"}):
        status, why = name_match_detail(n, transcript, forms.get(n, []))
        if status == "uncertain":
            out[n] = why
    return out


def friends_in_transcript(case, reference, transcript):
    """Friends from the list who are in the transcript but not in what was said (likely pulled in by the
    speech prompt), and friends for which that can't be decided either way."""
    forms = case.get("name_forms", {})
    inserted, uncertain = [], []
    for p in case.get("people", []):
        heard = name_match(p, transcript, forms.get(p, []))
        if heard == "no":
            continue
        said = name_match(p, reference, forms.get(p, []))
        if heard == "yes" and said == "no":
            inserted.append(p)
        elif "uncertain" in (heard, said):
            uncertain.append(p)
    return sorted(inserted), sorted(uncertain)


def amounts_in(text):
    """Amounts written with digits in the text, with 1.2k and 1.5 lakh worked out."""
    found = set()
    for m in re.finditer(r"(\d+(?:\.\d+)?)\s*(k|lakhs?|lacs?)?\b", (text or "").lower().replace(",", "")):
        found.add(round(float(m.group(1)) * (1000 if m.group(2) == "k" else 100000 if m.group(2) else 1), 2))
    return found


def script_check(case, reference, transcript):
    """Did speech come back in the script it was spoken in? Tamil or Hindi said in its own script but
    returned with none of that script was most likely translated."""
    if not transcript:
        return None
    ref_native, hyp_native = bool(NATIVE.search(reference or "")), bool(NATIVE.search(transcript))
    if ref_native and not hyp_native:
        return SCRIPT_TRANSLATED
    if not ref_native and hyp_native:
        return SCRIPT_SWITCHED
    return "ok"


# ---------- expense measures ----------

def score_expense(case, expense, missing, splits):
    me = splits.ME
    out = {"payer_ok": None, "amount_ok": None, "participants_ok": None, "names_ok": None, "final_ok": False}
    if "missing" in case:
        out["final_ok"] = case["missing"] in missing
        return out
    want = {k: float(v) for k, v in case["owed"].items()}
    try:
        total = float(expense.total)
    except (TypeError, ValueError):
        total = None
    out["amount_ok"] = total is not None and abs(total - sum(want.values())) <= 0.05
    out["payer_ok"] = expense.payer == case.get("payer", me)
    got = None
    if not missing:
        try:
            got = {k: v / 100 for k, v in splits.owed_shares(expense).items() if v}
        except splits.SplitError as err:
            got = f"error: {err}"
    sharers = set(got) if isinstance(got, dict) else set()
    out["participants_ok"] = sharers == set(want)
    said = {expense.payer, *expense.participants, *[p for i in expense.items for p in (*i.only, *i.excluded)]} - {me, ""}
    expected = (set(want) | {case.get("payer", me)}) - {me}
    allowed = expected | set(case.get("people", [])) | {w for w in re.findall(r"[A-Z][a-z]+", case["text"])}
    out["names_ok"] = expected <= said and said <= allowed
    out["final_ok"] = bool(out["payer_ok"] and isinstance(got, dict) and got.keys() == want.keys()
                           and all(abs(got[k] - want[k]) <= 0.011 for k in want))
    out["got"] = got
    return out


def diagnose(case, expense, scored, heard_text, notes, splits):
    """Why a reading went wrong, in categories a person can act on. heard_text is what the reader was
    given: the typed sentence, or the transcript of a clip."""
    me = splits.ME
    d = {}
    if "missing" in case or expense is None:
        if case.get("expect_check"):
            d["expected_check_shown"] = any(case["expect_check"] in n.lower() for n in notes or [])
        return d
    want = {k for k in case["owed"]}
    got = scored.get("got") if isinstance(scored.get("got"), dict) else {}
    friends = [p for p in case.get("people", []) if p != me]
    reference = case.get("reference") or case["text"]
    named = {expense.payer, *expense.participants, *[p for i in expense.items for p in (*i.only, *i.excluded)]} - {me, ""}
    expected = (want | {case.get("payer", me)}) - {me}

    d["extra_sharers"] = sorted(set(got) - want)
    d["missing_sharers"] = sorted(want - set(got)) if got else sorted(want)
    # A friend from the list who was never said, but ended up in the expense.
    forms = case.get("name_forms", {})
    unsaid = {p: name_match(p, reference, forms.get(p, [])) for p in named if p in friends and p not in expected}
    d["friend_added"] = sorted(p for p, m in unsaid.items() if m == "no")
    d["friend_uncertain"] = sorted(p for p, m in unsaid.items() if m == "uncertain")
    # An expected person missing while a different friend took their place.
    lost = [p for p in expected if p not in named]
    d["friend_swapped"] = [f"{p} → {q}" for p in lost for q in d["friend_added"]]
    if case.get("payer", me) != expense.payer:
        d["payer_error"] = "assumed You" if expense.payer == me else f"wrong person ({expense.payer})"
    if scored.get("amount_ok") is False:
        total = round(sum(float(v) for v in case["owed"].values()))
        heard = amounts_in(heard_text)
        d["amount_error"] = ("read wrong (amount was in the text)" if any(abs(h - total) <= 1 for h in heard)
                             else "heard wrong (amount missing from the text)" if heard
                             else "from number words")
    if (scored.get("amount_ok") and scored.get("payer_ok") and scored.get("participants_ok")
            and not scored.get("final_ok")):
        d["split_wrong"] = f"right people and amount, wrong shares (read as {expense.mode})"
    if case.get("expect_check"):
        d["expected_check_shown"] = any(case["expect_check"] in n.lower() for n in notes or [])
    return {k: v for k, v in d.items() if v not in ([], None, "")}


def script_excluded(lang, script):
    """Only a code-mixed item whose transcript switched script is incomparable and left out of the averages."""
    return script == SCRIPT_SWITCHED and (lang or "").strip().lower() in CODE_MIXED_LANGS


def script_flagged(lang, script):
    """The same mismatch on any other item: kept in the averages, but flagged for a person to look at."""
    return script == SCRIPT_SWITCHED and not script_excluded(lang, script)


def classify_errors(row):
    """Sort a result's problems into confirmed errors and uncertain results, which are never mixed.
    A wrong total is a confirmed error; whether it was misheard or misread may still be uncertain."""
    d = row.get("diagnosis") or {}
    confirmed, uncertain = {}, {}
    for key in ("friend_added", "friend_swapped", "payer_error", "split_wrong", "extra_sharers", "missing_sharers"):
        if d.get(key):
            confirmed[key] = d[key]
    if row.get("inserted_in_transcript"):
        confirmed["friend_in_transcript_not_said"] = row["inserted_in_transcript"]
    amount = d.get("amount_error")
    if amount == "from number words":
        confirmed["amount_wrong"] = "total differs from the expected amount"
        uncertain["amount_error_cause"] = "amount came from number words; misheard or misread can't be told apart"
    elif amount:
        confirmed["amount_heard_wrong" if amount.startswith("heard") else "amount_read_wrong"] = amount
    if d.get("friend_uncertain"):
        uncertain["friend_in_expense_uncertain"] = d["friend_uncertain"]
    if row.get("name_check_uncertain"):
        uncertain["friend_in_transcript_uncertain"] = row["name_check_uncertain"]
    if row.get("names_heard_uncertain"):
        uncertain["expected_name_uncertain"] = row["names_heard_uncertain"]
    if script_excluded(row.get("lang"), row.get("script")):
        uncertain["script_mismatch_not_comparable"] = row.get("lang")
    elif script_flagged(row.get("lang"), row.get("script")):
        uncertain["script_mismatch_flagged_for_inspection"] = row.get("lang") or "unknown language"
    elif row.get("script") == SCRIPT_TRANSLATED:
        uncertain["possibly_translated"] = row.get("lang") or "unknown language"
    return {**row, "errors_confirmed": confirmed, "errors_uncertain": uncertain}


# ---------- calling the pipeline ----------

def call(fn, *args, **kwargs):
    """One call with a single wait-and-retry on a rate limit, so a long run doesn't die halfway.
    call.retried says whether the last call needed that retry (it is recorded with the result)."""
    call.retried = False
    for attempt in (1, 2):
        try:
            start = time.time()
            value = fn(*args, **kwargs)
            return value, round(time.time() - start, 2), None
        except Exception as err:
            if attempt == 1 and "RateLimit" in type(err).__name__:
                print("  rate limited, waiting 65 s", flush=True)
                call.retried = True
                time.sleep(65)
                continue
            return None, None, f"{type(err).__name__}: {str(err)[:160]}"


def read(reader, text, people):
    """Returns (data, expense, missing, seconds, notes or error, models tried, model that answered)."""
    MODEL_CALLS.clear()
    data, secs, err = call(reader.read_expense, text, people)
    tried = list(MODEL_CALLS)
    answered = next((m for m, status in reversed(tried) if status == "ok"), None)
    if err:
        return None, None, None, secs, err, tried, answered
    expense, missing = reader.to_expense(data, people)[:2]
    notes = reader.review(expense, missing, text, people, data) if hasattr(reader, "review") else []
    return data, expense, missing, secs, notes, tried, answered


def transcribe(reader, path, people):
    SPEECH_CALLS.clear()
    audio = path.read_bytes()
    kwargs = {}
    if "people" in inspect.signature(reader.transcribe).parameters:
        kwargs["people"] = people
    return call(reader.transcribe, audio, path.name, None, **kwargs)


def speech_fields():
    """What Whisper did for the current clip: every call, and first and second passes counted apart."""
    calls = [dict(c) for c in SPEECH_CALLS]
    return {"speech_calls": calls, "speech_first_calls": sum(c["pass"] == "first" for c in calls),
            "speech_second_calls": sum(c["pass"] == "second" for c in calls)}


def reading_row(case, reader, splits, text, people):
    data, expense, missing, secs, notes, tried, model = read(reader, text, people)
    primary = reader.LLM_MODELS[0]
    row = {"model": model, "models_tried": [f"{m}: {s}" for m, s in tried],
           "answered_by": None if model is None else "primary" if model == primary else "backup",
           "primary_failed": any(m == primary and s != "ok" for m, s in tried),
           "bench_rate_limit_retry": call.retried}
    if expense is None:
        return {**row, "error": notes, "final_ok": False}
    scored = score_expense(case, expense, missing, splits)
    return {**row, **scored, "diagnosis": diagnose(case, expense, scored, text, notes, splits),
            "missing": missing, "notes": notes, "read_secs": secs, "ai": data}


# ---------- runs ----------

def run_text(reader, splits, args):
    cases = read_json(HERE / "text.json")[: args.limit or None]
    rows = []
    for c in cases:
        row = classify_errors({"id": c["id"], "lang": c["lang"], "categories": c.get("categories", []),
                               **reading_row(c, reader, splits, c["text"], c.get("people", []))})
        rows.append(row)
        print(("PASS " if row["final_ok"] else "FAIL ") + c["id"], f"[{row.get('model')}]",
              row.get("error") or row.get("diagnosis") or "", flush=True)
        time.sleep(args.sleep)
    return rows


def run_audio(reader, splits, args):
    cases = {c["id"]: c for c in read_json(HERE / "text.json")}
    clips = []
    if args.set in ("synthetic", "both") and (HERE / "audio" / "synthetic.json").exists():
        clips += read_json(HERE / "audio" / "synthetic.json")
    if args.set in ("real", "both") and (HERE / "audio" / "real.json").exists():
        clips += [c for c in read_json(HERE / "audio" / "real.json") if not c.get("phase3")]
    rows = []
    for clip in clips[: args.limit or None]:
        path = HERE / "audio" / clip["file"]
        case = cases.get(clip.get("case")) or {**clip, "text": clip.get("reference", ""), "id": clip["file"]}
        case = {**case, "reference": clip.get("reference") or case.get("text", "")}
        base = {"id": clip["file"], "kind": clip["kind"], "lang": case.get("lang", ""),
                "categories": case.get("categories", [])}
        if not path.exists():
            rows.append({**base, "error": "file not found", "final_ok": False})
            continue
        people = case.get("people", [])
        text, asr_secs, err = transcribe(reader, path, people)
        row = {**base, "transcript": text, "asr_secs": asr_secs, "speech_model": getattr(reader, "STT_MODEL", None),
               "speech_rate_limit_retry": call.retried, **speech_fields()}
        if err:
            row.update(error=err, final_ok=False)
        else:
            ref = clip.get("reference")
            if ref:
                script = script_check(case, ref, text)
                row.update(wer=round(wer(ref, text), 3), cer=round(cer(ref, text), 3),
                           wer_normalized=round(wer_normalized(ref, text, case), 3),
                           cer_normalized=round(cer_normalized(ref, text, case), 3),
                           wer_comparable=not script_excluded(case.get("lang"), script),
                           names_heard=names_heard(case, text), names_heard_uncertain=names_heard_uncertain(case, text),
                           script=script)
                if script_excluded(case.get("lang"), script):
                    row["not_comparable_reason"] = "script mismatch: code-mixed item, reference in English letters, transcript in Tamil/Hindi script"
                elif script_flagged(case.get("lang"), script):
                    row["script_flag"] = "reference in English letters, transcript has Tamil/Hindi script; kept in the averages because this item isn't labelled code-mixed"
                inserted, unsure = friends_in_transcript(case, ref, text)
                forms = case.get("name_forms", {})
                row.update(inserted_in_transcript=inserted, name_check_uncertain=unsure,
                           name_uncertain_reasons={
                               p: name_match_detail(p, text, forms.get(p, []))[1]
                               or name_match_detail(p, ref, forms.get(p, []))[1] for p in unsure})
            if not text:
                row.update(final_ok=False, error="nothing heard")
            elif case.get("owed") or case.get("missing"):
                row.update(reading_row(case, reader, splits, text, people))
            else:
                row["unscored"] = "no reference expense yet"
        row = classify_errors(row)
        rows.append(row)
        print(("PASS " if row.get("final_ok") else "----" if row.get("unscored") else "FAIL ") + row["id"],
              f"[{row.get('model')}]", "|", (text or "")[:60], "|", row.get("wer", ""), row.get("diagnosis") or "", flush=True)
        time.sleep(args.sleep)
    return rows


# ---------- summaries ----------

def pct(rows, key):
    vals = [r[key] for r in rows if r.get(key) is not None and not r.get("unscored")]
    return (f"{100 * sum(map(bool, vals)) / len(vals):.0f}% ({sum(map(bool, vals))}/{len(vals)})") if vals else "n/a"


def mean(rows, key):
    vals = [r[key] for r in rows if isinstance(r.get(key), (int, float))]
    return f"{sum(vals) / len(vals):.3f} (n={len(vals)})" if vals else "n/a"


def models_used(rows):
    return collections.Counter(r["model"] for r in rows if r.get("model"))


def model_line(rows):
    used = models_used(rows)
    fell_back = sum(bool(r.get("primary_failed")) for r in rows)
    retried = sum(bool(r.get("bench_rate_limit_retry") or r.get("speech_rate_limit_retry")) for r in rows)
    text = ", ".join(f"{m} × {n}" for m, n in used.most_common()) or "none"
    warn = " **Mixed models: results are not comparable with a single-model run.**" if len(used) > 1 else ""
    return (f"Models that answered: {text}. Main model failed on: {fell_back}. "
            f"Rate-limit waits by the benchmark: {retried}.{warn}")


def speech_line(rows):
    """First and second Whisper passes, counted apart. Empty for runs with no speech calls."""
    calls = [c for r in rows for c in r.get("speech_calls", [])]
    if not calls:
        return ""
    first, second = [c for c in calls if c["pass"] == "first"], [c for c in calls if c["pass"] == "second"]
    failed = sum(c["status"] != "ok" for c in calls)
    clips = sum(bool(r.get("speech_second_calls")) for r in rows)
    segments = sum(len(c["segments"]) for c in calls)
    languages = collections.Counter(c["detected_language"] or "not reported" for c in first)
    detected = ", ".join(f"{k} × {n}" for k, n in languages.most_common())
    return (f"Speech calls: first pass {len(first)}, second pass {len(second)} (on {clips} clips), failed {failed}. "
            f"First-pass languages detected: {detected}. Segments with signals recorded: {segments}.")


def comparable(rows):
    return [r for r in rows if r.get("wer_comparable") is True]


def not_comparable(rows):
    return [r for r in rows if r.get("wer_comparable") is False]


def comparable_denominator(rows):
    """How many scored clips the comparable averages use, out of how many, and how many were left out."""
    scored = [r for r in rows if "wer" in r]
    return f"{len(comparable(scored))} of {len(scored)} clips ({len(not_comparable(scored))} excluded)"


def clip_list(rows):
    return ", ".join(f"{r['id'].split('/')[-1]} ({r.get('lang') or '?'})" for r in rows)[:200]


def _detail(value):
    if isinstance(value, dict):
        return "/".join(f"{k} ({v})" for k, v in value.items())
    return "/".join(map(str, value)) if isinstance(value, list) else str(value)


def error_table(rows, field):
    """One line per kind of problem: how many items, and which."""
    found = collections.defaultdict(list)
    for r in rows:
        for kind, value in r.get(field, {}).items():
            found[kind].append(f"{r['id'].split('/')[-1]}: {_detail(value)}")
    return [f"| {kind.replace('_', ' ')} | {len(items)} | {'; '.join(items)[:200]} |" for kind, items in sorted(found.items())]


def error_sections(rows):
    """Confirmed errors and uncertain results, in separate tables with separate counts."""
    out = []
    has_confirmed = sum(bool(r.get("errors_confirmed")) for r in rows)
    only_uncertain = sum(bool(r.get("errors_uncertain")) and not r.get("errors_confirmed") for r in rows)
    out += ["", f"Items with confirmed errors: {has_confirmed}. Items with only uncertain results: {only_uncertain}."]
    for title, field in (("Confirmed errors", "errors_confirmed"), ("Uncertain results (not counted as errors)", "errors_uncertain")):
        table = error_table(rows, field)
        if table:
            out += ["", f"**{title}**", "", "| Problem | Items | Which |", "|---|---|---|", *table]
    checks = [r for r in rows if "expected_check_shown" in r.get("diagnosis", {})]
    if checks:
        out += ["", f"Expected card check shown: {sum(r['diagnosis']['expected_check_shown'] for r in checks)}/{len(checks)}."]
    return out


def summary(rows, title):
    lines = [f"# {title}", "", f"Run on {time.strftime('%Y-%m-%d %H:%M')}. {len(rows)} items.", "",
             model_line(rows), *(["", speech_line(rows)] if speech_line(rows) else []),
             "", "| Measure | Result |", "|---|---|"]
    for label, key in [("Final expense correct", "final_ok"), ("Amount", "amount_ok"), ("Payer", "payer_ok"),
                       ("Participants", "participants_ok"), ("Names (spelling, none invented)", "names_ok")]:
        lines.append(f"| {label} | {pct(rows, key)} |")
    if any("wer" in r for r in rows):
        comp, skipped, flagged = comparable(rows), not_comparable(rows), [r for r in rows if r.get("script_flag")]
        lines += [f"| Raw WER, all clips, script mismatches included (lower is better) | {mean(rows, 'wer')} |",
                  f"| Raw CER, all clips, script mismatches included | {mean(rows, 'cer')} |",
                  f"| Raw WER, comparable clips | {mean(comp, 'wer')} |",
                  f"| Raw CER, comparable clips | {mean(comp, 'cer')} |",
                  f"| Name-normalized WER, comparable clips | {mean(comp, 'wer_normalized')} |",
                  f"| Name-normalized CER, comparable clips | {mean(comp, 'cer_normalized')} |",
                  f"| Comparable WER/CER denominator | {comparable_denominator(rows)} |",
                  f"| Not comparable (script mismatch) | {len(skipped)}: {clip_list(skipped)} |",
                  f"| Script mismatch flagged for inspection, kept in the averages | {len(flagged)}: {clip_list(flagged)} |",
                  f"| Names heard in transcript | {mean(rows, 'names_heard')} |",
                  f"| Speech time per clip, s | {mean(rows, 'asr_secs')} |"]
    lines.append(f"| Reading time per item, s | {mean(rows, 'read_secs')} |")
    wrong = [r for r in rows if r.get("final_ok") is False and "error" not in r and not r.get("unscored")]
    if wrong:
        flagged = sum(bool(r.get("notes")) or bool(r.get("missing")) for r in wrong)
        lines.append(f"| Wrong results that the card flagged | {flagged}/{len(wrong)} |")
    lines.append(f"| Errors (no result) | {sum('error' in r for r in rows)} |")
    for who in ("primary", "backup"):
        sub = [r for r in rows if r.get("answered_by") == who]
        if sub and any(r.get("answered_by") == "backup" for r in rows):
            lines.append(f"| Final correct, answered by {who} model only | {pct(sub, 'final_ok')} |")
    lines += error_sections(rows)
    langs = sorted({r.get("lang", "") for r in rows})
    lines += ["", "| Language | Final correct |", "|---|---|"]
    lines += [f"| {l or '?'} | {pct([r for r in rows if r.get('lang') == l], 'final_ok')} |" for l in langs]
    cats = sorted({c for r in rows for c in r.get("categories", [])})
    if cats:
        lines += ["", "| Type of sentence | Final correct |", "|---|---|"]
        lines += [f"| {c} | {pct([r for r in rows if c in r.get('categories', [])], 'final_ok')} |" for c in cats]
    for kind in ("synthetic", "real"):
        sub = [r for r in rows if r.get("kind") == kind]
        if sub:
            lines.append(f"\n{kind.title()} clips: final {pct(sub, 'final_ok')}, comparable name-normalized WER "
                         f"{mean(comparable(sub), 'wer_normalized')}, unscored {sum(bool(r.get('unscored')) for r in sub)}")
    lines += ["", "| Item | Model | Result |", "|---|---|---|"]
    for r in rows:
        status = "error: " + str(r["error"])[:60] if "error" in r else "unscored" if r.get("unscored") else (
            "pass" if r.get("final_ok") else "FAIL")
        model = r.get("model") or "-"
        if r.get("answered_by") == "backup":
            model += " (backup, after main model failed)"
        lines.append(f"| {r['id']} | {model} | {status} |")
    return "\n".join(lines) + "\n"


def comparison_validity(ra, rb):
    """A comparison is fair only if every reading in both runs was answered by the same single model."""
    used = models_used(ra) | models_used(rb)
    if len(used) > 1:
        return False, ("INVALID COMPARISON: the runs used different models "
                       f"({', '.join(f'{m} × {n}' for m, n in used.most_common())}). "
                       "Check the screen log for why the backup was used: a rate limit means repeat on a day with fresh "
                       "quota; a one-off error (such as BadRequestError) means simply run that version again.")
    if not used:
        return False, "INVALID COMPARISON: no readings were answered in these runs."
    return True, f"Valid: every reading in both runs was answered by {next(iter(used))}."


def compare(a, b):
    def load(name):
        return read_json(RESULTS / f"{name}.json")
    ra, rb = load(a), load(b)
    valid, message = comparison_validity(ra, rb)
    print(message)
    if not valid:
        print("The numbers below are shown for diagnosis only. Do not present them as a before/after result.\n")
    print(f"| Measure | {a} | {b} |\n|---|---|---|")
    for label, key in [("Final", "final_ok"), ("Amount", "amount_ok"), ("Payer", "payer_ok"),
                       ("Participants", "participants_ok"), ("Names", "names_ok")]:
        print(f"| {label} | {pct(ra, key)} | {pct(rb, key)} |")
    for label, key in [("Raw WER, all clips", "wer"), ("Raw CER, all clips", "cer"), ("Names heard", "names_heard")]:
        if any(key in r for r in ra + rb):
            print(f"| {label} | {mean(ra, key)} | {mean(rb, key)} |")
    if any("wer_comparable" in r for r in ra + rb):
        for label, key in [("Raw WER, comparable", "wer"), ("Raw CER, comparable", "cer"),
                           ("Name-normalized WER, comparable", "wer_normalized"),
                           ("Name-normalized CER, comparable", "cer_normalized")]:
            print(f"| {label} | {mean(comparable(ra), key)} | {mean(comparable(rb), key)} |")
        print(f"| Comparable WER/CER denominator | {comparable_denominator(ra)} | {comparable_denominator(rb)} |")
        print(f"| Not comparable (script mismatch) | {len(not_comparable(ra))} | {len(not_comparable(rb))} |")
        print(f"| Script mismatch flagged, kept in the averages | {sum(bool(r.get('script_flag')) for r in ra)}"
              f" | {sum(bool(r.get('script_flag')) for r in rb)} |")
    by_a = {r["id"]: r for r in ra}
    for r in rb:
        old = by_a.get(r["id"])
        if old and old.get("final_ok") != r.get("final_ok"):
            print(f"  changed: {r['id']}: {old.get('final_ok')} -> {r.get('final_ok')}"
                  f" [{old.get('model')} -> {r.get('model')}]")
    return valid


def main():
    p = argparse.ArgumentParser()
    p.add_argument("mode", choices=["text", "audio", "all", "compare"])
    p.add_argument("names", nargs="*")
    p.add_argument("--code", choices=["current", "baseline"], default="current")
    p.add_argument("--label")
    p.add_argument("--set", choices=["synthetic", "real", "both"], default="both")
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--sleep", type=float, default=8.0, help="pause between items; the free tier allows ~8,000 model tokens a minute")
    args = p.parse_args()
    if args.mode == "compare":
        return compare(*args.names)
    reader, splits = load_code(args.code)
    label = args.label or args.code
    RESULTS.mkdir(exist_ok=True)
    for mode in (["text", "audio"] if args.mode == "all" else [args.mode]):
        rows = (run_text if mode == "text" else run_audio)(reader, splits, args)
        name = f"{label}-{mode}"
        json.dump(rows, open(RESULTS / f"{name}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        (RESULTS / f"{name}.md").write_text(summary(rows, f"Kitty benchmark: {name}"), encoding="utf-8")
        print(f"\n{model_line(rows)}\n{speech_line(rows)}\nSaved bench/results/{name}.md")


if __name__ == "__main__":
    main()
