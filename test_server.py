"""Endpoint tests that need no AI calls."""
import re
import unittest
from pathlib import Path

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


class OneAmount(unittest.TestCase):
    """The report's test data through the real routes: one amount per person, everywhere."""
    EXPS = [{"description": d, "total": t, "payer": p, "participants": ["You", "Arun", "Meena"]}
            for d, t, p in (("Hotel", 3000, "You"), ("Lunch", 300, "You"), ("Cab", 600, "Arun"), ("Movie", 300, "Meena"))]

    def test_group_rows_are_direct_amounts(self):
        b = client.post("/api/balances", json={"expenses": self.EXPS}).json()
        rows = {(p["from"], p["to"]): p["amount"] for p in b["payments"]}
        self.assertEqual(rows, {("Arun", "You"): 900, ("Meena", "You"): 1000, ("Meena", "Arun"): 100})
        self.assertEqual(b["net"]["You"], 1900)  # the group card is the sum of my rows

    def test_group_matches_friends_and_explain(self):
        rows = {p["from"]: p["amount"] for p in client.post("/api/balances", json={"expenses": self.EXPS}).json()["payments"] if p["to"] == "You"}
        friends = client.post("/api/friends", json={"expenses": self.EXPS}).json()["friends"]
        self.assertEqual(rows, friends)
        for name in ("Arun", "Meena"):
            r = client.post("/api/explain", json={"expenses": self.EXPS, "person": name}).json()
            self.assertEqual(r["total"], friends[name], name)

    def test_bad_expense_is_still_a_clear_error(self):
        bad = {**self.EXPS[0], "mode": "exact", "values": {"You": 100}}
        self.assertEqual(client.post("/api/balances", json={"expenses": [bad]}).status_code, 400)


class RecordedPayments(unittest.TestCase):
    """The report's test data after Meena pays me ₹100, through the real routes."""
    EXPS = OneAmount.EXPS
    PAY = [{"from": "Meena", "to": "You", "amount": 10000}]

    def test_group_friends_explain_after_a_payment(self):
        b = client.post("/api/balances", json={"expenses": self.EXPS, "payments": self.PAY}).json()
        rows = {(p["from"], p["to"]): p["amount"] for p in b["payments"]}
        self.assertEqual(rows, {("Arun", "You"): 900, ("Meena", "You"): 900, ("Meena", "Arun"): 100})
        self.assertEqual(b["net"]["You"], 1800)
        friends = client.post("/api/friends", json={"expenses": self.EXPS, "payments": self.PAY}).json()["friends"]
        self.assertEqual(friends, {"Arun": 900, "Meena": 900})
        r = client.post("/api/explain", json={"expenses": self.EXPS, "payments": self.PAY, "person": "Meena"}).json()
        self.assertEqual(r["total"], 900)
        self.assertIn({"kind": "payment", "index": 0, "amount": -100}, r["lines"])
        self.assertEqual(sum(line["amount"] for line in r["lines"]), 900)

    def test_payments_are_not_spending(self):
        shares = client.post("/api/shares", json={"expenses": self.EXPS, "payments": self.PAY}).json()["shares"]
        self.assertEqual(len(shares), 4)
        self.assertEqual(sum(sh["You"] for sh in shares), 1400)

    def test_old_requests_without_payments_still_work(self):
        self.assertEqual(client.post("/api/friends", json={"expenses": self.EXPS}).json()["friends"], {"Arun": 900, "Meena": 1000})

    def test_bad_payments_are_refused(self):
        for bad in ({"from": "Meena", "to": "You", "amount": 0}, {"from": "Meena", "to": "You", "amount": -5},
                    {"from": "Meena", "to": "You", "amount": 33.5}, {"from": "Meena", "to": "You", "amount": "100"},
                    {"from": "Meena", "to": "meena", "amount": 100}, {"from": "", "to": "You", "amount": 100},
                    {"from": "Meena", "to": "You", "amount": 1_000_000_001}, {"from": "M" * 61, "to": "You", "amount": 100}):
            for url in ("/api/balances", "/api/friends", "/api/explain"):
                self.assertEqual(client.post(url, json={"expenses": self.EXPS, "payments": [bad]}).status_code, 422, (url, bad))
        many = [{"from": "Meena", "to": "You", "amount": 1}] * 3001
        self.assertEqual(client.post("/api/friends", json={"expenses": self.EXPS, "payments": many}).status_code, 422)

    def test_excel_has_payments_and_balances_include_them(self):
        from io import BytesIO
        from openpyxl import load_workbook
        body = {"title": "t", "rows": [{"date": "1", "group": "Test group", "expense": e} for e in self.EXPS],
                "payments": [{"date": "9", "group": "Test group", "payment": self.PAY[0]}]}
        wb = load_workbook(BytesIO(client.post("/api/export-xlsx", json=body).content))
        self.assertEqual([list(r) for r in wb["Payments"].iter_rows(min_row=2, values_only=True)], [["9", "Test group", "Meena", "You", 100]])
        summary = {r[0]: r[1] for r in wb["Summary"].iter_rows(values_only=True) if r and r[0] in ("Arun", "Meena")}
        self.assertEqual(summary, {"Arun": 900, "Meena": 900})
        self.assertEqual(wb["Expenses"].max_row, 5)  # four expenses and the header: the payment is not an expense


class OneWayToSave(unittest.TestCase):
    def test_only_the_save_button_adds_an_expense(self):
        js = (Path(__file__).parent / "public" / "static" / "app.js").read_text(encoding="utf-8")
        adds = [m.start() for m in re.finditer(r"\.expenses\.(?:unshift|push|concat)\(|\.expenses\s*=\s*\[", js)]
        self.assertEqual(len(adds), 1, "an expense must be added in exactly one place")
        handler = js.index('$("save").addEventListener("click"')
        self.assertTrue(handler < adds[0] < js.index("});", handler), "that place must be the Save handler")


if __name__ == "__main__":
    unittest.main()
