"""Make the fresh number-word clips for the speech-prompt experiment. macOS only, free, no network.

These are SYNTHETIC: computer voices reading clean text. They stress-test the speech prompt and say
nothing about real speakers. Amounts, friends and items come from a fixed seed, not from looking at
which amounts fail. Amounts that appear in any prompt being tested are never drawn.

Run after the prompts are frozen: ./.venv/bin/python bench/prompt_test/make_clips.py
"""
import hashlib
import json
import random
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
BENCH = HERE.parent
SEED = 20261109
HINT_AMOUNTS = {500, 640, 1000, 1200, 2000, 2750}
SHAPES = {"hi": ["hundreds", "hundreds", "thousands", "thousands", "compound"],
          "ta": ["hundreds", "hundreds", "thousands", "compound"],
          "en": ["hundreds", "thousands", "thousands"]}
VOICE = {"hi": "Lekha", "ta": "Vani", "en": "Rishi"}
LANG = {"hi": "hindi", "ta": "tamil", "en": "indian-english"}

ONES_HI = {1: "एक", 2: "दो", 3: "तीन", 4: "चार", 5: "पाँच", 6: "छह", 7: "सात", 8: "आठ", 9: "नौ"}
TENS_HI = {20: "बीस", 30: "तीस", 40: "चालीस", 50: "पचास", 60: "साठ", 70: "सत्तर", 80: "अस्सी", 90: "नब्बे"}
HUNDREDS_TA = {1: "நூறு", 2: "இருநூறு", 3: "முந்நூறு", 4: "நானூறு", 5: "ஐநூறு", 6: "அறுநூறு", 7: "எழுநூறு",
               8: "எண்ணூறு", 9: "தொள்ளாயிரம்"}
HUNDREDS_JOIN_TA = {1: "நூற்று", 2: "இருநூற்று", 3: "முந்நூற்று", 4: "நானூற்று", 5: "ஐநூற்று", 6: "அறுநூற்று",
                    7: "எழுநூற்று", 8: "எண்ணூற்று", 9: "தொள்ளாயிரத்து"}
THOUSANDS_TA = {3: "மூவாயிரம்", 4: "நாலாயிரம்", 5: "ஐயாயிரம்", 6: "ஆறாயிரம்", 7: "ஏழாயிரம்", 8: "எட்டாயிரம்",
                9: "ஒன்பதாயிரம்"}
TENS_TA = {20: "இருபது", 30: "முப்பது", 40: "நாற்பது", 50: "ஐம்பது", 60: "அறுபது", 70: "எழுபது", 80: "எண்பது",
           90: "தொண்ணூறு"}
ONES_EN = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine"}
ITEMS = {"hi": ["किराने", "टैक्सी", "खाने", "दवाई", "किताबों"],
         "ta": ["பெட்ரோலுக்கு", "சாப்பாட்டுக்கு", "டாக்ஸிக்கு", "மருந்துக்கு", "புத்தகத்துக்கு"],
         "en": ["groceries", "the taxi", "lunch", "medicine", "books"]}


def check_frozen():
    """Stops unless prompts.json is exactly what was frozen, so clips can't be made against a changed prompt."""
    want = re.search(r"sha256 ([0-9a-f]{64})", (HERE / "FREEZE.txt").read_text(encoding="utf-8")).group(1)
    got = hashlib.sha256((HERE / "prompts.json").read_bytes()).hexdigest()
    if got != want:
        sys.exit("prompts.json does not match FREEZE.txt: stopping.")


def in_words(amount, lang):
    th, hu, te = amount // 1000, amount % 1000 // 100, amount % 100
    if lang == "hi":
        return f"{ONES_HI[th]} हज़ार" if th else " ".join([f"{ONES_HI[hu]} सौ", *([TENS_HI[te]] if te else [])])
    if lang == "ta":
        return THOUSANDS_TA[th] if th else f"{HUNDREDS_JOIN_TA[hu]} {TENS_TA[te]}" if te else HUNDREDS_TA[hu]
    return f"{ONES_EN[th]} thousand" if th else f"{ONES_EN[hu]} hundred"


def sentence(lang, item, amount, friends):
    if lang == "hi":
        return f"मैंने {item} के लिए {in_words(amount, lang)} रुपये दिए, {' और '.join(friends)} के साथ बाँटो"
    if lang == "ta":
        return f"நான் {item} {in_words(amount, lang)} ரூபாய் கொடுத்தேன், {' '.join(friends)} கூட பிரிச்சுக்கோ"
    return f"I paid {in_words(amount, lang)} rupees for {item}, split with {' and '.join(friends)}."


def plan():
    """The clips, decided only by the seed. Makes no audio."""
    rng = random.Random(SEED)
    aliases = {k: v for k, v in json.loads((BENCH / "name_aliases.json").read_text(encoding="utf-8")).items()
               if not k.startswith("_")}
    pool = sorted(n for n, v in aliases.items() if v.get("hi") and v.get("ta") and n not in ("Arun", "Ravi"))
    draws = {"hundreds": [a for a in range(100, 1000, 100) if a not in HINT_AMOUNTS],
             "thousands": [a for a in range(3000, 10000, 1000) if a not in HINT_AMOUNTS],
             "compound": [h * 100 + t for h in range(1, 10) for t in range(20, 100, 10) if h * 100 + t not in HINT_AMOUNTS]}
    for values in draws.values():
        rng.shuffle(values)
    clips = []
    for lang, shapes in SHAPES.items():
        for number, shape in enumerate(shapes, 1):
            amount = draws[shape].pop()
            count = rng.choice([1, 2]) if amount % 3 == 0 else 1
            picked = rng.sample(pool, count + 1)
            friends, spare = picked[:count], picked[count]
            spoken = friends if lang == "en" else [aliases[f][lang][0] for f in friends]
            item = rng.choice(ITEMS[lang])
            text = sentence(lang, item, amount, spoken)
            share = amount / (count + 1)
            clip_id = f"fresh-synth-{lang}-{number}"
            clips.append({"file": f"clips/{clip_id}.wav", "kind": "synthetic-fresh", "voice": VOICE[lang],
                          "reference": text, "amount": amount, "amount_shape": shape,
                          "case": {"id": clip_id, "lang": LANG[lang], "categories": ["amount-words", "synthetic-fresh"],
                                   "text": text, "people": sorted([*friends, spare]), "payer": "You",
                                   "owed": {"You": share, **{f: share for f in friends}},
                                   "name_forms": {f: aliases[f].get(lang, []) for f in friends}}})
    return clips


def main():
    check_frozen()
    (HERE / "clips").mkdir(exist_ok=True)
    clips = plan()
    for clip in clips:
        subprocess.run(["say", "-v", clip["voice"], "-o", str(HERE / clip["file"]), "--data-format=LEI16@16000",
                        clip["reference"]], check=True)
    (HERE / "clips.json").write_text(json.dumps(clips, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(len(clips), "synthetic clips written")


if __name__ == "__main__":
    main()
