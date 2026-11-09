"""Offline checks for transcript_analysis.py. No API, and no key.

Run: ./.venv/bin/python bench/prompt_test/test_transcript_analysis.py
"""
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
import experiment as ex  # noqa: E402
import transcript_analysis as ta  # noqa: E402


SPEECH_RESULTS = HERE / "results" / "speech.json"


def value(text):
    return [s["value"] for s in ta.number_spans(text)]


class Numbers(unittest.TestCase):
    def test_english(self):
        self.assertEqual(value("I paid eight hundred fifty rupees"), [850])
        self.assertEqual(value("seven thousand rupees"), [7000])
        self.assertEqual(value("one lakh"), [100000])

    def test_hindi(self):
        self.assertEqual(value("तीन सौ रुपये"), [300])
        self.assertEqual(value("चार सौ पचास रुपये"), [450])
        self.assertEqual(value("छह हजार रुपये"), [6000])
        self.assertEqual(value("छह हज़ार रुपये"), [6000])
        self.assertEqual(value("डेढ़ हज़ार"), [1500])

    def test_tamil(self):
        self.assertEqual(value("நானூறு ரூபாய்"), [400])
        self.assertEqual(value("எழுநூற்று இருபது ரூபாய்"), [720])
        self.assertEqual(value("ஆறாயிரம் ரூபாய்"), [6000])

    def test_a_small_word_is_not_an_amount(self):
        self.assertEqual(value("बैंट दो"), [])

    def test_non_standard_spellings_are_noted(self):
        got = ta.classify_amount("एक सो रुपए", 100)
        self.assertEqual(got["class"], "number-words-correct")
        self.assertTrue(got["notes"])
        got = ta.classify_amount("ஏழுநூறு இருபது ரூபாய்", 720)
        self.assertEqual(got["class"], "number-words-correct")
        self.assertTrue(got["notes"])

    def test_so_needs_a_count_word_before_it(self):
        self.assertEqual(value("वो सो गया"), [])


class Classes(unittest.TestCase):
    def check(self, text, truth, want):
        self.assertEqual(ta.classify_amount(text, truth)["class"], want, text)

    def test_digits(self):
        self.check("I paid 1,800 for petrol", 1800, "digits-correct")
        self.check("Swiggy 1.2k", 1200, "digits-correct")
        self.check("Paid 1.5 lakh", 150000, "digits-correct")

    def test_words(self):
        self.check("दिनर के तीन हजार दिये", 3000, "number-words-correct")

    def test_a_misheard_count_goes_to_a_person(self):
        self.check("किराने पर आज सौ रुपये", 800, "needs human check")
        self.check("Toxic கு ஆர் ஆயிரம் ரூபாய்", 6000, "needs human check")

    def test_wrong_number(self):
        self.check("toxic-க்கு 9000 ரூபாய்", 900, "wrong")

    def test_garbled(self):
        self.check("Main Dead Hazard का ग्रोसरी", 1500, "garbled/missing")


class VariantE(unittest.TestCase):
    def fix(self, text, friends, extra=None):
        return ta.correct_names(text, friends, extra)

    def test_near_miss_is_fixed_and_punctuation_kept(self):
        self.assertEqual(self.fix("split with Mena.", ["Meena"])[0], "split with Meena.")

    def test_two_words_merge_when_they_sound_like_a_friend(self):
        self.assertEqual(self.fix("split with Saint Thil and Pooja.", ["Senthil", "Pooja"])[0], "split with Senthil and Pooja.")

    def test_native_script_near_miss(self):
        self.assertIn("Ganesh", self.fix("गनेश के साथ", ["Ganesh"])[0])
        self.assertIn("Ganesh", self.fix("கனேஷ் கூட", ["Ganesh"])[0])

    def test_exact_friend_is_left_alone_even_beside_a_similar_friend(self):
        for word, friends in (("Priya", ["Priya", "Priyanka"]), ("Karthik", ["Karthik", "Karthika"])):
            self.assertEqual(self.fix(f"with {word}.", friends), (f"with {word}.", []))

    def test_a_tie_changes_nothing(self):
        self.assertEqual(self.fix("with Rahil.", ["Rahul", "Rohil"]), ("with Rahil.", []))

    def test_digits_and_number_words_are_never_changed(self):
        for text, friends in (("Paid 1200 to Arun", ["Arun", "Tarun"]), ("तीन सौ रुपये", ["तीनू", "सोनू"]),
                              ("எட்டு நூறு", ["எட்டா"]), ("eight hundred", ["Eighth", "Hundreds"])):
            got, changes = self.fix(text, friends)
            self.assertEqual(ta.number_fingerprint(got), ta.number_fingerprint(text))
            self.assertFalse([c for c in changes if c["from"] in ("तीन", "सौ", "எட்டு", "eight", "hundred", "1200")])

    def test_short_words_are_left_alone(self):
        self.assertEqual(self.fix("Ram paid", ["Rama"])[1], [])

    def test_common_words_are_not_friends(self):
        self.assertEqual(self.fix("I paid for dinner, split with him.", ["Ravi", "Arun", "Meena"])[1], [])


class RealTranscripts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not SPEECH_RESULTS.exists():
            raise unittest.SkipTest(f"{SPEECH_RESULTS.name} is kept local and is not in this checkout, so the tests on real transcripts are skipped.")
        cls.clips = ex.all_clips()
        cls.store = ex.load(SPEECH_RESULTS)
        cls.report, cls.data = ta.write(cls.clips, cls.store, Path(tempfile.mkdtemp()))

    def test_every_clip_and_variant_has_one_class(self):
        for variant in ta.VARIANTS:
            counts, _, total = ta.amount_counts(self.clips, self.data["amounts"], variant)
            self.assertEqual(sum(counts.values()), total)
            self.assertEqual(total, 41)

    def test_hand_checked_rows(self):
        amounts = self.data["amounts"]
        self.assertEqual(amounts["b-hi-grocery"]["A"]["class"], "digits-correct")
        self.assertEqual(amounts["b-hi-grocery"]["B"]["class"], "needs human check")
        self.assertEqual(amounts["b-hg-dedh-hazaar"]["A"]["class"], "garbled/missing")
        self.assertEqual(amounts["fresh-synth-ta-2"]["A"]["class"], "wrong")
        self.assertEqual(amounts["fresh-synth-ta-2"]["B"]["class"], "digits-correct")
        self.assertEqual(amounts["fresh-synth-hi-1"]["C"]["class"], "number-words-correct")
        self.assertEqual(amounts["b-tg-dinner"]["truth"], 2500)

    def test_arun_written_for_arjun_is_seen(self):
        self.assertEqual(self.data["names"]["fresh-synth-hi-1"]["Arjun"]["B"], "no")
        self.assertIn("Arun", self.data["not_spoken"]["fresh-synth-hi-1"]["B"])
        self.assertEqual(self.data["names"]["fresh-synth-hi-1"]["Arjun"]["A"], "yes")

    def test_strict_noise_column_counts_the_original_regression(self):
        existing = [c for c in self.clips if c["set"] == "existing"]
        self.assertEqual(ta.amount_pairs(existing, self.data["amounts"], "A", "B")[:2], (0, 0))
        self.assertEqual(ta.amount_pairs_strict(existing, self.data["amounts"], "A", "B"), (1, 0))

    def test_second_pass_table_covers_every_scored_clip(self):
        table = ta.second_pass_rows(self.clips, self.store, self.data["amounts"])
        for variant, row in table.items():
            self.assertEqual(sum(n for side in row.values() for n in side.values()), 41, variant)

    def test_e_never_changes_numbers(self):
        for run in (self.data["e"], self.data["stress"]):
            self.assertTrue(all(r["numbers_unchanged"] for r in run.values()))

    def test_report_states_the_limits(self):
        for text in ("not evidence about real speakers", "in-sample", "name_aliases.json", "No API calls", "within noise", "Kept local"):
            self.assertIn(text, self.report)


if __name__ == "__main__":
    unittest.main(verbosity=1)
