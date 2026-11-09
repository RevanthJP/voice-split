"""Transcript-level analysis of the saved speech results. No API calls, and no change to the app.

Reads results/speech.json (variants A, B, B2, C) and writes results/transcript-report.md:
amounts in each transcript, names in each transcript, and offline variant E, which is A's transcript
plus deterministic correction of near-miss friend names.

Run: ./.venv/bin/python bench/prompt_test/transcript_analysis.py
"""
import json
import sys
import unicodedata
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
import experiment as ex  # noqa: E402

bench = ex.bench
VARIANTS = ex.VARIANTS
NAME_VARIANTS = (*VARIANTS, "E")
HINT_NAMES = ("Arun", "Ravi")  # friends named in the hint text of every prompt
CLASSES = ("digits-correct", "number-words-correct", "wrong", "garbled/missing", "needs human check")
SHORT = {"digits-correct": "digits", "number-words-correct": "words", "wrong": "WRONG", "garbled/missing": "garbled",
         "needs human check": "check"}
NAME_PAIRS = (("A", "B"), ("A", "C"), ("B", "C"), ("E", "A"), ("E", "B"), ("E", "C"))
GROUPS = (("Existing clips", lambda c: c["set"] == "existing"),
          ("Existing, amount spoken in digits", lambda c: c["set"] == "existing" and ex.amount_kind(c) == "digits"),
          ("Existing, amount spoken in number words", lambda c: c["set"] == "existing" and ex.amount_kind(c) == "words"),
          ("Fresh clips (synthetic, all number words)", lambda c: c["set"] == "fresh"))
LOCAL_NOTE = ("**Kept local, not in git:** the raw speech results (`results/speech.json`) and all audio clips. "
              "The repository is public, so it holds only this summary, not raw API output or audio files. "
              "The fresh clips can be remade with `make_clips.py`. Tests that need the raw results skip when they are missing.")
FRESH_NOTE = ("**The fresh clips, like the existing ones, are computer voices reading clean text.** They are a stress test "
              "of the prompts and are not evidence about real speakers.")


def nfc(text):
    return unicodedata.normalize("NFC", text)


def lex(pairs, kind):
    return {nfc(word): (kind, value) for word, value in pairs.items()}


LEXICON = {
    **lex({"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
           "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
           "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पाँच": 5, "पांच": 5, "छह": 6, "छः": 6, "छै": 6, "सात": 7, "आठ": 8, "नौ": 9,
           "दस": 10, "बीस": 20, "तीस": 30, "चालीस": 40, "पचास": 50, "साठ": 60, "सत्तर": 70, "अस्सी": 80, "नब्बे": 90,
           "डेढ़": 1.5, "डेढ": 1.5, "ढाई": 2.5, "dedh": 1.5, "dhai": 2.5,
           "ஒன்று": 1, "இரண்டு": 2, "மூன்று": 3, "நான்கு": 4, "நாலு": 4, "ஐந்து": 5, "ஆறு": 6, "ஏழு": 7, "எட்டு": 8,
           "ஒன்பது": 9, "பத்து": 10, "இருபது": 20, "முப்பது": 30, "நாற்பது": 40, "ஐம்பது": 50, "அறுபது": 60, "எழுபது": 70,
           "எண்பது": 80, "தொண்ணூறு": 90}, "unit"),
    **lex({"hundred": 100, "thousand": 1000, "lakh": 100000, "lakhs": 100000, "सौ": 100, "हज़ार": 1000,
           "हजार": 1000, "लाख": 100000, "sau": 100, "hazaar": 1000, "hazar": 1000, "hajar": 1000, "nooru": 100,
           "aayiram": 1000, "ayiram": 1000, "நூறு": 100, "ஆயிரம்": 1000, "லட்சம்": 100000}, "multiplier"),
    **lex({"நூற்று": 100, "இருநூறு": 200, "இருநூற்று": 200, "முந்நூறு": 300, "முந்நூற்று": 300, "நானூறு": 400, "நானூற்று": 400,
           "ஐநூறு": 500, "ஐநூற்று": 500, "அறுநூறு": 600, "அறுநூற்று": 600, "எழுநூறு": 700, "எழுநூற்று": 700, "எண்ணூறு": 800,
           "எண்ணூற்று": 800, "தொள்ளாயிரம்": 900, "தொள்ளாயிரத்து": 900, "ஆயிரத்து": 1000, "இரண்டாயிரம்": 2000,
           "மூவாயிரம்": 3000, "நாலாயிரம்": 4000, "ஐயாயிரம்": 5000, "ஐந்தாயிரம்": 5000, "ஆறாயிரம்": 6000, "ஏழாயிரம்": 7000,
           "எட்டாயிரம்": 8000, "ஒன்பதாயிரம்": 9000, "பத்தாயிரம்": 10000}, "absolute"),
}
TAMIL_ONES = {w: LEXICON[nfc(w)][1] for w in ("இரண்டு", "மூன்று", "நான்கு", "நாலு", "ஐந்து", "ஆறு", "ஏழு", "எட்டு", "ஒன்பது")}
TAMIL_HUNDRED_ENDINGS = (nfc("நூறு"), nfc("நூற்று"))


def tokens(text):
    """(start, end, word) for each run of letters, marks and digits, so Tamil and Hindi vowel signs stay in the word."""
    found, start = [], None
    for i, ch in enumerate(text):
        if unicodedata.category(ch)[0] in "LMN":
            start = i if start is None else start
        elif start is not None:
            found.append((start, i, text[start:i]))
            start = None
    if start is not None:
        found.append((start, len(text), text[start:]))
    return found


def lookup(word, previous_kind):
    """(kind, value, note). Spellings outside the standard list are accepted only by these two general rules, and noted."""
    key = nfc(word).lower()
    if key in LEXICON:
        return (*LEXICON[key], None)
    if key == nfc("सो") and previous_kind == "unit":
        return "multiplier", 100, "non-standard spelling सो for सौ, after a count word"
    for ending in TAMIL_HUNDRED_ENDINGS:
        count = TAMIL_ONES.get(key[: -len(ending)]) if key.endswith(ending) else None
        if count:
            return "absolute", count * 100, f"non-standard joined spelling {word}"
    return None


def number_spans(text):
    """Every run of number words: {'value', 'bare', 'words', 'notes'}. 'bare' is a multiplier with no count word before it."""
    spans, current, kind = [], None, None

    def close():
        nonlocal current, kind
        if current:
            current["value"] = current.pop("total") + current.pop("part")
            spans.append(current)
        current, kind = None, None

    for _, _, word in tokens(text):
        if word.lower() == "and" and current:
            continue
        found = lookup(word, kind)
        if not found:
            close()
            continue
        what, value, note = found
        current = current or {"total": 0, "part": 0, "bare": False, "words": [], "notes": []}
        current["words"].append(word)
        if note:
            current["notes"].append(note)
        if what == "multiplier":
            if not current["part"]:
                current["part"], current["bare"] = 1, not current["total"] or current["bare"]
            if value == 100:
                current["part"] *= 100
            else:
                current["total"] += current["part"] * value
                current["part"] = 0
        elif what == "absolute" and value >= 1000:
            current["total"] += value
        else:
            current["part"] += value
        kind = what
    close()
    return [s for s in spans if s["value"] >= 10]  # एक, दो and "one" are usually not amounts ("बाँट दो" = share it)


def digit_amounts(text):
    return {a for a in bench.amounts_in(text) if a >= 10}


def classify_amount(text, truth):
    """Which of the five classes this transcript's amount falls in, and what was found."""
    digits, spans = digit_amounts(text), number_spans(text)
    found = {"digits": sorted(digits), "words": [{"value": s["value"], "text": " ".join(s["words"]), "bare": s["bare"]} for s in spans]}
    notes = [n for s in spans if s["value"] == truth for n in s["notes"]]
    if truth in digits:
        return {"class": "digits-correct", "found": found, "notes": []}
    if any(s["value"] == truth for s in spans):
        return {"class": "number-words-correct", "found": found, "notes": notes}
    if any(s["bare"] for s in spans):
        return {"class": "needs human check", "found": found, "notes": []}
    if digits or spans:
        return {"class": "wrong", "found": found, "notes": []}
    return {"class": "garbled/missing", "found": found, "notes": []}


def truth_amount(clip):
    return None if ex.amount_kind(clip) == "none" else round(sum(clip["case"]["owed"].values()))


# ---------- names ----------

def expected_names(clip):
    case, forms = clip["case"], clip["case"].get("name_forms", {})
    owed = [n for n in [*case.get("owed", {}), case.get("payer")] if n and n != "You"]
    spoken = [p for p in case.get("people", []) if bench.name_match(p, clip["reference"], forms.get(p, [])) == "yes"]
    return list(dict.fromkeys([*owed, *spoken]))


def name_status(clip, name, text):
    return bench.name_match(name, text, clip["case"].get("name_forms", {}).get(name, []))


def not_spoken_names(clip, text):
    """Friends or hint names in the transcript that were not in what was said."""
    case = {**clip["case"], "people": list(dict.fromkeys([*clip["case"].get("people", []), *HINT_NAMES]))}
    return bench.friends_in_transcript(case, clip["reference"], text)[0]


# ---------- variant E ----------

def edit_distance(a, b):
    row = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        previous, row[0] = row[0], i
        for j, y in enumerate(b, 1):
            previous, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, previous + (x != y))
    return row[-1]


def sound_key(word):
    """Consonant outline of a Latin-letter name: 'Senthil' and 'Saint Thil' both give 'sntl'."""
    w = word.lower()
    for pair, single in (("th", "t"), ("dh", "d"), ("ph", "f"), ("sh", "s"), ("bh", "b"), ("kh", "k"), ("gh", "g")):
        w = w.replace(pair, single)
    skeleton = w[0] + "".join(ch for ch in w[1:] if ch not in "aeiouy")
    return "".join(ch for i, ch in enumerate(skeleton) if i == 0 or ch != skeleton[i - 1])


def is_latin(word):
    return all(ord(ch) < 128 for ch in word)


def forms_of(friends, extra):
    """(lower-case spelling, friend) for every one-word spelling of every friend."""
    pairs = []
    for friend in friends:
        for form in bench.name_forms(friend, extra.get(friend, [])):
            if len(form.split()) == 1:
                pairs.append((nfc(form).lower(), friend))
    return pairs


def is_protected(word, known):
    """Digits, number words and anything already spelled exactly as a friend are never changed."""
    key = nfc(word).lower()
    return any(ch.isdigit() for ch in word) or key in known or key == nfc("सो") or lookup(word, "unit") is not None


def close_enough(word, form):
    if len(word) < 4 or word[0] != form[0] or is_latin(word) != is_latin(form):
        return None
    distance = edit_distance(word, form)
    if distance <= 1 or (is_latin(word) and distance == 2 and sound_key(word) == sound_key(form)):
        return distance
    return None


def only_best(hits):
    """The single friend with the smallest distance, or None if two different friends tie."""
    if not hits:
        return None
    best = min(d for d, _ in hits)
    friends = {f for d, f in hits if d == best}
    return friends.pop() if len(friends) == 1 else None


def correct_names(text, friends, extra=None):
    """Variant E: replace a near-miss of a friend's name with that friend's spelling, only when one friend is clearly closest."""
    pairs = forms_of(friends, extra or {})
    known = {form for form, _ in pairs}
    words = tokens(text)
    replace, changes = [], []
    i = 0
    while i < len(words):
        start, end, word = words[i]
        key = nfc(word).lower()
        if not is_protected(word, known):
            if i + 1 < len(words):
                next_start, next_end, following = words[i + 1]
                joined = (key + following.lower())
                if (text[end:next_start] == " " and is_latin(word) and is_latin(following) and word[0].isupper() and following[0].isupper()
                        and not is_protected(following, known) and len(joined) >= 6):
                    hits = [(edit_distance(joined, f), n) for f, n in pairs
                            if is_latin(f) and f[0] == joined[0] and sound_key(joined) == sound_key(f) and edit_distance(joined, f) <= 3]
                    friend = only_best(hits)
                    if friend:
                        replace.append((start, next_end, friend))
                        changes.append({"from": text[start:next_end], "to": friend})
                        i += 2
                        continue
            hits = [(d, n) for d, n in ((close_enough(key, f), n) for f, n in pairs) if d is not None]
            friend = only_best(hits)
            if friend:
                replace.append((start, end, friend))
                changes.append({"from": word, "to": friend})
        i += 1
    for start, end, friend in reversed(replace):
        text = text[:start] + friend + text[end:]
    return text, changes


def number_fingerprint(text):
    return sorted(digit_amounts(text)), [(" ".join(s["words"]), s["value"]) for s in number_spans(text)]


def run_e(clips, store, friends_for=None):
    """E's transcript, changes, and whether each change was right, per clip."""
    out = {}
    for clip in clips:
        original = store[f"A|{clip['id']}"]["text"]
        friends = friends_for(clip) if friends_for else clip["case"].get("people", [])
        text, changes = correct_names(original, friends, clip["case"].get("name_forms", {}))
        truth = expected_names(clip)
        for change in changes:
            change["correct"] = change["to"] in truth and name_status(clip, change["to"], original) != "yes"
        out[clip["id"]] = {"text": text, "changes": changes, "numbers_unchanged": number_fingerprint(text) == number_fingerprint(original)}
    return out


# ---------- report ----------

def analyse(clips, store):
    e = run_e(clips, store)
    every_name = sorted({*bench.ALIASES})
    stress = run_e(clips, store, lambda clip: every_name)
    amounts, names, extra = {}, {}, {}
    for clip in clips:
        texts = {v: store[f"{v}|{clip['id']}"]["text"] for v in VARIANTS}
        truth = truth_amount(clip)
        amounts[clip["id"]] = {"truth": truth, **({v: classify_amount(t, truth) for v, t in texts.items()} if truth is not None else {})}
        texts["E"] = e[clip["id"]]["text"]
        names[clip["id"]] = {n: {v: name_status(clip, n, texts[v]) for v in NAME_VARIANTS} for n in expected_names(clip)}
        extra[clip["id"]] = {v: not_spoken_names(clip, texts[v]) for v in NAME_VARIANTS}
    return {"amounts": amounts, "names": names, "not_spoken": extra, "e": e, "stress": stress}


def words_vs_digits(clips, store, amounts):
    """Clips where C wrote the main amount in number words (or a fragment of them) and A wrote digits."""
    out = []
    for clip in clips:
        row = amounts[clip["id"]]
        if row["truth"] is None:
            continue
        c_words = bool(row["C"]["found"]["words"]) and row["C"]["class"] != "digits-correct"
        if c_words and row["A"]["found"]["digits"]:
            out.append(clip)
    return out


def right(entry):
    return entry["class"] in ("digits-correct", "number-words-correct")


def amount_counts(clips, amounts, variant):
    rows = [amounts[c["id"]][variant] for c in clips if amounts[c["id"]]["truth"] is not None]
    counts = {name: sum(r["class"] == name for r in rows) for name in CLASSES}
    return counts, sum(right(r) for r in rows), len(rows)


def amount_pairs(clips, amounts, x, y):
    """Wins for each side over clips where neither transcript needs a human check."""
    use = [amounts[c["id"]] for c in clips if amounts[c["id"]]["truth"] is not None]
    held = sum("needs human check" in (r[x]["class"], r[y]["class"]) for r in use)
    use = [r for r in use if "needs human check" not in (r[x]["class"], r[y]["class"])]
    return sum(right(r[x]) and not right(r[y]) for r in use), sum(right(r[y]) and not right(r[x]) for r in use), held


def amount_pairs_strict(clips, amounts, x, y):
    """The same comparison with every needs-human-check transcript counted as not right."""
    use = [amounts[c["id"]] for c in clips if amounts[c["id"]]["truth"] is not None]
    return sum(right(r[x]) and not right(r[y]) for r in use), sum(right(r[y]) and not right(r[x]) for r in use)


def second_pass_rows(clips, store, amounts):
    """How the amount was written, split by whether the forced-language second pass produced the transcript."""
    table = {}
    for v in VARIANTS:
        table[v] = {"second": {"digits": 0, "not digits": 0}, "first": {"digits": 0, "not digits": 0}}
        for c in clips:
            row = amounts[c["id"]]
            if row["truth"] is not None:
                side = "second" if store[f"{v}|{c['id']}"]["second_pass"] else "first"
                table[v][side]["digits" if row[v]["class"] == "digits-correct" else "not digits"] += 1
    return table


def name_counts(clips, names, variant):
    rows = [names[c["id"]][n][variant] for c in clips for n in names[c["id"]]]
    return {s: rows.count(s) for s in ("yes", "no", "uncertain")}, len(rows)


def name_pairs(clips, names, x, y):
    rows = [names[c["id"]][n] for c in clips for n in names[c["id"]]]
    held = sum("uncertain" in (r[x], r[y]) for r in rows)
    rows = [r for r in rows if "uncertain" not in (r[x], r[y])]
    return sum(r[x] == "yes" and r[y] != "yes" for r in rows), sum(r[y] == "yes" and r[x] != "yes" for r in rows), held


def write(clips, store, out):
    data = analyse(clips, store)
    amounts, names, e, stress = data["amounts"], data["names"], data["e"], data["stress"]
    empty = sum(not c["case"].get("people") for c in clips if c["set"] == "existing")
    lines = ["# Transcript report: amounts, names and offline variant E", "", LOCAL_NOTE, "", FRESH_NOTE, "",
             "Made only from the 168 saved Whisper transcripts. **No API calls, and no reading model.** These are transcript-level results, "
             "not entry success: they show what Whisper wrote, not what would be saved.", "",
             "Noise verdicts use an exact sign test on clips where one side was right and the other wrong. Paired names within one clip are not fully independent, so name verdicts are slightly generous.", ""]
    lines += ["## 1. Amount in the transcript", ""]
    for title, pick in GROUPS:
        chosen = [c for c in clips if pick(c)]
        lines += [f"### {title}", "", "| Variant | " + " | ".join(CLASSES) + " | Right in total |", "|---|" + "---|" * (len(CLASSES) + 1)]
        for v in VARIANTS:
            counts, good, total = amount_counts(chosen, amounts, v)
            lines.append(f"| {v} | " + " | ".join(f"{counts[k]}/{total}" for k in CLASSES) + f" | **{good}/{total}** |")
        lines.append("")
    lines += ["### Is any amount difference within noise?", "", "| Clips | Pair | First right, second not | Second right, first not | Left out (needs check) | Verdict | With every check counted wrong |", "|---|---|---|---|---|---|---|"]
    for title, pick in (GROUPS[0], GROUPS[3]):
        chosen = [c for c in clips if pick(c)]
        for x, y in ex.PAIRS:
            win, lose, held = amount_pairs(chosen, amounts, x, y)
            strict_win, strict_lose = amount_pairs_strict(chosen, amounts, x, y)
            lines.append(f"| {title} | {x} vs {y} | {win} | {lose} | {held} | {ex.verdict(win, lose)} | {strict_win} to {strict_lose}: {ex.verdict(strict_win, strict_lose)} |")
    lines += ["", "### Every clip", "", "`digits` and `words` are right; `WRONG` is a different amount; `garbled` has no usable amount; `check` needs a person.", "",
              "| Clip | Set | True amount | " + " | ".join(VARIANTS) + " |", "|---|---|---|" + "---|" * len(VARIANTS)]
    for c in clips:
        row = amounts[c["id"]]
        if row["truth"] is not None:
            lines.append(f"| `{c['id']}` | {c['set']} | {row['truth']:,} | " + " | ".join(SHORT[row[v]["class"]] for v in VARIANTS) + " |")
    lines += ["", "`b-en-no-amount` has no amount, so it is not scored here.", "", "### Needs human check", ""]
    held = [(c, v) for c in clips for v in VARIANTS if amounts[c["id"]]["truth"] is not None and amounts[c["id"]][v]["class"] == "needs human check"]
    lines += [f"- `{c['id']}` {v} (true amount {amounts[c['id']]['truth']:,}): {store[f'{v}|{c['id']}']['text']}" for c, v in held] or ["None."]
    lines += ["", "### Counted as number-words-correct despite a non-standard spelling", ""]
    noted = [(c, v, amounts[c["id"]][v]["notes"]) for c in clips for v in VARIANTS if amounts[c["id"]]["truth"] is not None and amounts[c["id"]][v]["notes"]]
    lines += [f"- `{c['id']}` {v}: {'; '.join(n)}: {store[f'{v}|{c['id']}']['text']}" for c, v, n in noted] or ["None."]
    lines += ["", "## 2. Clips where C wrote number words and A wrote digits", ""]
    flips = words_vs_digits(clips, store, amounts)
    lines += [f"{len(flips)} clips. C was meant to steer Whisper towards digits; on these it did the opposite.", "", "| Clip | Set | True amount | A | C | C's class |", "|---|---|---|---|---|---|"]
    for c in flips:
        lines.append(f"| `{c['id']}` | {c['set']} | {amounts[c['id']]['truth']:,} | {store[f'A|{c['id']}']['text']} | {store[f'C|{c['id']}']['text']} | {SHORT[amounts[c['id']]['C']['class']]} |")
    table = second_pass_rows(clips, store, amounts)
    a_right = [c for c in clips if amounts[c["id"]]["truth"] is not None]
    names_only = [c["id"] for c in a_right if right(amounts[c["id"]]["A"]) and not right(amounts[c["id"]]["B2"])]
    lines += ["", "### Which change in B caused the amount problem?", "",
              "B2 has friend names but not 'Swiggy, Ola, rent'. Clips A got right and B2 did not: " + (", ".join(f"`{i}`" for i in names_only) or "none") + ".",
              "B has the same problem on: " + (", ".join(f"`{i}`" for i in names_only if not right(amounts[i]["B"])) or "none") + ".",
              "So on these clips the problem appears without the three extra words. Adding friend names is enough. This is a small sample.", "",
              "### Second pass and how the amount was written", "",
              "When Whisper detects Hindi or Tamil but writes no Hindi or Tamil script, the app listens again in that language. That second-pass hint is written in number words. C's digit ending only changed the first-pass hint.", "",
              "| Variant | Second pass used: digits | Second pass used: anything else | First pass only: digits | First pass only: anything else |", "|---|---|---|---|---|"]
    for v in VARIANTS:
        row = table[v]
        lines.append(f"| {v} | {row['second']['digits']} | {row['second']['not digits']} | {row['first']['digits']} | {row['first']['not digits']} |")
    lines += ["", "This shows a pattern, not a proven cause. The clips that reach a second pass are not a random sample.", ""]
    lines += ["", "## 3. Names in the transcript", "",
              f"`yes` means the name is certainly there in any script, using the benchmark's matching. {empty} of the 30 existing clips have an empty friend list, so B, B2 and C had no names to add on those.", ""]
    for title, pick in (GROUPS[0], GROUPS[3], ("All clips", lambda c: True)):
        chosen = [c for c in clips if pick(c)]
        lines += [f"### {title}", "", "| Variant | Yes | No | Uncertain |", "|---|---|---|---|"]
        for v in NAME_VARIANTS:
            counts, total = name_counts(chosen, names, v)
            lines.append(f"| {v} | **{counts['yes']}/{total}** | {counts['no']}/{total} | {counts['uncertain']}/{total} |")
        lines.append("")
    lines += ["### Is any name difference within noise?", "", "| Clips | Pair | First yes, second not | Second yes, first not | Left out (uncertain) | Verdict |", "|---|---|---|---|---|---|"]
    for title, pick in (GROUPS[0], GROUPS[3], ("All clips", lambda c: True)):
        chosen = [c for c in clips if pick(c)]
        for x, y in NAME_PAIRS:
            win, lose, held_names = name_pairs(chosen, names, x, y)
            lines.append(f"| {title} | {x} vs {y} | {win} | {lose} | {held_names} | {ex.verdict(win, lose)} |")
    lines += ["", "### Every name", "", "| Clip | Name | " + " | ".join(NAME_VARIANTS) + " |", "|---|---|" + "---|" * len(NAME_VARIANTS)]
    for c in clips:
        for n, row in names[c["id"]].items():
            lines.append(f"| `{c['id']}` | {n} | " + " | ".join(row[v] for v in NAME_VARIANTS) + " |")
    lines += ["", "### Names in the transcript that were never said", ""]
    added = [(c, v, data["not_spoken"][c["id"]][v]) for c in clips for v in NAME_VARIANTS if data["not_spoken"][c["id"]][v]]
    lines += [f"- `{c['id']}` {v}: {', '.join(n)}: {(e[c['id']]['text'] if v == 'E' else store[f'{v}|{c['id']}']['text'])}" for c, v, n in added] or ["None."]
    lines += ["", "## 4. Variant E: A's transcript plus offline name correction", "",
              "**The rule.** Only words close to a name on that clip's own friend list can change, in English letters, Hindi or Tamil script. Digits, number words and exact spellings of a friend are never touched. "
              "A change needs the same first letter, a word of at least 4 characters, and an edit distance of 1 (2 in English letters if the consonant outline also matches). Two adjacent capitalised words can merge if their consonant outline matches. If two friends tie, nothing changes.", ""]
    changed = [(c, ch) for c in clips for ch in e[c["id"]]["changes"]]
    wrong = [(c, ch) for c, ch in changed if not ch["correct"]]
    lines += [f"**Changes made: {len(changed)}. Right: {len(changed) - len(wrong)}. Wrong: {len(wrong)}.** Digits and number words unchanged on {sum(e[c['id']]['numbers_unchanged'] for c in clips)}/{len(clips)} clips.", "",
              "| Clip | Set | From | To | Right? |", "|---|---|---|---|---|"]
    lines += [f"| `{c['id']}` | {c['set']} | {ch['from']} | {ch['to']} | {'yes' if ch['correct'] else 'NO'} |" for c, ch in changed]
    lines += ["", "### Cases where E wrongly changed a word", ""]
    lines += [f"- `{c['id']}`: {ch['from']} became {ch['to']}" for c, ch in wrong] or ["None on the real friend lists."]
    lines += ["", "### Harsher check: all 32 names on every clip's friend list", ""]
    stress_changes = [(c, ch) for c in clips for ch in stress[c["id"]]["changes"]]
    stress_wrong = [(c, ch) for c, ch in stress_changes if not ch["correct"]]
    lines += [f"{len(stress_changes)} changes, {len(stress_wrong)} wrong.", ""]
    lines += [f"- `{c['id']}`: {ch['from']} became {ch['to']}" for c, ch in stress_wrong] or ["No wrong changes."]
    lines += ["", "### Limits of E", "",
              "- **Written after reading these transcripts,** so its results here are in-sample and likely optimistic.",
              "- **Native-script fixes rely on `bench/name_aliases.json`,** a hand-made list. The app has no such list for a real user's friends.",
              "- **E can't help on the clips with an empty friend list,** and only fixes near-misses. It can't recover `रविवार`, or `அமிக்கூட` where a name and a word merged.",
              "- A real friend whose name is close to another word could be changed wrongly; the 32-name check above tests this only on these clips.", "",
              "## How to read this", "", FRESH_NOTE,
              "- Whisper repeats itself on the same clip and prompt, so these differences are real for these clips. Noise means too few clips to generalise.",
              "- C's prompt was frozen before the fresh clips existed. The parser and E were written after reading the transcripts.",
              "- Only the main amount is scored. A secondary amount, such as C writing `छैसो` for the 600 of drinks in `b-hi-drinks`, is not scored but appears in the transcript.", ""]
    report = "\n".join(lines)
    (out / "transcript-report.md").write_text(report, encoding="utf-8")
    return report, data


def main():
    ex.frozen_prompts()
    out = HERE / "results"
    store = ex.load(out / "speech.json")
    clips = ex.all_clips()
    if len(store) != 168 or any(r["status"] != "ok" for r in store.values()):
        sys.exit("Expected 168 finished transcripts.")
    report = write(clips, store, out)[0]
    print(report)


if __name__ == "__main__":
    main()
