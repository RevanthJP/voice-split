"""Tests for the split maths. Run: python -m unittest -v"""
import random
import unittest

from splits import ME, Expense, Item, SplitError, balances, owed_shares, settle_up, splitwise_shares, with_person


def rupees(owed):
    return {k: v / 100 for k, v in owed.items()}


class Equal(unittest.TestCase):
    def test_three_way(self):
        e = Expense("Petrol", 1200, ME, [ME, "Arun", "Ravi"])
        self.assertEqual(rupees(owed_shares(e)), {ME: 400, "Arun": 400, "Ravi": 400})

    def test_uneven_total_adds_up_exactly(self):
        e = Expense("Dinner", 1000, ME, [ME, "Arun", "Ravi"])
        owed = owed_shares(e)
        self.assertEqual(sum(owed.values()), 100000)
        self.assertEqual(sorted(owed.values()), [33333, 33333, 33334])

    def test_payer_not_sharing(self):
        e = Expense("Tickets", 500, ME, ["Arun", "Ravi"])
        self.assertEqual(rupees(owed_shares(e)), {"Arun": 250, "Ravi": 250})

    def test_paise_amount(self):
        e = Expense("Chai", 100.5, ME, [ME, "Arun"])
        self.assertEqual(sum(owed_shares(e).values()), 10050)

    def test_duplicate_names_counted_once(self):
        e = Expense("Auto", 300, ME, [ME, "Arun", "Arun"])
        self.assertEqual(rupees(owed_shares(e)), {ME: 150, "Arun": 150})


class Items(unittest.TestCase):
    def test_arun_skipped_drinks(self):
        # Dinner 1,500 incl. 300 drinks Arun didn't have: 1,200 three ways, 300 two ways.
        e = Expense("Dinner", 1500, ME, [ME, "Arun", "Ravi"],
                    items=[Item(300, "drinks", excluded=["Arun"])])
        self.assertEqual(rupees(owed_shares(e)), {ME: 550, "Arun": 400, "Ravi": 550})

    def test_own_shopping(self):
        # Ravi paid 2,000 but 500 was his own shopping.
        e = Expense("Groceries", 2000, "Ravi", [ME, "Arun", "Ravi"],
                    items=[Item(500, "own shopping", only=["Ravi"])])
        self.assertEqual(rupees(owed_shares(e)), {ME: 500, "Arun": 500, "Ravi": 1000})

    def test_items_more_than_total(self):
        e = Expense("Dinner", 200, ME, [ME, "Arun"], items=[Item(300, "drinks", only=["Arun"])])
        with self.assertRaises(SplitError):
            owed_shares(e)

    def test_everyone_excluded(self):
        e = Expense("Dinner", 500, ME, [ME, "Arun"], items=[Item(100, "x", excluded=[ME, "Arun"])])
        with self.assertRaises(SplitError):
            owed_shares(e)


class OtherModes(unittest.TestCase):
    def test_couple_as_two_shares(self):
        e = Expense("Hotel", 6000, ME, [ME, "Arun"], mode="shares", values={ME: 2, "Arun": 1})
        self.assertEqual(rupees(owed_shares(e)), {ME: 4000, "Arun": 2000})

    def test_percent(self):
        e = Expense("Rent", 20000, ME, [ME, "Arun"], mode="percent", values={ME: 60, "Arun": 40})
        self.assertEqual(rupees(owed_shares(e)), {ME: 12000, "Arun": 8000})

    def test_percent_must_be_100(self):
        e = Expense("Rent", 20000, ME, [ME, "Arun"], mode="percent", values={ME: 60, "Arun": 30})
        with self.assertRaises(SplitError):
            owed_shares(e)

    def test_exact(self):
        e = Expense("Shopping", 900, ME, [ME, "Arun"], mode="exact", values={ME: 600, "Arun": 300})
        self.assertEqual(rupees(owed_shares(e)), {ME: 600, "Arun": 300})

    def test_exact_must_add_up(self):
        e = Expense("Shopping", 900, ME, [ME, "Arun"], mode="exact", values={ME: 600, "Arun": 200})
        with self.assertRaises(SplitError):
            owed_shares(e)

    def test_bad_amounts(self):
        for bad in (0, -5, None, "abc"):
            with self.assertRaises(SplitError):
                owed_shares(Expense("x", bad, ME, [ME, "Arun"]))


class SplitwiseFormat(unittest.TestCase):
    def test_paid_and_owed(self):
        rows = splitwise_shares(Expense("Petrol", 1200, ME, [ME, "Arun", "Ravi"]))
        self.assertEqual(rows[0], {"name": ME, "paid_share": "1200.00", "owed_share": "400.00"})
        self.assertEqual(sum(float(r["paid_share"]) for r in rows), 1200)
        self.assertEqual(sum(float(r["owed_share"]) for r in rows), 1200)

    def test_payer_not_sharing_still_listed(self):
        rows = splitwise_shares(Expense("Tickets", 500, ME, ["Arun", "Ravi"]))
        self.assertIn({"name": ME, "paid_share": "500.00", "owed_share": "0.00"}, rows)


class SettleUp(unittest.TestCase):
    def test_simple(self):
        net = balances([Expense("Petrol", 1200, ME, [ME, "Arun", "Ravi"])])
        self.assertEqual(net, {ME: 80000, "Arun": -40000, "Ravi": -40000})
        pays = settle_up(net)
        self.assertEqual(len(pays), 2)
        self.assertTrue(all(p["to"] == ME and p["paise"] == 40000 for p in pays))

    def test_debts_cancel(self):
        net = balances([Expense("A", 600, ME, [ME, "Arun"]), Expense("B", 600, "Arun", [ME, "Arun"])])
        self.assertEqual(settle_up(net), [])

    def test_random_trips_always_clear(self):
        rng = random.Random(7)
        people = [ME, "Arun", "Ravi", "Prathi", "Kavya"]
        for _ in range(300):
            expenses = []
            for _ in range(rng.randint(1, 8)):
                group = rng.sample(people, rng.randint(1, 5))
                expenses.append(Expense("x", rng.randint(1, 500000) / 100, rng.choice(people), group))
            net = balances(expenses)
            self.assertEqual(sum(net.values()), 0)
            pays = settle_up(net)
            after = dict(net)
            for p in pays:
                self.assertGreater(p["paise"], 0)
                after[p["from"]] += p["paise"]
                after[p["to"]] -= p["paise"]
            self.assertTrue(all(v == 0 for v in after.values()))
            self.assertLessEqual(len(pays), max(0, sum(1 for v in net.values() if v) - 1))


class Friends(unittest.TestCase):
    def test_direct_debts_only(self):
        expenses = [Expense("Dinner", 1500, ME, [ME, "Arun", "Ravi"], items=[Item(300, "drinks", excluded=["Arun"])]),
                    Expense("Cab", 1200, "Arun", [ME, "Arun"]),
                    Expense("Snacks", 200, "Arun", ["Arun", "Ravi"])]  # doesn't involve me
        self.assertEqual({k: v / 100 for k, v in with_person(expenses).items()}, {"Arun": -200, "Ravi": 550})

    def test_matches_my_net(self):
        rng = random.Random(3)
        people = [ME, "Arun", "Ravi", "Kavya"]
        for _ in range(200):
            exps = [Expense("x", rng.randint(1, 300000) / 100, rng.choice(people), rng.sample(people, rng.randint(1, 4)))
                    for _ in range(rng.randint(1, 6))]
            self.assertEqual(sum(with_person(exps).values()), balances(exps).get(ME, 0))


if __name__ == "__main__":
    unittest.main()
