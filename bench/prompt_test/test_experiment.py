"""Offline checks for the speech-prompt experiment. Groq is replaced by a fake; no key is used or read.

Run: ./.venv/bin/python bench/prompt_test/test_experiment.py
"""
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
os.environ["GROQ_API_KEY"] = "fake-key-for-offline-test"

import dotenv  # noqa: E402
dotenv.load_dotenv = lambda *a, **k: False  # the tests never open a .env file
import groq  # noqa: E402

import experiment as ex  # noqa: E402
import make_clips  # noqa: E402

SPEECH_LOG, CHAT_LOG = [], []
FAIL_CHAT = []


class FakeGroq:
    def __init__(self, **_):
        self.audio = types.SimpleNamespace(transcriptions=types.SimpleNamespace(create=self.speech))
        self.chat = types.SimpleNamespace(completions=types.SimpleNamespace(create=self.chatting))

    def speech(self, **k):
        SPEECH_LOG.append(k)
        prompt = k["prompt"]
        text = "मैंने आज सौ रुपये" if prompt.rstrip(".").split(" Names: ")[-1] != prompt.rstrip(".") else "I paid 800, split with Neha."
        return types.SimpleNamespace(text=text, language="english", segments=[])

    def chatting(self, **k):
        CHAT_LOG.append(k)
        if FAIL_CHAT:
            raise FAIL_CHAT[0]
        body = {"description": "Food", "total": 800, "payer": "You", "participants": ["You", "Neha"], "mode": "equal",
                "values": {}, "items": [], "missing": []}
        msg = types.SimpleNamespace(content=json.dumps(body))
        return types.SimpleNamespace(choices=[types.SimpleNamespace(message=msg)])


def clip(cid="c1", ref="मैंने आठ सौ रुपये"):
    return {"id": cid, "set": "fresh", "path": TMP / "a.wav", "reference": ref,
            "case": {"id": cid, "lang": "hindi", "text": ref, "reference": ref, "people": ["Neha"], "payer": "You",
                     "owed": {"You": 400, "Neha": 400}}}


TMP = Path(tempfile.mkdtemp())
(TMP / "a.wav").write_bytes(b"RIFFfake")


class Experiment(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.patch = mock.patch.object(groq, "Groq", FakeGroq)
        cls.patch.start()
        cls.reader, cls.splits = ex.bench.load_code("current")
        cls.real_prompt = staticmethod(cls.reader.speech_prompt)
        cls.primary_models = list(cls.reader.LLM_MODELS)
        cls.prompts = ex.frozen_prompts()

    @classmethod
    def tearDownClass(cls):
        cls.patch.stop()

    def setUp(self):
        SPEECH_LOG.clear(); CHAT_LOG.clear(); FAIL_CHAT.clear()
        self.reader.LLM_MODELS[:] = self.primary_models
        self.out = Path(tempfile.mkdtemp())

    def build(self, v, lang=None, people=("Neha", "Rahul")):
        return ex.build_prompt(self.reader, self.prompts[v], lang, list(people))

    def test_b_is_exactly_the_app_prompt(self):
        for lang in (None, "ta", "hi"):
            self.assertEqual(self.build("B", lang), self.real_prompt(lang, ["Neha", "Rahul"]))

    def test_a_has_no_names(self):
        self.assertNotIn("Neha", self.build("A"))

    def test_b2_only_removes_the_three_words(self):
        self.assertEqual(self.build("B").replace("Swiggy, Ola, rent, ", ""), self.build("B2"))
        self.assertIn("Neha", self.build("B2"))

    def test_c_has_names_first_and_ends_on_amounts(self):
        got = self.build("C")
        self.assertTrue(got.startswith("Names: Neha, Rahul. Petrol"))
        self.assertTrue(got.endswith("I paid 1,200 rupees, 2,750, 640."))

    def test_c_stays_in_budget_by_dropping_names(self):
        many = [f"Friendname{chr(97 + i)}{chr(98 + i)}" for i in range(24)] * 3
        many = [f"{n}{'x' * (i % 5)}" for i, n in enumerate(many)]
        got = self.build("C", "ta", many)
        self.assertLessEqual(self.reader._tokens(got), self.reader._PROMPT_BUDGET)
        self.assertTrue(got.endswith(self.prompts["C"]["hints"]["ta"]))

    def test_changed_prompts_are_refused(self):
        folder = Path(tempfile.mkdtemp())
        (folder / "FREEZE.txt").write_text((HERE / "FREEZE.txt").read_text(encoding="utf-8"), encoding="utf-8")
        (folder / "prompts.json").write_bytes((HERE / "prompts.json").read_bytes() + b" ")
        with self.assertRaises(SystemExit):
            ex.frozen_prompts(folder)

    def test_clip_plan_is_the_same_every_time_and_avoids_prompt_amounts(self):
        a, b = make_clips.plan(), make_clips.plan()
        self.assertEqual(a, b)
        self.assertEqual(len(a), 12)
        self.assertFalse({c["amount"] for c in a} & make_clips.HINT_AMOUNTS)
        for c in a:
            self.assertFalse(any(ch.isdigit() for ch in c["reference"]), c["reference"])
            self.assertAlmostEqual(sum(c["case"]["owed"].values()), c["amount"])

    def test_saved_clips_match_the_seed(self):
        self.assertEqual(json.loads((HERE / "clips.json").read_text(encoding="utf-8")), make_clips.plan())

    def run_speech(self, clips):
        return ex.step_speech(self.reader, clips, self.prompts, self.out, sleep=0)

    def test_speech_sends_each_variant_its_prompt_and_resumes(self):
        store = self.run_speech([clip()])
        self.assertEqual(len(SPEECH_LOG), 4)
        self.assertEqual([k["prompt"] for k in SPEECH_LOG], [self.build(v, people=["Neha"]) for v in ex.VARIANTS])
        self.assertEqual(store["B|c1"]["text"], "मैंने आज सौ रुपये")
        self.run_speech([clip()])
        self.assertEqual(len(SPEECH_LOG), 4)

    def test_second_pass_also_uses_the_variants_prompt(self):
        calls = []

        def english_letters_hindi(fake, **k):
            calls.append(k)
            return types.SimpleNamespace(text="maine aath sau diye", language="hindi", segments=[])
        with mock.patch.object(FakeGroq, "speech", english_letters_hindi):
            store = self.run_speech([clip()])
        self.assertEqual(store["C|c1"]["second_pass"], 1)
        second = [k for k in calls if k.get("language") == "hi"]
        self.assertEqual([k["prompt"] for k in second], [self.build(v, "hi", ["Neha"]) for v in ex.VARIANTS])

    def test_reading_is_shared_by_identical_transcripts_and_main_model_only(self):
        store = self.run_speech([clip()])
        with mock.patch.object(ex.time, "sleep"):
            reads = ex.step_read(self.reader, self.splits, [clip()], store, self.out, sleep=0)
        self.assertEqual(len(CHAT_LOG), len({r["text"] for r in store.values()}))
        self.assertTrue(all(k["model"] == self.primary_models[0] for k in CHAT_LOG))
        self.assertTrue(all(r["answered_by"] == "primary" for r in reads.values()))

    def test_call_cap_stops_and_resumes(self):
        clips = [clip("c1"), clip("c2")]
        store = self.run_speech(clips)
        ex.step_read(self.reader, self.splits, clips, store, self.out, max_calls=1, sleep=0)
        self.assertEqual(len(CHAT_LOG), 1)
        ex.step_read(self.reader, self.splits, clips, store, self.out, sleep=0)
        self.assertEqual(len(CHAT_LOG), len(ex.needed_readings(clips, store)))

    def test_rate_limit_stops_without_recording_a_failure(self):
        store = self.run_speech([clip()])
        FAIL_CHAT.append(groq.RateLimitError("limit", response=mock.Mock(status_code=429, headers={}, request=mock.Mock()), body=None))
        with mock.patch.object(ex.bench.time, "sleep"), self.assertRaises(ex.Stop):
            ex.step_read(self.reader, self.splits, [clip()], store, self.out, sleep=0)
        self.assertEqual(ex.load(self.out / "reads.json"), {})

    def test_a_failed_reading_drops_the_clip_from_every_variant(self):
        store = {f"{v}|c1": {"status": "ok", "text": "t" + v} for v in ex.VARIANTS}
        reads = {f"c1|t{v}": {"final_ok": True, "amount_ok": True, "names_ok": True} for v in ex.VARIANTS}
        reads["c1|tC"] = {"error": "BadRequestError"}
        rows, dropped = ex.table([clip()], store, reads)
        self.assertEqual(rows, {})
        self.assertIn("c1", dropped)

    def test_sign_test_values(self):
        self.assertEqual(ex.sign_test(0, 0), 1.0)
        self.assertEqual(ex.sign_test(5, 0), 0.0625)
        self.assertEqual(ex.sign_test(6, 0), 0.03125)
        self.assertIn("within noise", ex.verdict(5, 0))
        self.assertIn("suggestive", ex.verdict(6, 0))
        self.assertIn("clear", ex.verdict(10, 0))

    def test_punctuation_ignored_keeps_digit_groups_equal(self):
        self.assertEqual(ex.punctuation_free("Paid 1,500. Ok!"), ex.punctuation_free("paid 1500 ok"))
        self.assertEqual(ex.punctuation_free("खर्च के, नेहा।"), ex.punctuation_free("खर्च के नेहा"))
        self.assertNotEqual(ex.punctuation_free("800"), ex.punctuation_free("आज सौ"))

    def test_digit_and_word_amounts_are_kept_apart(self):
        self.assertEqual(ex.amount_kind(clip(ref="I paid 800")), "digits")
        self.assertEqual(ex.amount_kind(clip(ref="आठ सौ")), "words")

    def test_report_has_counts_diff_list_and_warning(self):
        clips = [clip()]
        store = self.run_speech(clips)
        reads = ex.step_read(self.reader, self.splits, clips, store, self.out, sleep=0)
        text = ex.write_report(clips, self.prompts, store, reads, self.out, {})
        self.assertIn("/1", text)
        self.assertIn("not evidence about real speakers", text)
        self.assertIn("Every clip whose transcript differs", text)
        self.assertIn("I paid 800, split with Neha.", text)
        self.assertIn("मैंने आज सौ रुपये", text)
        self.assertIn("punctuation ignored", text)
        self.assertIn("main model", text)

    def test_real_clip_list_is_30_existing_and_12_fresh(self):
        clips = ex.all_clips()
        self.assertEqual(sum(c["set"] == "existing" for c in clips), 30)
        self.assertEqual(sum(c["set"] == "fresh" for c in clips), 12)
        self.assertEqual(sum(ex.amount_kind(c) == "words" and c["set"] == "fresh" for c in clips), 12)
        self.assertEqual([sum(ex.amount_kind(c) == k and c["set"] == "existing" for c in clips) for k in ("digits", "words", "none")], [24, 5, 1])


if __name__ == "__main__":
    unittest.main(verbosity=1)
