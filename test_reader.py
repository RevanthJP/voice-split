"""Tests for cleaning the AI's answer into an expense. No network: they use made-up AI answers."""
import unittest

from reader import to_expense
from splits import ME


def read(data, known=()):
    base = {"description": "Petrol", "total": 1200, "payer": "me", "mode": "equal", "values": {}, "items": [], "missing": []}
    return to_expense({**base, **data}, known)


class Names(unittest.TestCase):
    def test_two_names_without_and_are_two_people(self):
        e, _ = read({"participants": ["me", "Arun Ravi"]})
        self.assertEqual(e.participants, [ME, "Arun", "Ravi"])

    def test_full_name_stays_one_person(self):
        e, _ = read({"participants": ["me", "Arun Kumar"]})
        self.assertEqual(e.participants, [ME, "Arun Kumar"])

    def test_known_two_word_name_stays(self):
        e, _ = read({"participants": ["me", "Anna Mary"]}, ["Anna Mary"])
        self.assertEqual(e.participants, [ME, "Anna Mary"])

    def test_pronoun_dropped(self):
        e, _ = read({"payer": "Prathi", "participants": ["naan", "Prathi", "Aval"]})
        self.assertEqual(e.participants, [ME, "Prathi"])

    def test_misheard_known_name_snaps(self):
        e, _ = read({"participants": ["me", "Arun", "Ravivar"]}, ["Arun", "Ravi"])
        self.assertEqual(e.participants, [ME, "Arun", "Ravi"])

    def test_known_name_case(self):
        e, _ = read({"participants": ["me", "prathi"]}, ["Prathi"])
        self.assertEqual(e.participants, [ME, "Prathi"])

    def test_names_inside_items_cleaned(self):
        e, _ = read({"participants": ["me", "Arun Ravi"], "items": [{"amount": 300, "description": "drinks", "only": [], "excluded": ["arun"]}]}, ["Arun", "Ravi"])
        self.assertEqual(e.items[0].excluded, ["Arun"])


class Missing(unittest.TestCase):
    def test_no_amount(self):
        _, missing = read({"total": None, "participants": ["me", "Arun"]})
        self.assertIn("amount", missing)

    def test_no_people(self):
        _, missing = read({"participants": []})
        self.assertIn("people", missing)

    def test_shares_add_people(self):
        e, _ = read({"mode": "shares", "participants": [], "values": {"Ravi": 3, "me": 1}})
        self.assertEqual(sorted(e.participants), sorted([ME, "Ravi"]))


# ---------- silence and hint echoes (the speech call is faked; no key, no network, no audio files) ----------
import io
import types
import wave

import reader


def silent_wav(seconds=1.0, rate=16000):
    """A real WAV file of pure silence, built here in memory."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(seconds * rate))
    return buf.getvalue()


class SilenceGuard(unittest.TestCase):
    HINT = reader._SPEECH_HINT[None]

    def setUp(self):
        self.real_speech, self.calls = reader._speech, []
        self.audio = silent_wav()

    def tearDown(self):
        reader._speech = self.real_speech

    def fake(self, *replies):
        """Each reply is (text, no_speech_prob or None, detected language)."""
        queue = list(replies)

        def speech(audio, filename, language=None):
            self.calls.append(language)
            # the fake gets exactly the silent WAV the test built
            with wave.open(io.BytesIO(audio)) as w:
                assert w.readframes(w.getnframes()).strip(b"\x00") == b""
            text, prob, lang = queue.pop(0)
            segs = [] if prob is None else [{"no_speech_prob": prob}]
            return types.SimpleNamespace(text=text, language=lang, segments=segs)
        reader._speech = speech

    def hear(self, text, prob, lang="english", language=None):
        self.fake((text, prob, lang))
        return reader.transcribe(self.audio, "clip.wav", language)

    def test_thresholds(self):
        self.assertEqual(reader.SILENCE_NO_SPEECH, 0.6)
        self.assertLess(reader.ECHO_NO_SPEECH, reader.SILENCE_NO_SPEECH)

    def test_the_whole_hint_echoed_back_is_silence(self):
        self.assertEqual(self.hear(" " + self.HINT, 0.45), "")

    def test_a_piece_of_the_hint_is_silence_when_the_model_doubts_there_was_speech(self):
        self.assertEqual(self.hear(" I paid 1,200 rupees.", 0.35), "")
        self.assertEqual(self.hear("split with Arun and Ravi", 0.5), "")

    def test_a_piece_of_the_hint_with_a_low_no_speech_score_is_kept(self):
        # text matching alone is never enough: real speech can say these words
        self.assertEqual(self.hear(" I paid 1,200 rupees.", 0.05), "I paid 1,200 rupees.")
        self.assertEqual(self.hear(" I paid 1,200 rupees.", 0.25), "I paid 1,200 rupees.")

    def test_a_piece_of_the_hint_with_no_score_at_all_is_kept(self):
        self.assertEqual(self.hear(" I paid 1,200 rupees.", None), "I paid 1,200 rupees.")

    def test_real_speech_with_similar_words_passes(self):
        self.assertEqual(self.hear(" I paid 1,200 rupees for petrol.", 0.02), "I paid 1,200 rupees for petrol.")
        self.assertEqual(self.hear(" I paid 1,200 rupees for petrol.", 0.45), "I paid 1,200 rupees for petrol.")
        self.assertEqual(self.hear(" Petrol 1,200, split with Arun and Meena.", 0.4), "Petrol 1,200, split with Arun and Meena.")

    def test_plain_silence_is_unchanged(self):
        self.assertEqual(self.hear(" Thank you.", 0.1), "")
        self.assertEqual(self.hear(" Anything at all", 0.7), "")
        self.assertEqual(self.hear("", None), "")

    def test_tamil_and_hindi_hints_are_checked_in_their_own_language(self):
        self.assertEqual(self.hear(" ஐநூறு, ஆயிரம், இரண்டாயிரம்", 0.4, "tamil", language="ta"), "")
        self.assertEqual(self.hear(" पाँच सौ, हज़ार, दो हज़ार।", 0.4, "hindi", language="hi"), "")
        self.assertEqual(self.hear(" பெட்ரோலுக்கு ஐநூறு ரூபாய் கொடுத்தேன்", 0.4, "tamil", language="ta"), "பெட்ரோலுக்கு ஐநூறு ரூபாய் கொடுத்தேன்")

    def test_an_echo_on_the_second_listen_does_not_replace_the_first(self):
        # the first listen hears Tamil in English letters; the second, forced to Tamil, only echoes the Tamil hint
        self.fake((" Petrol ku aayiram kuduthen", 0.02, "tamil"), (" ஐநூறு, ஆயிரம், இரண்டாயிரம், dinner, auto.", 0.5, "tamil"))
        self.assertEqual(reader.transcribe(self.audio, "clip.wav"), "Petrol ku aayiram kuduthen")
        self.assertEqual(self.calls, [None, "ta"])


if __name__ == "__main__":
    unittest.main()
