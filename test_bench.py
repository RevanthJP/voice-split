"""Tests for the benchmark scorer itself (no network)."""
import argparse
import contextlib
import io
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent / "bench"))
import reader  # noqa: E402
import run  # noqa: E402
import splits  # noqa: E402
from splits import Expense, Item  # noqa: E402


class Measures(unittest.TestCase):
    def test_wer_ignores_case_punctuation_and_commas(self):
        self.assertEqual(run.wer("I paid 1,800 for petrol.", "i paid 1800 for Petrol"), 0)

    def test_wer_counts_a_wrong_word(self):
        self.assertAlmostEqual(run.wer("split with Arun and Ravi", "split with Aaron and Ravi"), 0.2)

    def test_tamil_vowel_signs_kept(self):
        self.assertEqual(run.normalise("சுரேஷ் பெட்ரோலுக்கு,"), ["சுரேஷ்", "பெட்ரோலுக்கு"])

    def test_cer_small_for_one_letter(self):
        self.assertLess(run.cer("Ravi", "Ravee"), 0.6)

    def test_names_heard_any_script(self):
        case = {"owed": {"You": 1, "Suresh": 1}, "payer": "Suresh", "name_forms": {"Suresh": ["சுரேஷ்"]}}
        self.assertEqual(run.names_heard(case, "சுரேஷ் கொடுத்தான்"), 1)


class Scoring(unittest.TestCase):
    case = {"text": "Lunch 1600, Arun Ravi Kavya, Kavya no drinks 400", "payer": "You", "people": [],
            "owed": {"You": 433.33, "Arun": 433.33, "Ravi": 433.33, "Kavya": 300}}

    def test_correct_expense_passes(self):
        e = Expense("Lunch", 1600, "You", ["You", "Arun", "Ravi", "Kavya"], items=[Item(400, "drinks", [], ["Kavya"])])
        s = run.score_expense(self.case, e, [], splits)
        self.assertTrue(all(s[k] for k in ("final_ok", "amount_ok", "payer_ok", "participants_ok", "names_ok")))

    def test_invented_person_fails_names(self):
        e = Expense("Lunch", 1600, "You", ["You", "Arun", "Ravi", "Kavya", "Meena"], items=[Item(400, "drinks", [], ["Kavya"])])
        s = run.score_expense(self.case, e, [], splits)
        self.assertFalse(s["names_ok"])
        self.assertFalse(s["final_ok"])

    def test_wrong_amount(self):
        e = Expense("Lunch", 1200, "You", ["You", "Arun", "Ravi", "Kavya"])
        self.assertFalse(run.score_expense(self.case, e, [], splits)["amount_ok"])

    def test_missing_case(self):
        e = Expense("Dinner", None, "You", ["You", "Arun"])
        self.assertTrue(run.score_expense({"text": "", "missing": "amount"}, e, ["amount"], splits)["final_ok"])


class Names(unittest.TestCase):
    def test_sound_alike_names_are_different(self):
        self.assertFalse(run.mentions("Karthik", "Karthika paid"))
        self.assertFalse(run.mentions("Priya", "split with Priyanka"))
        self.assertFalse(run.mentions("Neha", "Sneha ke saath"))

    def test_suffixes_still_count(self):
        for name, text in [("Ravi", "Ravikku 500"), ("Ravi", "Ravi-kku"), ("Rahul", "Rahulne diye"), ("Arun", "Arun's")]:
            self.assertTrue(run.mentions(name, text), text)


def _case(**kw):
    base = {"id": "t", "text": "I paid 900, split with Priya and Karthik", "people": ["Priya", "Priyanka", "Karthik"],
            "payer": "You", "owed": {"You": 300, "Priya": 300, "Karthik": 300}}
    return {**base, **kw}


def _diag(case, expense, heard=None, notes=()):
    scored = run.score_expense(case, expense, [], splits)
    return run.diagnose(case, expense, scored, heard or case["text"], list(notes), splits)


class Diagnosis(unittest.TestCase):
    def test_right_answer_has_no_diagnosis(self):
        self.assertEqual(_diag(_case(), Expense("Pizza", 900, "You", ["You", "Priya", "Karthik"])), {})

    def test_friend_swapped_for_sound_alike(self):
        d = _diag(_case(), Expense("Pizza", 900, "You", ["You", "Priyanka", "Karthik"]))
        self.assertEqual(d["friend_added"], ["Priyanka"])
        self.assertEqual(d["friend_swapped"], ["Priya → Priyanka"])

    def test_unsaid_friend_added(self):
        d = _diag(_case(), Expense("Pizza", 900, "You", ["You", "Priya", "Karthik", "Priyanka"]))
        self.assertEqual(d["friend_added"], ["Priyanka"])
        self.assertNotIn("friend_swapped", d)

    def test_payer_assumed(self):
        d = _diag(_case(payer="Karthik"), Expense("Pizza", 900, "You", ["You", "Priya", "Karthik"]))
        self.assertEqual(d["payer_error"], "assumed You")

    def test_amount_read_wrong_vs_heard_wrong(self):
        e = Expense("Pizza", 990, "You", ["You", "Priya", "Karthik"])
        self.assertTrue(_diag(_case(), e)["amount_error"].startswith("read wrong"))
        self.assertTrue(_diag(_case(), e, heard="I paid 990, split with Priya and Karthik")["amount_error"].startswith("heard wrong"))
        self.assertEqual(_diag(_case(), e, heard="nine hundred, split with Priya and Karthik")["amount_error"], "from number words")

    def test_exclusion_failure_shows_extra_sharer(self):
        case = _case(owed={"You": 450, "Priya": 450}, text="I paid 900 with Priya, not Karthik")
        d = _diag(case, Expense("Pizza", 900, "You", ["You", "Priya", "Karthik"]))
        self.assertEqual(d["extra_sharers"], ["Karthik"])

    def test_wrong_shares_named(self):
        case = _case(owed={"You": 400, "Priya": 200, "Karthik": 300})
        d = _diag(case, Expense("Pizza", 900, "You", ["You", "Priya", "Karthik"]))
        self.assertIn("wrong shares", d["split_wrong"])

    def test_expected_check(self):
        case = _case(expect_check="who paid")
        e = Expense("Pizza", 900, "You", ["You", "Priya", "Karthik"])
        self.assertTrue(_diag(case, e, notes=["Nobody was said to have paid, so Kitty put you. Check who paid."])["expected_check_shown"])
        self.assertFalse(_diag(case, e)["expected_check_shown"])

    def test_script_check(self):
        self.assertEqual(run.script_check({}, "நான் 500 கொடுத்தேன்", "I gave 500"), "translated or wrong script")
        self.assertEqual(run.script_check({}, "naan 500 kuduthen", "நான் 500 கொடுத்தேன்"), "switched to Tamil/Hindi script")
        self.assertEqual(run.script_check({}, "naan 500 kuduthen", "naan 500 kuduthen"), "ok")


class Models(unittest.TestCase):
    def test_fair_only_with_one_model(self):
        a = [{"model": "openai/gpt-oss-20b"}] * 3
        self.assertTrue(run.comparison_validity(a, a)[0])
        b = a[:2] + [{"model": "openai/gpt-oss-120b"}]
        valid, message = run.comparison_validity(a, b)
        self.assertFalse(valid)
        self.assertIn("INVALID", message)

    def test_no_answers_is_invalid(self):
        self.assertFalse(run.comparison_validity([{"error": "x"}], [{"error": "x"}])[0])

    def test_tracks_which_model_answered(self):
        import types
        from unittest import mock

        fake = types.SimpleNamespace(LLM_MODELS=["m-small", "m-big"])
        replies = [RuntimeError("busy"), '{"total": 5}']

        def create(**kw):
            r = replies.pop(0)
            if isinstance(r, Exception):
                raise r
            return mock.Mock(choices=[mock.Mock(message=mock.Mock(content=r))])
        client = mock.Mock()
        client.chat.completions.create.side_effect = create
        fake._client = lambda *a, **k: client

        def read_expense(text, people):
            for m in fake.LLM_MODELS:
                try:
                    return fake._client().chat.completions.create(model=m)
                except RuntimeError:
                    continue
        fake.read_expense = read_expense
        fake.to_expense = lambda data, people: (Expense("x", 5, "You", ["You"]), [])
        run.track_models(fake)
        _, _, _, _, _, tried, answered = run.read(fake, "x", [])
        self.assertEqual(answered, "m-big")
        self.assertEqual(tried, [("m-small", "RuntimeError"), ("m-big", "ok")])

    def test_summary_warns_on_mixed_models(self):
        rows = [{"id": "a", "model": "openai/gpt-oss-20b", "final_ok": True},
                {"id": "b", "model": "openai/gpt-oss-120b", "final_ok": True}]
        self.assertIn("Mixed models", run.summary(rows, "t"))


class CrossScriptNames(unittest.TestCase):
    """Day 2 reported 5 'friend inserted by the prompt' flags that were the same name in two scripts."""

    def test_same_name_in_hindi_and_latin(self):
        self.assertEqual(run.name_match("Amit", "मेरे और अमित के साथ"), "yes")
        self.assertEqual(run.name_match("Neha", "Neha के साथ"), "yes")

    def test_same_name_in_tamil_and_latin(self):
        self.assertEqual(run.name_match("Suresh", "சுரேஷ் பெட்ரோலுக்கு"), "yes")
        self.assertEqual(run.name_match("Arun", "அருண் ரவி கூட"), "yes")

    def test_genuinely_different_names(self):
        self.assertEqual(run.name_match("Priya", "प्रियंका के साथ"), "no")
        self.assertEqual(run.name_match("Karthik", "Karthika paid"), "no")
        self.assertEqual(run.name_match("Neha", "Sneha ke saath"), "no")
        self.assertEqual(run.name_match("Sathish", "Satish paid"), "no")  # spelling variant: not equated

    def test_uncertain_cases_are_not_decided(self):
        self.assertEqual(run.name_match("Suresh", "சுரேஷுக்கு கொடுத்தேன்"), "uncertain")  # inflected
        self.assertEqual(run.name_match("Ravi", "रविवार ने"), "uncertain")  # Ravivar ("Sunday") starts with रवि
        self.assertEqual(run.name_match("Rohit", "ரோஹித் கூட"), "uncertain")  # no Tamil spelling listed

    def test_day2_false_alarms_are_gone(self):
        cases = {c["id"]: c for c in json.loads((Path(__file__).parent / "bench" / "text.json").read_text(encoding="utf-8"))}
        day2 = [("b-hi-hotel", "Raviwar ने होटेल के लिए 6000 रुपये दिए, मेरे और Amit के साथ बराबर गातो।"),
                ("b-ta-petrol", "Suresh Petrol-க்கு 500 ரூபாய் கொடுத்தான், நானும் அவனும் பிரிச்சுக்கலாம்"),
                ("b-hi-grocery", "मैंने किराने पर आज सौ रुपये खर्च के, Neha के साथ ढातो।"),
                ("b-ta-digits", "நான் 1500 ரூபாய் சாப்பாட்டுக்கு கொடுத்தேன், Arun Ravi கூட பிரிச்சுக்கோ"),
                ("b-hi-drinks", "मैंने दिनर के 3000 दिए, Rahul, Amit और Sumit के साथ, पर Sumit ने ड्रिंक्स नहीं ली")]
        for cid, transcript in day2:
            inserted, _ = run.friends_in_transcript(cases[cid], cases[cid]["text"], transcript)
            self.assertEqual(inserted, [], cid)

    def test_real_insertion_still_caught(self):
        case = {"people": ["Rohit", "Neha", "Sneha"]}
        inserted, unsure = run.friends_in_transcript(case, "Maine 600 ka auto liya, Rohit ke saath split karo.",
                                                     "Maine 600 ka auto liya, Rohit aur Neha ke saath split karo.")
        self.assertEqual(inserted, ["Neha"])
        self.assertEqual(unsure, [])

    def test_uncertain_reported_separately(self):
        case = {"people": ["Rohit"]}
        inserted, unsure = run.friends_in_transcript(case, "ஆட்டோ 600", "ரோஹித் கூட ஆட்டோ 600")
        self.assertEqual((inserted, unsure), ([], ["Rohit"]))


class Attribution(unittest.TestCase):
    def _row(self, replies):
        import types
        from unittest import mock

        fake = types.SimpleNamespace(LLM_MODELS=["main-model", "backup-model"])

        def create(**kw):
            r = replies.pop(0)
            if isinstance(r, Exception):
                raise r
            return mock.Mock(choices=[mock.Mock(message=mock.Mock(content=r))])
        client = mock.Mock()
        client.chat.completions.create.side_effect = create
        fake._client = lambda *a, **k: client

        def read_expense(text, people):
            for m in fake.LLM_MODELS:
                try:
                    return json.loads(fake._client().chat.completions.create(model=m).choices[0].message.content)
                except RuntimeError:
                    continue
        fake.read_expense = read_expense
        fake.to_expense = lambda data, people: (Expense("x", 900, "You", ["You", "Priya", "Karthik"]), [])
        run.track_models(fake)
        return run.reading_row(_case(), fake, splits, "I paid 900, split with Priya and Karthik", [])

    def test_main_model_answer(self):
        row = self._row(['{"total": 900}'])
        self.assertEqual((row["model"], row["answered_by"], row["primary_failed"]), ("main-model", "primary", False))

    def test_backup_answer_is_marked(self):
        row = self._row([RuntimeError("bad json"), '{"total": 900}'])
        self.assertEqual((row["model"], row["answered_by"], row["primary_failed"]), ("backup-model", "backup", True))
        self.assertEqual(row["models_tried"], ["main-model: RuntimeError", "backup-model: ok"])
        self.assertIn("(backup, after main model failed)", run.summary([{"id": "x", **row}], "t"))


# ---------- Stage 1 instrumentation: everything below uses fake clients and makes no network calls ----------

def _whisper(text, language, segments=None):
    return types.SimpleNamespace(text=text, language=language, segments=segments if segments is not None else [])


SEG = {"no_speech_prob": 0.02, "avg_logprob": -0.31, "compression_ratio": 1.2}


def _fake_groq(speech, chat=()):
    speech, chat = list(speech), list(chat)

    def transcribe(**kw):
        r = speech.pop(0)
        if isinstance(r, Exception):
            raise r
        return r

    def complete(**kw):
        return types.SimpleNamespace(choices=[types.SimpleNamespace(message=types.SimpleNamespace(content=chat.pop(0)))])
    return types.SimpleNamespace(audio=types.SimpleNamespace(transcriptions=types.SimpleNamespace(create=transcribe)),
                                 chat=types.SimpleNamespace(completions=types.SimpleNamespace(create=complete)))


CLIP = types.SimpleNamespace(read_bytes=lambda: b"audio", name="clip.wav")


class SpeechPasses(unittest.TestCase):
    """The app's real transcribe() against a fake speech client."""

    def listen(self, speech, people=()):
        client = _fake_groq(speech)
        with mock.patch.object(reader, "_client", lambda *a, **k: client):
            run.track_models(reader)
            text, _, err = run.transcribe(reader, CLIP, list(people))
        return text, err, run.speech_fields()

    def test_single_pass_with_language_and_segments(self):
        text, err, f = self.listen([_whisper("I paid 500", "english", [SEG, SEG])])
        self.assertEqual((text, err), ("I paid 500", None))
        self.assertEqual((f["speech_first_calls"], f["speech_second_calls"]), (1, 0))
        call = f["speech_calls"][0]
        self.assertEqual((call["pass"], call["detected_language"], call["requested_language"], call["status"]),
                         ("first", "english", None, "ok"))
        self.assertEqual(call["segments"], [SEG, SEG])

    def test_second_pass_recorded_separately(self):
        second = {"no_speech_prob": 0.1, "avg_logprob": -0.5, "compression_ratio": 1.4}
        text, _, f = self.listen([_whisper("I gave 500", "tamil", [SEG]), _whisper("நான் 500 கொடுத்தேன்", "tamil", [second])])
        self.assertEqual(text, "நான் 500 கொடுத்தேன்")
        self.assertEqual((f["speech_first_calls"], f["speech_second_calls"]), (1, 1))
        first_call, second_call = f["speech_calls"]
        self.assertEqual((first_call["pass"], first_call["requested_language"]), ("first", None))
        self.assertEqual((second_call["pass"], second_call["requested_language"]), ("second", "ta"))
        self.assertEqual((first_call["detected_language"], second_call["detected_language"]), ("tamil", "tamil"))
        self.assertEqual((first_call["segments"], second_call["segments"]), ([SEG], [second]))

    def test_failed_second_pass_is_counted(self):
        text, err, f = self.listen([_whisper("I gave 500", "tamil", [SEG]), RuntimeError("boom")])
        self.assertEqual((text, err), ("I gave 500", None))  # the app keeps the first transcript
        self.assertEqual(f["speech_second_calls"], 1)
        self.assertEqual(f["speech_calls"][1]["status"], "RuntimeError")

    def test_segment_objects_and_missing_values(self):
        seg = types.SimpleNamespace(no_speech_prob=0.3, avg_logprob=None)
        _, _, f = self.listen([_whisper("I paid 500", "english", [seg])])
        self.assertEqual(f["speech_calls"][0]["segments"],
                         [{"no_speech_prob": 0.3, "avg_logprob": None, "compression_ratio": None}])

    def test_each_clip_starts_a_fresh_count(self):
        self.listen([_whisper("I gave 500", "tamil"), _whisper("நான் 500", "tamil")])
        _, _, f = self.listen([_whisper("I paid 500", "english")])
        self.assertEqual((f["speech_first_calls"], f["speech_second_calls"]), (1, 0))

    def test_line_reports_passes_apart(self):
        rows = [{"speech_calls": [{"pass": "first", "status": "ok", "detected_language": "tamil", "segments": [SEG]},
                                  {"pass": "second", "status": "ok", "detected_language": "tamil", "segments": [SEG]}],
                 "speech_second_calls": 1},
                {"speech_calls": [{"pass": "first", "status": "ok", "detected_language": "english", "segments": []}],
                 "speech_second_calls": 0}]
        line = run.speech_line(rows)
        self.assertIn("first pass 2, second pass 1 (on 1 clips), failed 0", line)
        self.assertIn("Segments with signals recorded: 2", line)

    def test_no_line_without_speech(self):
        self.assertEqual(run.speech_line([{"id": "typed"}]), "")


class NormalizedScores(unittest.TestCase):
    def test_tamil_and_english_name(self):
        case = {"people": ["Suresh"]}
        ref, hyp = "சுரேஷ் பெட்ரோலுக்கு 500", "Suresh பெட்ரோலுக்கு 500"
        self.assertAlmostEqual(run.wer(ref, hyp), 1 / 3)
        self.assertEqual(run.wer_normalized(ref, hyp, case), 0)
        self.assertGreater(run.cer(ref, hyp), 0)
        self.assertEqual(run.cer_normalized(ref, hyp, case), 0)

    def test_hindi_and_english_name(self):
        case = {"owed": {"You": 1, "Neha": 1}}
        ref, hyp = "नेहा के साथ", "Neha के साथ"
        self.assertAlmostEqual(run.wer(ref, hyp), 1 / 3)
        self.assertEqual(run.wer_normalized(ref, hyp, case), 0)

    def test_per_item_spelling_counts(self):
        self.assertEqual(run.wer_normalized("அர்விந்த் 500", "Arvind 500", {"people": ["Arvind"], "name_forms": {"Arvind": ["அர்விந்த்"]}}), 0)

    def test_other_words_still_count(self):
        self.assertAlmostEqual(run.wer_normalized("नेहा 800", "Neha 100", {"people": ["Neha"]}), 0.5)

    def test_different_names_not_merged(self):
        case = {"people": ["Priya", "Priyanka"]}
        self.assertEqual(run.wer_normalized("Priya paid", "Priyanka paid", case), 0.5)
        self.assertEqual(run.wer_normalized("प्रिया paid", "प्रियंका paid", case), 0.5)

    def test_names_outside_the_item_are_left_alone(self):
        self.assertAlmostEqual(run.wer_normalized("नेहा 800", "Neha 800", {"people": ["Rohit"]}), 0.5)

    def test_uncertain_transliteration_is_not_normalized(self):
        case = {"people": ["Suresh"]}
        self.assertAlmostEqual(run.wer_normalized("Suresh 500", "சுரேஷுக்கு 500", case), 0.5)  # inflected: stays a difference
        self.assertEqual(run.name_match_detail("Suresh", "சுரேஷுக்கு 500"), ("uncertain", "possible inflected form"))
        self.assertEqual(run.name_match_detail("Rohit", "ரோஹித் கூட"), ("uncertain", "no Tamil spelling listed"))
        self.assertEqual(run.name_match_detail("Priya", "Priyanka"), ("no", None))
        self.assertEqual(run.name_match_detail("Amit", "अमित"), ("yes", None))

    def test_uncertain_expected_name_reported(self):
        case = {"owed": {"You": 3000, "Ravi": 3000}, "payer": "Ravi"}
        self.assertEqual(run.names_heard_uncertain(case, "रविवार ने दिए"), {"Ravi": "possible inflected form"})
        self.assertEqual(run.names_heard_uncertain(case, "रवि ने दिए"), {})


class ConfirmedAndUncertain(unittest.TestCase):
    def test_confirmed_errors(self):
        row = run.classify_errors({"id": "a", "diagnosis": {"payer_error": "assumed You", "friend_added": ["Neha"]},
                                   "inserted_in_transcript": ["Neha"]})
        self.assertEqual(set(row["errors_confirmed"]), {"payer_error", "friend_added", "friend_in_transcript_not_said"})
        self.assertEqual(row["errors_uncertain"], {})

    def test_uncertain_never_confirmed(self):
        row = run.classify_errors({"id": "a", "lang": "hinglish", "diagnosis": {"friend_uncertain": ["Rohit"]},
                                   "name_check_uncertain": ["Rohit"], "names_heard_uncertain": {"Ravi": "possible inflected form"},
                                   "script": run.SCRIPT_SWITCHED})
        self.assertEqual(row["errors_confirmed"], {})
        self.assertEqual(set(row["errors_uncertain"]), {"friend_in_expense_uncertain", "friend_in_transcript_uncertain",
                                                        "expected_name_uncertain", "script_mismatch_not_comparable"})

    def test_wrong_amount_confirmed_but_cause_uncertain(self):
        row = run.classify_errors({"id": "a", "diagnosis": {"amount_error": "from number words"}})
        self.assertIn("amount_wrong", row["errors_confirmed"])
        self.assertIn("amount_error_cause", row["errors_uncertain"])

    def test_known_amount_causes_are_confirmed(self):
        read = run.classify_errors({"id": "a", "diagnosis": {"amount_error": "read wrong (amount was in the text)"}})
        heard = run.classify_errors({"id": "b", "diagnosis": {"amount_error": "heard wrong (amount missing from the text)"}})
        self.assertIn("amount_read_wrong", read["errors_confirmed"])
        self.assertIn("amount_heard_wrong", heard["errors_confirmed"])
        self.assertEqual((read["errors_uncertain"], heard["errors_uncertain"]), ({}, {}))

    def test_possible_translation_is_uncertain(self):
        row = run.classify_errors({"id": "a", "lang": "tamil", "script": run.SCRIPT_TRANSLATED})
        self.assertIn("possibly_translated", row["errors_uncertain"])
        self.assertEqual(row["errors_confirmed"], {})

    def test_sections_are_separate(self):
        rows = [run.classify_errors({"id": "syn/a.wav", "diagnosis": {"payer_error": "assumed You"}}),
                run.classify_errors({"id": "syn/b.wav", "name_check_uncertain": ["Rohit"]})]
        text = "\n".join(run.error_sections(rows))
        self.assertIn("Items with confirmed errors: 1. Items with only uncertain results: 1.", text)
        confirmed, uncertain = text.split("**Uncertain results")
        self.assertIn("payer error", confirmed)
        self.assertNotIn("Rohit", confirmed)
        self.assertIn("Rohit", uncertain)
        self.assertNotIn("payer error", uncertain)


def _answer(total, payer, name):
    return json.dumps({"description": "X", "total": total, "payer": payer, "participants": ["me", name],
                       "mode": "equal", "values": {}, "items": [], "missing": []})


def _run_audio(cases, speech, chat):
    """run_audio with the app's real code, fake clients and a temporary dataset."""
    clips = [{"file": f"synthetic/{c['id']}.wav", "case": c["id"], "kind": "synthetic", "reference": c["text"]} for c in cases]
    client = _fake_groq(speech, chat)
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "audio" / "synthetic").mkdir(parents=True)
        (root / "text.json").write_text(json.dumps(cases, ensure_ascii=False), encoding="utf-8")
        (root / "audio" / "synthetic.json").write_text(json.dumps(clips, ensure_ascii=False), encoding="utf-8")
        for c in clips:
            (root / "audio" / c["file"]).write_bytes(b"audio")
        with mock.patch.object(run, "HERE", root), mock.patch.object(reader, "_client", lambda *a, **k: client), \
             contextlib.redirect_stdout(io.StringIO()):
            run.track_models(reader)
            return run.run_audio(reader, splits, argparse.Namespace(limit=0, sleep=0, set="synthetic"))


class AudioRunEndToEnd(unittest.TestCase):
    """run_audio with the app's real code, fake clients and a temporary dataset."""

    def run_clips(self):
        cases = [{"id": "c-hinglish", "lang": "hinglish", "categories": ["payer"], "people": ["Rahul"], "payer": "Rahul",
                  "text": "Rahul ne petrol ke 2000 diye", "owed": {"You": 1000, "Rahul": 1000}},
                 {"id": "c-tamil", "lang": "tamil", "categories": ["script"], "people": ["Suresh"], "payer": "Suresh",
                  "text": "சுரேஷ் 500 கொடுத்தான்", "owed": {"You": 250, "Suresh": 250}}]
        speech = [_whisper("राहुल ने पेट्रोल के 2000 दिए", "hindi", [SEG]), _whisper("Suresh 500 கொடுத்தான்", "tamil", [SEG])]
        chat = [_answer(2000, "Rahul", "Rahul"), _answer(500, "Suresh", "Suresh")]
        return _run_audio(cases, speech, chat)

    def test_hinglish_script_mismatch_is_not_comparable(self):
        rows = self.run_clips()
        self.assertIs(rows[0]["wer_comparable"], False)
        self.assertIn("script mismatch", rows[0]["not_comparable_reason"])
        self.assertIn("script_mismatch_not_comparable", rows[0]["errors_uncertain"])
        self.assertEqual(rows[0]["errors_confirmed"], {})

    def test_comparable_average_leaves_mismatch_out(self):
        rows = self.run_clips()
        self.assertEqual([r["id"] for r in run.comparable(rows)], ["synthetic/c-tamil.wav"])
        self.assertEqual(run.mean(run.comparable(rows), "wer_normalized"), "0.000 (n=1)")
        self.assertIn("n=2", run.mean(rows, "wer"))  # raw all-clips figure is still kept

    def test_raw_and_normalized_stored_separately(self):
        tamil = self.run_clips()[1]
        self.assertAlmostEqual(tamil["wer"], 0.333)
        self.assertEqual(tamil["wer_normalized"], 0)
        self.assertGreater(tamil["cer"], tamil["cer_normalized"])
        self.assertIs(tamil["wer_comparable"], True)

    def test_summary_reports_each_part(self):
        text = run.summary(self.run_clips(), "t")
        for expected in ("first pass 2, second pass 0", "Raw WER, all clips", "Raw WER, comparable clips",
                         "Name-normalized WER, comparable clips", "Not comparable (script mismatch) | 1: c-hinglish.wav (hinglish)",
                         "Uncertain results (not counted as errors)"):
            self.assertIn(expected, text)

    def test_model_attribution_preserved(self):
        for row in self.run_clips():
            self.assertEqual(row["answered_by"], "primary")
            self.assertEqual(row["model"], reader.LLM_MODELS[0])
            self.assertEqual(row["models_tried"], [f"{reader.LLM_MODELS[0]}: ok"])
            self.assertEqual(row["speech_model"], reader.STT_MODEL)

    def test_segments_reach_the_saved_row(self):
        self.assertEqual(self.run_clips()[0]["speech_calls"][0]["segments"], [SEG])


class ScriptExclusionRule(unittest.TestCase):
    """Only items labelled code-mixed are excluded; the same mismatch elsewhere is flagged and kept."""

    def test_eligible_code_mixed_items(self):
        for lang in ("hinglish", "tanglish", "Hinglish", " tanglish "):
            self.assertTrue(run.script_excluded(lang, run.SCRIPT_SWITCHED), lang)
            self.assertFalse(run.script_flagged(lang, run.SCRIPT_SWITCHED), lang)

    def test_ineligible_items_are_flagged_not_excluded(self):
        for lang in ("english", "indian-english", "tamil", "hindi", "", None):
            self.assertFalse(run.script_excluded(lang, run.SCRIPT_SWITCHED), lang)
            self.assertTrue(run.script_flagged(lang, run.SCRIPT_SWITCHED), lang)

    def test_code_mixed_without_a_switch_is_not_excluded(self):
        for script in ("ok", run.SCRIPT_TRANSLATED, None):
            self.assertFalse(run.script_excluded("hinglish", script), script)
            self.assertFalse(run.script_flagged("hinglish", script), script)

    def test_classification_keeps_the_two_apart(self):
        excluded = run.classify_errors({"id": "a", "lang": "tanglish", "script": run.SCRIPT_SWITCHED})
        flagged = run.classify_errors({"id": "b", "lang": "english", "script": run.SCRIPT_SWITCHED})
        self.assertEqual(list(excluded["errors_uncertain"]), ["script_mismatch_not_comparable"])
        self.assertEqual(list(flagged["errors_uncertain"]), ["script_mismatch_flagged_for_inspection"])
        self.assertEqual((excluded["errors_confirmed"], flagged["errors_confirmed"]), ({}, {}))

    def mixed_run(self):
        cases = [{"id": "c-english", "lang": "english", "people": ["Ravi"], "payer": "You",
                  "text": "I paid 500 with Ravi", "owed": {"You": 250, "Ravi": 250}},
                 {"id": "c-tanglish", "lang": "tanglish", "people": ["Ravi"], "payer": "You",
                  "text": "Naan 500 kuduthen Ravi kooda", "owed": {"You": 250, "Ravi": 250}},
                 {"id": "c-hinglish", "lang": "hinglish", "people": ["Ravi"], "payer": "You",
                  "text": "Maine 500 diye Ravi ke saath", "owed": {"You": 250, "Ravi": 250}}]
        speech = [_whisper("मैंने 500 Ravi के साथ", "hindi", [SEG]), _whisper("நான் 500 Ravi கூட", "tamil", [SEG]),
                  _whisper("Maine 500 diye Ravi ke saath", "english", [SEG])]
        return _run_audio(cases, speech, [_answer(500, "me", "Ravi")] * 3)

    def test_english_item_stays_in_the_averages_and_is_flagged(self):
        row = self.mixed_run()[0]
        self.assertIs(row["wer_comparable"], True)
        self.assertIn("isn't labelled code-mixed", row["script_flag"])
        self.assertNotIn("not_comparable_reason", row)
        self.assertIn("script_mismatch_flagged_for_inspection", row["errors_uncertain"])

    def test_code_mixed_item_is_excluded(self):
        row = self.mixed_run()[1]
        self.assertIs(row["wer_comparable"], False)
        self.assertIn("code-mixed item", row["not_comparable_reason"])
        self.assertNotIn("script_flag", row)

    def test_code_mixed_item_in_matching_script_is_kept(self):
        row = self.mixed_run()[2]
        self.assertEqual(row["script"], "ok")
        self.assertIs(row["wer_comparable"], True)
        self.assertNotIn("script_flag", row)

    def test_denominator_counts_scored_clips(self):
        rows = self.mixed_run()
        self.assertEqual(run.comparable_denominator(rows), "2 of 3 clips (1 excluded)")
        self.assertEqual(run.comparable_denominator(rows + [{"id": "x", "unscored": "no reference"}]), "2 of 3 clips (1 excluded)")

    def test_report_shows_exclusions_denominator_and_flags(self):
        text = run.summary(self.mixed_run(), "t")
        self.assertIn("| Comparable WER/CER denominator | 2 of 3 clips (1 excluded) |", text)
        self.assertIn("| Not comparable (script mismatch) | 1: c-tanglish.wav (tanglish) |", text)
        self.assertIn("| Script mismatch flagged for inspection, kept in the averages | 1: c-english.wav (english) |", text)

    def test_comparable_mean_uses_the_stated_denominator(self):
        rows = self.mixed_run()
        self.assertIn("n=2", run.mean(run.comparable(rows), "wer_normalized"))

    def test_raw_scores_are_kept_for_every_clip(self):
        rows = self.mixed_run()
        self.assertTrue(all("wer" in r and "cer" in r for r in rows))
        self.assertIn("n=3", run.mean(rows, "wer"))
        self.assertIn("n=3", run.mean(rows, "cer"))
        self.assertGreater(rows[1]["wer"], 0)  # the excluded clip still has its raw score

    def test_compare_prints_denominators_and_flags(self):
        rows = self.mixed_run()
        with tempfile.TemporaryDirectory() as tmp:
            for name in ("a", "b"):
                (Path(tmp) / f"{name}.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
            out = io.StringIO()
            with mock.patch.object(run, "RESULTS", Path(tmp)), contextlib.redirect_stdout(out):
                run.compare("a", "b")
        self.assertIn("| Comparable WER/CER denominator | 2 of 3 clips (1 excluded) | 2 of 3 clips (1 excluded) |", out.getvalue())
        self.assertIn("| Script mismatch flagged, kept in the averages | 1 | 1 |", out.getvalue())


if __name__ == "__main__":
    unittest.main()
