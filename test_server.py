"""Endpoint tests that need no AI calls."""
import unittest

from fastapi.testclient import TestClient

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

    def test_explain_total_matches_friends_and_balances(self):
        uneven = {"description": "Pizza", "total": 100, "payer": "Ravi", "participants": ["You", "Arun", "Ravi"]}
        exps = [DINNER, CAB, uneven]
        friends = client.post("/api/friends", json={"expenses": exps}).json()["friends"]
        for name in ("Arun", "Ravi"):
            r = client.post("/api/explain", json={"expenses": exps, "person": name}).json()
            self.assertEqual(r["total"], friends[name], name)
            self.assertAlmostEqual(sum(line["amount"] for line in r["lines"]), r["total"], places=9)
        mine = client.post("/api/balances", json={"expenses": exps}).json()["net"]["You"]
        self.assertEqual(client.post("/api/explain", json={"expenses": exps}).json()["total"], mine)

    def test_explain_settled_up_and_bad_expense(self):
        lunch = {"description": "Lunch", "total": 600, "payer": "You", "participants": ["You", "Arun"]}
        movie = {"description": "Movie", "total": 600, "payer": "Arun", "participants": ["You", "Arun"]}
        r = client.post("/api/explain", json={"expenses": [lunch, movie], "person": "Arun"}).json()
        self.assertEqual(r, {"total": 0, "lines": [{"index": 0, "amount": 300}, {"index": 1, "amount": -300}]})
        self.assertNotIn("Arun", client.post("/api/friends", json={"expenses": [lunch, movie]}).json()["friends"])
        bad = {**CAB, "mode": "exact", "values": {"You": 100}}
        for url in ("/api/explain", "/api/friends"):
            self.assertEqual(client.post(url, json={"expenses": [CAB, bad]}).status_code, 400, url)

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


if __name__ == "__main__":
    unittest.main()
