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


if __name__ == "__main__":
    unittest.main()
