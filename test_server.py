"""Endpoint tests that need no AI calls."""
import unittest
from unittest import mock

import groq
import httpx
from fastapi.testclient import TestClient

import reader
from server import app

client = TestClient(app)
DINNER = {"description": "Dinner", "total": 1500, "payer": "You", "participants": ["You", "Arun", "Ravi"],
          "items": [{"amount": 300, "description": "drinks", "excluded": ["Arun"]}]}
CAB = {"description": "Cab", "total": 1200, "payer": "Arun", "participants": ["You", "Arun"]}


class Endpoints(unittest.TestCase):
    def test_shares_in_order(self):
        r = client.post("/api/shares", json={"expenses": [DINNER, CAB]}).json()["shares"]
        self.assertEqual(r[0], {"You": 550, "Arun": 400, "Ravi": 550})
        self.assertEqual(r[1], {"You": 600, "Arun": 600})

    def test_friends(self):
        r = client.post("/api/friends", json={"expenses": [DINNER, CAB]}).json()["friends"]
        self.assertEqual(r, {"Arun": -200, "Ravi": 550})

    def test_bad_expense_is_a_clear_error(self):
        r = client.post("/api/shares", json={"expenses": [{**CAB, "total": 0}]})
        self.assertEqual(r.status_code, 400)

    def test_excel(self):
        r = client.post("/api/export-xlsx", json={"title": "t", "rows": [{"date": "1", "group": "g", "expense": CAB}]})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.content.startswith(b"PK"))  # xlsx files are zip archives

    def test_page_and_app_files(self):
        for path in ("/", "/manifest.webmanifest", "/sw.js", "/icons/icon-192.png", "/static/app.js", "/static/style.css"):
            self.assertEqual(client.get(path).status_code, 200, path)


def _groq_error(cls, status):
    req = httpx.Request("POST", "https://example.invalid")
    return cls("x", response=httpx.Response(status, request=req), body=None)


class AiPaths(unittest.TestCase):
    """The AI is replaced by fakes: these check what the app does with its answers and failures."""
    answer = {"description": "Petrol", "total": 1500, "payer": "me", "participants": ["me", "Arun", "Meena"],
              "mode": "equal", "values": {}, "items": [], "missing": []}

    def test_text_returns_checks(self):
        with mock.patch.object(reader, "read_expense", return_value=self.answer):
            r = client.post("/api/read-text", json={"text": "I paid 1200 petrol with Arun", "people": ["Arun"]}).json()
        self.assertTrue(any("1,500 isn't a number" in c for c in r["checks"]))
        self.assertTrue(any("Meena wasn't in what was said" in c for c in r["checks"]))
        self.assertEqual(r["expense"]["total"], 1500)  # never changed, only flagged

    def test_amara_silence_gets_the_no_speech_message_without_a_reading_call(self):
        speech = mock.Mock()
        speech.audio.transcriptions.create.return_value = mock.Mock(
            text="Subtitles by the Amara.org community", language="english", segments=[])
        with mock.patch.object(reader, "_client", return_value=speech), \
             mock.patch.object(reader, "read_expense") as read:
            r = client.post("/api/read-audio", files={"file": ("a.webm", b"xx", "audio/webm")})
        self.assertEqual(r.status_code, 422)
        self.assertIn("couldn't hear anything", r.json()["detail"])
        read.assert_not_called()

    def test_check_clears_after_fix(self):
        fixed = {**self.answer, "total": 1200, "payer": "You", "participants": ["You", "Arun"]}
        r = client.post("/api/check", json={"expense": fixed, "people": ["Arun"],
                                            "transcript": "I paid 1200 petrol with Arun"}).json()
        self.assertEqual(r["checks"], [])

    def test_check_without_transcript_still_works(self):
        r = client.post("/api/check", json={"expense": CAB}).json()
        self.assertEqual(r["checks"], [])
        self.assertEqual(r["owed"], {"You": 600, "Arun": 600})

    def test_rate_limit_is_429_with_plain_message(self):
        with mock.patch.object(reader, "read_expense", side_effect=_groq_error(groq.RateLimitError, 429)):
            r = client.post("/api/read-text", json={"text": "petrol 500"})
        self.assertEqual(r.status_code, 429)
        self.assertIn("Wait a minute", r.json()["detail"])

    def test_timeout_is_504(self):
        with mock.patch.object(reader, "read_expense", side_effect=reader.TooSlow()):
            self.assertEqual(client.post("/api/read-text", json={"text": "petrol 500"}).status_code, 504)

    def test_bad_audio_is_400(self):
        with mock.patch.object(reader, "transcribe", side_effect=_groq_error(groq.BadRequestError, 400)):
            r = client.post("/api/read-audio", files={"file": ("a.webm", b"xx", "audio/webm")})
        self.assertEqual(r.status_code, 400)
        self.assertNotIn("Groq", r.json()["detail"])

    def test_audio_passes_names_and_deadline(self):
        with mock.patch.object(reader, "transcribe", return_value="I paid 1500 with Arun and Meena") as t, \
             mock.patch.object(reader, "read_expense", return_value=self.answer):
            r = client.post("/api/read-audio", files={"file": ("a.webm", b"xx", "audio/webm")}, data={"people": "Arun|Ravi"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(t.call_args.args[3], ["Arun", "Ravi"])
        self.assertIsInstance(t.call_args.args[4], reader.Deadline)


class ModelFallback(unittest.TestCase):
    def _fake_client(self, replies):
        calls = []

        def create(**kw):
            calls.append(kw["model"])
            reply = replies.pop(0)
            if isinstance(reply, Exception):
                raise reply
            return mock.Mock(choices=[mock.Mock(message=mock.Mock(content=reply))])
        client_ = mock.Mock()
        client_.chat.completions.create.side_effect = create
        return client_, calls

    def test_broken_json_tries_backup_model(self):
        c, calls = self._fake_client(["not json", '{"total": 500, "payer": "me"}'])
        with mock.patch.object(reader, "_client", return_value=c):
            self.assertEqual(reader.read_expense("petrol 500")["total"], 500)
        self.assertEqual(calls, reader.LLM_MODELS)

    def test_timeout_tries_backup_model(self):
        c, calls = self._fake_client([groq.APITimeoutError(request=httpx.Request("POST", "https://x.invalid")), '{"total": 9}'])
        with mock.patch.object(reader, "_client", return_value=c):
            self.assertEqual(reader.read_expense("x")["total"], 9)

    def test_wrong_shape_is_not_accepted(self):
        c, _ = self._fake_client(["[1, 2]", '{"hello": 1}'])
        with mock.patch.object(reader, "_client", return_value=c):
            with self.assertRaises(reader.BadAnswer):
                reader.read_expense("x")

    def test_no_time_left_no_call(self):
        c, calls = self._fake_client([])
        d = reader.Deadline(0)
        with mock.patch.object(reader, "_client", return_value=c):
            with self.assertRaises(reader.TooSlow):
                reader.read_expense("x", (), d)
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
