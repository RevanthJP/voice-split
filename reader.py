"""Speech to text, then one model call that reads who paid, how much and who shares.

The model never does maths. It returns a structured description, and splits.py works out the money.
"""
import json
import os
import re

from dotenv import load_dotenv

from splits import ME, Expense, Item

load_dotenv()

STT_MODEL = "whisper-large-v3"
LLM_MODELS = ["openai/gpt-oss-20b", "openai/gpt-oss-120b"]

# Hints written in the speaker's own mix, so the speech model keeps their words and numbers.
_SPEECH_HINT = {
    None: "Petrol, dinner, auto, split with Arun and Ravi, I paid 1,200 rupees.",
    "ta": "நான் petrol-க்கு ஆயிரத்து இருநூறு ரூபாய் கொடுத்தேன், Arun Ravi கூட split பண்ணு. "
          "ஐநூறு, ஆயிரம், இரண்டாயிரம், dinner, auto.",
    "hi": "मैंने petrol के लिए बारह सौ रुपये दिए, Arun और Ravi के साथ split करो। पाँच सौ, हज़ार, दो हज़ार।",
}
_LANG_CODE = {"tamil": "ta", "ta": "ta", "hindi": "hi", "hi": "hi"}
_NATIVE_SCRIPT = {"ta": re.compile(r"[஀-௿]"), "hi": re.compile(r"[ऀ-ॿ]")}
_SILENCE = {"thank you", "thanks", "thank you very much", "thanks for watching", "you", "bye", "okay", "ok",
            "நன்றி", "धन्यवाद", "शुक्रिया"}

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


def _client():
    from groq import Groq

    key = os.getenv("GROQ_API_KEY")
    if not key:
        raise RuntimeError("GROQ_API_KEY is not set")
    return Groq(api_key=key, max_retries=1, timeout=25)


def _speech(audio, filename, language=None):
    kwargs = dict(file=(filename, audio), model=STT_MODEL, response_format="verbose_json",
                  temperature=0.0, prompt=_SPEECH_HINT[language])
    if language:
        kwargs["language"] = language
    return _client().audio.transcriptions.create(**kwargs)


def _is_silence(resp, text):
    cleaned = re.sub(r"[^\w\s]", "", text).strip().lower()
    if not cleaned or cleaned in _SILENCE:
        return True
    segs = getattr(resp, "segments", None) or []
    probs = [s.get("no_speech_prob") if isinstance(s, dict) else getattr(s, "no_speech_prob", None) for s in segs]
    probs = [p for p in probs if p is not None]
    return bool(probs) and sum(probs) / len(probs) > 0.6


def transcribe(audio, filename="clip.webm", language=None):
    """Returns the words as spoken. If the person chose a language, listen in that language only.
    Otherwise detect it, and if Tamil or Hindi speech comes back with no Tamil or Hindi script,
    the model has likely translated it, so it listens once more in that language."""
    if language in ("ta", "hi", "en"):
        resp = _speech(audio, filename, language=language if language != "en" else None)
        text = (resp.text or "").strip()
        return "" if _is_silence(resp, text) else text
    resp = _speech(audio, filename)
    text = (resp.text or "").strip()
    if _is_silence(resp, text):
        return ""
    code = _LANG_CODE.get((getattr(resp, "language", "") or "").lower())
    if code and not _NATIVE_SCRIPT[code].search(text):
        again = _speech(audio, filename, language=code)
        retry = (again.text or "").strip()
        if retry and not _is_silence(again, retry):
            text = retry
    return text


def read_expense(text, known_people=()):
    """One model call. Returns the model's JSON as a dict."""
    from groq import RateLimitError

    known = ", ".join(p for p in known_people if p != ME) or "none yet"
    messages = [{"role": "system", "content": SYSTEM},
                {"role": "user", "content": f"Known people: {known}\nExpense: {text}"}]
    for i, model in enumerate(LLM_MODELS):
        try:
            resp = _client().chat.completions.create(model=model, messages=messages, temperature=0,
                                                     response_format={"type": "json_object"})
            return json.loads(resp.choices[0].message.content)
        except RateLimitError:
            if i == len(LLM_MODELS) - 1:
                raise


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
    payer = _name(data.get("payer"), known) or ME
    participants = names(data.get("participants"))
    mode = data.get("mode") if data.get("mode") in ("equal", "exact", "shares", "percent") else "equal"
    values = {_name(k, known): v for k, v in (data.get("values") or {}).items()} if mode != "equal" else {}
    for person in values:  # someone given a share or amount is a participant, even if the model forgot to list them
        if person and person not in participants:
            participants.append(person)
    items = []
    for it in data.get("items") or []:
        try:
            amount = float(it.get("amount"))
        except (TypeError, ValueError):
            continue
        items.append(Item(amount, str(it.get("description") or ""), names(it.get("only")), names(it.get("excluded"))))
    missing = [m for m in (data.get("missing") or []) if m in ("amount", "people", "payer")]
    total = data.get("total")
    if total in (None, "", 0):
        missing = list(dict.fromkeys(["amount", *missing]))
    if not participants:
        missing = list(dict.fromkeys([*missing, "people"]))
    expense = Expense(str(data.get("description") or "Expense")[:60], total, payer, participants, mode, values, items)
    return expense, missing
