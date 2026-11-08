"""Speech to text, then one model call that reads who paid, how much and who shares.

The model never does maths. It returns a structured description, and splits.py works out the money.
"""
import json
import os
import re
import time

from dotenv import load_dotenv

from splits import ME, Expense, Item

load_dotenv()

STT_MODEL = "whisper-large-v3"
LLM_MODELS = ["openai/gpt-oss-20b", "openai/gpt-oss-120b"]

# Hints written in the speaker's own mix, so the speech model keeps their words and numbers.
_SPEECH_HINT = {
    None: "Petrol, dinner, auto, Swiggy, Ola, rent, split with Arun and Ravi, I paid 1,200 rupees.",
    "ta": "நான் petrol-க்கு ஆயிரத்து இருநூறு ரூபாய் கொடுத்தேன், Arun Ravi கூட split பண்ணு. "
          "ஐநூறு, ஆயிரம், இரண்டாயிரம், dinner, auto.",
    "hi": "मैंने petrol के लिए बारह सौ रुपये दिए, Arun और Ravi के साथ split करो। पाँच सौ, हज़ार, दो हज़ार।",
}
_LANG_CODE = {"tamil": "ta", "ta": "ta", "hindi": "hi", "hi": "hi"}
_NATIVE_SCRIPT = {"ta": re.compile(r"[஀-௿]"), "hi": re.compile(r"[ऀ-ॿ]")}
_SILENCE = {"thank you", "thanks", "thank you very much", "thanks for watching", "you", "bye", "okay", "ok",
            "நன்றி", "धन्यवाद", "शुक्रिया",
            "subtitles by the amara org community"}  # Whisper invented this on digital silence (Stage B probe)

SYSTEM = f"""You read one spoken or typed expense from a person in India and return JSON for a bill-splitting app.
The text may be English, Tamil, Hindi, Tanglish or Hinglish, in any script. Speech recognition sometimes writes Tamil words in Hindi script (for example आईरम = aayiram = 1000), so read words by their sound. You do not do any arithmetic beyond reading numbers.

Return exactly this JSON object:
{{"description": short English label like "Petrol" or "Dinner",
  "total": the full amount paid as a number, or null if no amount was said,
  "payer": who paid,
  "participants": everyone who shares the main bill,
  "mode": "equal" | "exact" | "shares" | "percent",
  "values": {{name: number}} only for exact, shares or percent, otherwise {{}},
  "items": [{{"amount": number, "description": English label, "only": [names], "excluded": [names]}}],
  "missing": list of what is unclear: "amount", "people" or "payer"}}

Rules:
- The speaker is "{ME}". Words like I, me, naan, en, enakku, main, mera, mujhe, maine all mean "{ME}".
- Write every other name in English letters with a capital first letter. If a name matches one in the known people list, even in Tamil or Hindi script or spelled differently, use the spelling from that list.
- Read number words as digits. Tamil hundreds: nooru 100, irunooru 200, munnooru 300, naanooru 400, ainooru/ainnooru 500, arunooru 600, ezhunooru 700, ennooru 800, tholaayiram 900. Tamil thousands: aayiram 1000, rendaayiram 2000, moovaayiram 3000, naalaayiram 4000, ainthaayiram 5000, pathaayiram 10000; aayirathi irunooru 1200. Tamil tens: pathu 10, irubathu 20, aimbadhu 50, nooru 100. Hindi: sau 100, do sau 200, paanch sau 500, hazaar 1000, dedh hazaar 1500, dhai sau 250, dhai hazaar 2500. Also 1.2k = 1200. The same words in Tamil or Hindi script mean the same numbers.
- "split with A and B" or "A B kooda split" means the speaker shares too: participants = [{ME}, A, B].
- Indians often list friends without "and": "Arun Ravi kooda", "Arun Ravi ke saath", "with Arun Ravi Kavya" are separate people, one name each. Only treat two words as one person if it is clearly a full name (a known person, or a surname like Kumar, Sharma, Iyer, Reddy).
- Pronouns such as avan, aval, avanga, him, her, woh refer to someone already named. Never list a pronoun as a person: "Prathi kuduthaa, naanum avalum share" means {ME} and Prathi.
- "paid for A and B", "A B-kku kuduthen", "treat" means only A and B share and the payer does not.
- If no payer is said, the payer is "{ME}". The payer is always a person, never a place or thing: in "Hotel-ku 2000 Prathi kuduthaa", Hotel is what was paid for and Prathi paid.
- Unnamed family who came with someone ("my wife came", "his two kids") are never separate people. Give that person extra shares instead, with mode "shares", and list every sharer in participants.
- If nobody else is mentioned, it is the speaker's own expense: participants = [{ME}].
- Use items for parts of the bill that only some people share. "A didn't have drinks, 300" = item 300 drinks excluded [A]. "500 of it was B's own shopping" = item 500 only [B]. Item amounts are part of the total, not extra.
- "me and my wife as one", "count us as two" and similar mean mode "shares" with the right numbers.
- Never invent an amount or a person. If something is missing, leave it empty and list it in "missing".
"""


# One request (speech plus reading) must answer before the browser gives up at 45 seconds.
# Each AI call gets what is left of this budget, so a slow call can't push the total past it.
BUDGET_SECONDS = 38


class Deadline:
    def __init__(self, seconds=BUDGET_SECONDS):
        self.end = time.monotonic() + seconds

    def left(self):
        return self.end - time.monotonic()


class TooSlow(Exception):
    """The time budget ran out before an AI call could start."""


def _client(timeout=20):
    from groq import Groq

    key = os.getenv("GROQ_API_KEY")
    if not key:
        raise RuntimeError("GROQ_API_KEY is not set")
    # Retries are decided here (see read_expense), not inside the SDK, so they fit the time budget.
    return Groq(api_key=key, max_retries=0, timeout=timeout)


# Groq accepts a Whisper prompt of at most 224 tokens. Token counts can't be known exactly without
# Whisper's tokenizer, so this estimate errs high: about 3 English letters per token, and every
# 2 bytes of Tamil or Hindi script (3 bytes a letter) as a token. The budget leaves a margin.
PROMPT_TOKEN_LIMIT = 224
_PROMPT_BUDGET = 190


def _tokens(text):
    plain = sum(1 for ch in text if ord(ch) < 128)
    return plain / 3 + (len(text.encode("utf-8")) - plain) / 2


def _clean_name(raw):
    """A friend's name as it may go into the prompt: letters, spaces, dots and hyphens, 30 characters at most."""
    name = re.sub(r"[^\w .'-]", "", str(raw or ""), flags=re.UNICODE).strip()
    ok = 0 < len(name) <= 30 and len(name.split()) <= 3 and not any(ch.isdigit() for ch in name)
    return name if ok else ""


def speech_prompt(language=None, people=()):
    """The language hint, then the person's friends' names, so Whisper spells them as the friend list does.
    Names come in the order given (the open group's people first) and stop before the token budget."""
    hint = _SPEECH_HINT[language]
    names = []
    for raw in people:
        name = _clean_name(raw)
        if not name or name == ME or name.lower() in (n.lower() for n in names):
            continue
        if _tokens(f"{hint} Names: {', '.join([*names, name])}.") > _PROMPT_BUDGET:
            break
        names.append(name)
    return f"{hint} Names: {', '.join(names)}." if names else hint


def _speech(audio, filename, language=None, people=(), deadline=None):
    deadline = deadline or Deadline()
    if deadline.left() < 4:
        raise TooSlow()
    prompt = speech_prompt(language, people)
    kwargs = dict(file=(filename, audio), model=STT_MODEL, response_format="verbose_json",
                  temperature=0.0, prompt=prompt)
    if language:
        kwargs["language"] = language
    return _client(timeout=min(20, deadline.left())).audio.transcriptions.create(**kwargs), prompt


def _words(text):
    """Lower-case words without punctuation. Tamil and Hindi vowel signs are kept (they aren't \\w in Python)."""
    import unicodedata
    return "".join(" " if unicodedata.category(ch)[0] in "PS" else ch for ch in (text or "")).lower().split()


# A transcript must repeat at least this many prompt words in a row, in order, to count as an echo.
# Real sentences reuse the hint's everyday words ("dinner", "split with", a friend's name), so sharing
# words is not enough; only a long verbatim run is.
ECHO_MIN_WORDS = 8


def _echo_words(text):
    """Words for the echo check: case, spacing, punctuation and digit grouping (1,200 = 1200) ignored."""
    return _words(re.sub(r"(?<=\d),(?=\d)", "", text or ""))


def _echoes_prompt(prompt, text):
    """With nothing said, Whisper can repeat its own prompt back. Counts as an echo only when the
    transcript is an exact copy of the whole prompt or of the language hint, or a run of at least
    ECHO_MIN_WORDS words copied in order from the language hint. The appended friend names are never
    used for partial matching, so a list of friends' names is never an echo. A short utterance is never one."""
    said = _echo_words(text)
    if not said or not prompt:
        return False
    full = _echo_words(prompt)
    hint = _echo_words(prompt.split(" Names: ")[0])
    if said in (full, hint):
        return True
    if len(said) < ECHO_MIN_WORDS:
        return False
    n = len(said)
    return any(hint[i:i + n] == said for i in range(len(hint) - n + 1))


def _is_silence(resp, text, prompt=""):
    cleaned = " ".join(_words(text))
    if not cleaned or cleaned in _SILENCE:
        return True
    if _echoes_prompt(prompt, text):
        return True
    segs = getattr(resp, "segments", None) or []
    probs = [s.get("no_speech_prob") if isinstance(s, dict) else getattr(s, "no_speech_prob", None) for s in segs]
    probs = [p for p in probs if p is not None]
    return bool(probs) and sum(probs) / len(probs) > 0.6


def transcribe(audio, filename="clip.webm", language=None, people=(), deadline=None):
    """Returns the words as spoken. If the person chose a language, listen in that language only.
    Otherwise detect it, and if Tamil or Hindi speech comes back with no Tamil or Hindi script,
    the model has likely translated it, so it listens once more in that language (only if there's
    time left for that and for reading the expense). Known friends' names go in the prompt."""
    deadline = deadline or Deadline()
    if language in ("ta", "hi", "en"):
        resp, prompt = _speech(audio, filename, language if language != "en" else None, people, deadline)
        text = (resp.text or "").strip()
        return "" if _is_silence(resp, text, prompt) else text
    resp, prompt = _speech(audio, filename, None, people, deadline)
    text = (resp.text or "").strip()
    if _is_silence(resp, text, prompt):
        return ""
    code = _LANG_CODE.get((getattr(resp, "language", "") or "").lower())
    if code and not _NATIVE_SCRIPT[code].search(text) and deadline.left() > 22:
        try:
            again, prompt = _speech(audio, filename, code, people, deadline)
        except Exception as err:  # the first transcript is still usable
            print("speech retry failed:", type(err).__name__, flush=True)
            return text
        retry = (again.text or "").strip()
        if retry and not _is_silence(again, retry, prompt):
            text = retry
    return text


class BadAnswer(ValueError):
    """The model answered, but not with a usable JSON object."""


_EXPECTED_KEYS = {"description", "total", "payer", "participants", "mode", "values", "items", "missing"}


def read_expense(text, known_people=(), deadline=None):
    """One model call, or a second on the backup model if the first fails in a way a retry can fix
    (busy, slow, unreachable, broken JSON). Returns the model's JSON as a dict."""
    import groq

    retryable = (json.JSONDecodeError, BadAnswer, groq.RateLimitError, groq.APITimeoutError,
                 groq.APIConnectionError, groq.InternalServerError, groq.BadRequestError)
    deadline = deadline or Deadline()
    known = ", ".join(p for p in known_people if p != ME) or "none yet"
    messages = [{"role": "system", "content": SYSTEM},
                {"role": "user", "content": f"Known people: {known}\nExpense: {text}"}]
    last = None
    for model in LLM_MODELS:
        if deadline.left() < 5:
            break
        try:
            resp = _client(timeout=min(25, deadline.left())).chat.completions.create(
                model=model, messages=messages, temperature=0, response_format={"type": "json_object"})
            data = json.loads(resp.choices[0].message.content or "")
            if not isinstance(data, dict) or not (_EXPECTED_KEYS & data.keys()):
                raise BadAnswer("no expense fields")
            return data
        except retryable as err:
            print("read attempt failed:", model, type(err).__name__, flush=True)
            last = err
    raise last or TooSlow()


def _number(value):
    """A positive amount from the model's answer, or None. Plain numbers and digit strings such as
    "2,500" or "₹2500" are read as they are; anything else is not guessed at."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if value > 0 and value == value and value != float("inf") else None
    text = re.sub(r"^(₹|rs\.?|inr)\s*", "", str(value or "").strip().lower()).replace(",", "").strip()
    return float(text) if re.fullmatch(r"\d+(\.\d+)?", text) and float(text) > 0 else None


def _name(raw, known):
    """Match a name to the group's spelling, case-insensitively. Unknown names are kept as said."""
    name = str(raw or "").strip()
    if not name:
        return ""
    if name.lower() in {"me", "i", "you", "myself", "naan", "main"}:
        return ME
    for k in known:
        if k.lower() == name.lower():
            return k
    # Speech models stretch or bend names ("Ravi" heard as "Ravivar"). Only snap to a known name
    # when exactly one is a close match, and the card still shows the result for checking.
    close = [k for k in known if k != ME and len(k) >= 3 and
             (name.lower().startswith(k.lower()) or _one_edit(name.lower(), k.lower()))]
    if len(close) == 1:
        return close[0]
    return name[:1].upper() + name[1:]


def _one_edit(a, b):
    """True if a and b differ by one inserted, removed or changed letter (names of 4+ letters)."""
    if min(len(a), len(b)) < 4 or abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) == 1
    short, long_ = sorted((a, b), key=len)
    return any(long_[:i] + long_[i + 1:] == short for i in range(len(long_)))


# Words for "him", "her" or "them" refer to someone already named, so they are never new people.
_PRONOUNS = {"aval", "avan", "avar", "avanga", "avargal", "ival", "ivan", "ivar", "avalum", "avanum",
             "he", "she", "him", "her", "they", "them", "woh", "wo", "unhe", "usne", "uske", "inhe", "unko"}
# A second word from this list makes it one person's full name ("Arun Kumar"), not two people.
_SURNAMES = {"kumar", "sharma", "iyer", "iyengar", "reddy", "singh", "nair", "pillai", "rao", "gupta", "verma",
             "patel", "das", "menon", "raj", "krishnan", "shetty", "jain", "khan", "naidu", "mehta", "joshi"}


def _people(raw_names, known):
    """Clean a list of names: drop pronouns, and split "Arun Ravi" into two people unless it is a
    known person or looks like a full name."""
    out = []
    for raw in raw_names or []:
        name = _name(raw, known)
        if not name or name.lower() in _PRONOUNS:
            continue
        words = name.split()
        if len(words) > 1 and name not in known and words[-1].lower() not in _SURNAMES:
            out.extend(n for n in (_name(w, known) for w in words) if n and n.lower() not in _PRONOUNS)
        else:
            out.append(name)
    return list(dict.fromkeys(out))


def to_expense(data, known_people=()):
    """Turn the model's JSON into an Expense, cleaning names. Returns (expense, missing)."""
    known = [ME, *[p for p in known_people if p != ME]]
    names = lambda xs: _people(xs, known)
    payer = _name(data.get("payer") if isinstance(data.get("payer"), str) else "", known) or ME
    participants = names(data.get("participants") if isinstance(data.get("participants"), list) else [])
    mode = data.get("mode") if data.get("mode") in ("equal", "exact", "shares", "percent") else "equal"
    raw_values = data.get("values") if isinstance(data.get("values"), dict) else {}
    values = {_name(k, known): _number(v) for k, v in raw_values.items()} if mode != "equal" else {}
    values = {k: v for k, v in values.items() if k and v is not None}
    for person in values:  # someone given a share or amount is a participant, even if the model forgot to list them
        if person and person not in participants:
            participants.append(person)
    items = []
    for it in data.get("items") if isinstance(data.get("items"), list) else []:
        amount = _number(it.get("amount")) if isinstance(it, dict) else None
        if amount is None:
            continue
        items.append(Item(amount, str(it.get("description") or ""), names(it.get("only")), names(it.get("excluded"))))
    missing = [m for m in (data.get("missing") if isinstance(data.get("missing"), list) else []) if m in ("amount", "people", "payer")]
    total = _number(data.get("total"))
    if total is None:
        missing = list(dict.fromkeys(["amount", *missing]))
    if not participants:
        missing = list(dict.fromkeys([*missing, "people"]))
    expense = Expense(str(data.get("description") or "Expense")[:60], total, payer, participants, mode, values, items)
    return expense, missing


# ---------- checking the answer against what was said ----------
# The model's answer is compared with the transcript. Nothing is changed here: each doubt becomes a
# short note on the confirmation card, and the person decides.

_NATIVE = re.compile(r"[஀-௿ऀ-ॿ]")
_FIRST_PERSON = {"i", "me", "my", "myself", "mine", "naan", "nan", "naanum", "en", "enakku", "ennoda", "main",
                 "maine", "mera", "meri", "mere", "mujhe", "hum", "humne", "நான்", "நானும்", "என்", "எனக்கு",
                 "मैं", "मैंने", "मेरे", "मेरा", "मुझे", "हम", "हमने"}
_GROUP_WORDS = {"everyone", "everybody", "all", "group", "team", "sab", "sabke", "sabhi", "sabko", "ellarum",
                "ellaarum", "ellorum", "எல்லாரும்", "எல்லோரும்", "सब", "सबके", "सभी", "सबको"}


def _amounts_said(text):
    """Numbers written as digits in the transcript, with 1.2k and 1.5 lakh worked out."""
    found = set()
    for m in re.finditer(r"(\d+(?:\.\d+)?)\s*(k|lakhs?|lacs?)?\b", (text or "").lower().replace(",", "")):
        value = float(m.group(1)) * (1000 if m.group(2) == "k" else 100000 if m.group(2) else 1)
        found.add(round(value, 2))
    return found


def _grounded(total, said):
    """The total was said, or is the sum of amounts that were said (food 1,200 + drinks 400)."""
    values = sorted(said)[:8]
    sums = {0.0}
    for v in values:
        sums |= {round(s + v, 2) for s in sums}
    return round(total, 2) in sums


def _said(name, words):
    """The name is in the transcript, allowing endings like Ravi-kku or Arun's and one-letter slips."""
    parts = name.lower().split()
    def hit(part):
        return any(w == part or (len(part) >= 3 and w.startswith(part)) or (len(part) >= 4 and _one_edit(w, part))
                   for w in words)
    return all(hit(p) for p in parts)


def _rupees(value):
    return f"₹{value:,.2f}".replace(".00", "")


def review(expense, missing, transcript, known_people=(), data=None):
    """Plain-English checks for the card. Empty when the answer matches what was said."""
    if not transcript:
        return []
    data = data if isinstance(data, dict) else {}
    notes = []
    words = _words(transcript)
    native = bool(_NATIVE.search(transcript))
    known = {k.lower(): k for k in known_people}

    raw_total = data.get("total")
    if raw_total not in (None, "", 0) and _number(raw_total) is None:
        notes.append("Kitty couldn't read the amount. Type it in.")
    elif expense.total and "amount" not in missing:
        said = _amounts_said(transcript)
        if said and not _grounded(float(expense.total), said):
            notes.append(f"Check the amount: {_rupees(float(expense.total))} isn't a number that was said.")
        elif not said:
            notes.append(f"{_rupees(float(expense.total))} was worked out from the words said. Check the amount.")

    # Names the cleaning step snapped to a friend ("Ravivar" → Ravi) are shown, never changed silently.
    raw_people = data.get("participants") if isinstance(data.get("participants"), list) else []
    for raw in [data.get("payer"), *raw_people]:
        if not isinstance(raw, str) or not raw.strip():
            continue
        matched = _name(raw, [ME, *known_people])
        if matched in known_people and matched.lower() != raw.strip().lower():
            notes.append(f"Heard “{raw.strip()}”, matched to your friend {matched}. Change it if that's someone else.")

    people = [expense.payer, *expense.participants, *[p for i in expense.items for p in (*i.only, *i.excluded)]]
    group_said = bool(_GROUP_WORDS & set(words))
    for person in dict.fromkeys(p for p in people if p and p != ME):
        if _said(person, words):
            continue
        if person.lower() in known:
            if native or group_said:
                continue
            if person == expense.payer:
                notes.append(f"{person} is set as the payer but wasn't mentioned. Check who paid.")
            else:
                notes.append(f"{person} was added but wasn't mentioned. Check who shares this.")
        elif native:
            notes.append(f"Check the spelling of {person}.")
        else:
            notes.append(f"{person} wasn't in what was said. Check the names.")

    others = [p for p in expense.participants if p != ME]
    if "payer" in missing:
        notes.append("Check who paid.")
    elif expense.payer == ME and others and not (_FIRST_PERSON & set(words)):
        notes.append("Nobody was said to have paid, so Kitty put you. Check who paid.")

    raw_values = data.get("values") if isinstance(data.get("values"), dict) else {}
    if expense.mode != "equal" and any(_number(v) is None for v in raw_values.values()):
        notes.append("Some shares couldn't be read. Check the split.")
    raw_items = data.get("items") if isinstance(data.get("items"), list) else []
    if len(raw_items) > len(expense.items):
        notes.append("Part of the bill couldn't be read. Check the separate items.")
    return list(dict.fromkeys(notes))[:5]
