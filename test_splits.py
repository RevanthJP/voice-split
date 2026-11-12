"""Tests for the split maths. Run: python -m unittest -v"""
import random
import unittest

from splits import ME, Expense, Item, SplitError, balances, explain, owed_shares, pairwise, settle_up, splitwise_shares, with_person


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


class Explain(unittest.TestCase):
    """The listed expenses always add up to exactly the balance shown."""

    def check(self, exps):
        lines, total = explain(exps)
        self.assertEqual(sum(p for _, p in lines), total)
        self.assertEqual(total, balances(exps).get(ME, 0))
        friends = with_person(exps)
        for name in {p for e in exps for p in [e.payer, *e.participants]} - {ME}:
            lines, total = explain(exps, ME, name)
            self.assertEqual(sum(p for _, p in lines), total)
            self.assertEqual(total, friends.get(name, 0), name)
            self.assertTrue(all(p for _, p in lines))  # an expense that doesn't move the balance isn't listed

    def test_uneven_split_rounding(self):
        exps = [Expense("Dinner", 100, ME, [ME, "Arun", "Ravi"]),  # 33.34 / 33.33 / 33.33
                Expense("Cab", 100, "Arun", [ME, "Arun", "Ravi"])]
        self.assertEqual(explain(exps, ME, "Arun"), ([(0, 3333), (1, -3334)], -1))  # one paisa, not lost to rounding
        self.assertEqual(explain(exps), ([(0, 6666), (1, -3334)], 3332))
        self.check(exps)

    def test_uneven_percent_and_items(self):
        exps = [Expense("Rent", 1000, ME, [ME, "Arun", "Ravi"], mode="percent", values={ME: 33.3, "Arun": 33.3, "Ravi": 33.4}),
                Expense("Bill", 1000.01, "Ravi", [ME, "Arun", "Ravi"], items=[Item(100, "drinks", excluded=["Arun"])])]
        self.check(exps)

    def test_settled_up(self):
        exps = [Expense("Lunch", 600, ME, [ME, "Arun"]), Expense("Movie", 600, "Arun", [ME, "Arun"])]
        self.assertEqual(explain(exps, ME, "Arun"), ([(0, 30000), (1, -30000)], 0))
        self.assertEqual(explain(exps), ([(0, 30000), (1, -30000)], 0))
        self.check(exps)

    def test_only_expenses_that_move_the_balance(self):
        exps = [Expense("Snacks", 200, "Arun", ["Arun", "Ravi"]),  # doesn't involve me
                Expense("Tickets", 500, ME, ["Arun", "Ravi"]),     # I paid but don't share
                Expense("Own", 300, ME, [ME])]                       # only me: nothing to settle
        self.assertEqual(explain(exps, ME, "Arun"), ([(1, 25000)], 25000))
        self.assertEqual(explain(exps), ([(1, 50000)], 50000))
        self.check(exps)

    def test_random_groups_always_add_up(self):
        rng = random.Random(11)
        people = [ME, "Arun", "Ravi", "Kavya", "Meena"]
        for _ in range(300):
            exps = []
            for _ in range(rng.randint(1, 8)):
                group = rng.sample(people, rng.randint(1, 5))
                mode = rng.choice(["equal", "equal", "shares", "percent"])
                values = {}
                if mode == "shares":
                    values = {p: rng.randint(1, 4) for p in group}
                elif mode == "percent":
                    cuts = sorted(rng.sample(range(1, 100), len(group) - 1))
                    values = {p: b - a for p, a, b in zip(group, [0, *cuts], [*cuts, 100])}
                exps.append(Expense("x", rng.randint(1, 500000) / 100, rng.choice(people), group, mode, values))
            self.check(exps)


# ---------- one amount per person ----------
# An independent check of direct amounts: a plain loop over expenses where every sharer owes the payer
# their share, then each pair is netted. Only the per-expense shares come from owed_shares (tested above);
# it does not use part(), with_person, explain or pairwise.
def oracle_pairs(expenses):
    owes = {}  # (debtor, creditor) -> paise
    for e in expenses:
        for person, share in owed_shares(e).items():
            if person != e.payer and share:
                owes[(person, e.payer)] = owes.get((person, e.payer), 0) + share
    rows = {}
    for (a, b), v in owes.items():
        net = v - owes.get((b, a), 0)
        if net > 0:
            rows[(a, b)] = net
    return rows


def as_rows(expenses):
    return {(r["from"], r["to"]): r["paise"] for r in pairwise(expenses)}


def my_row(rows, friend):
    """Positive: friend pays me. Negative: I pay friend."""
    return rows.get((friend, ME), 0) - rows.get((ME, friend), 0)


def involves(e, friend):
    owed = owed_shares(e)
    return (e.payer == ME and owed.get(friend, 0) > 0) or (e.payer == friend and owed.get(ME, 0) > 0)


def random_setup(rng):
    friends = ["Arun", "Meena", "Ravi", "Kavya", "Priya"]
    groups = []
    for g in range(rng.randint(2, 3)):
        members = [ME, *rng.sample(friends[1:], rng.randint(1, 3))]
        if g < 2:
            members.append("Arun")  # Arun is in at least two groups
        groups.append(list(dict.fromkeys(members)))
    expenses = []
    for gi, members in enumerate(groups):
        for _ in range(rng.randint(1, 6)):
            total = rng.randint(100, 500000) / 100
            sharers = rng.sample(members, rng.randint(1, len(members)))
            mode = rng.choice(["equal", "equal", "shares", "percent"])
            values = {}
            if mode == "shares":
                values = {p: rng.randint(1, 4) for p in sharers}
            elif mode == "percent":
                cuts = sorted(rng.sample(range(1, 100), len(sharers) - 1))
                values = {p: b - a for p, a, b in zip(sharers, [0, *cuts], [*cuts, 100])}
            items = []
            if rng.random() < 0.3 and len(members) > 1:
                amount = round(total * rng.uniform(0.05, 0.5), 2)
                if amount > 0:
                    if rng.random() < 0.5:
                        items.append(Item(amount, "drinks", only=rng.sample(members, rng.randint(1, len(members)))))
                    elif len(sharers) > 1:
                        items.append(Item(amount, "drinks", excluded=rng.sample(sharers, len(sharers) - 1)))
            expenses.append((gi, Expense("x", total, rng.choice(members), sharers, mode, values, items)))
    return groups, expenses


class OneAmount(unittest.TestCase):
    def test_test_data_from_the_report(self):
        people = [ME, "Arun", "Meena"]
        exps = [Expense("Hotel", 3000, ME, people), Expense("Lunch", 300, ME, people),
                Expense("Cab", 600, "Arun", people), Expense("Movie", 300, "Meena", people)]
        self.assertEqual(as_rows(exps), {("Meena", ME): 100000, ("Arun", ME): 90000, ("Meena", "Arun"): 10000})
        self.assertEqual(as_rows(exps), oracle_pairs(exps))

    def test_zero_pairs_are_left_out(self):
        exps = [Expense("Lunch", 600, ME, [ME, "Arun"]), Expense("Movie", 600, "Arun", [ME, "Arun"])]
        self.assertEqual(pairwise(exps), [])

    def test_rules_hold_for_random_groups(self):
        rng = random.Random(2026)
        checked_two_groups = 0
        for _ in range(300):
            groups, tagged = random_setup(rng)
            everything = [e for _, e in tagged]
            friends = with_person(everything)
            per_group = [[e for gi, e in tagged if gi == g] for g in range(len(groups))]
            rows_by_group = [as_rows(exps) for exps in per_group]
            for g, exps in enumerate(per_group):
                rows = rows_by_group[g]
                # pairwise matches the independent oracle, every pair, including pairs without me
                self.assertEqual(rows, oracle_pairs(exps))
                self.assertTrue(all(v > 0 for v in rows.values()))
                net = balances(exps)
                # each person's rows add up to their group net
                for person in set(net) | {q for pair in rows for q in pair}:
                    got = sum(v for (a, b), v in rows.items() if b == person) - sum(v for (a, b), v in rows.items() if a == person)
                    self.assertEqual(got, net.get(person, 0), person)
                # rule 4: the group card equals the sum of my rows
                self.assertEqual(sum(my_row(rows, f) for f in {q for pair in rows for q in pair} - {ME}), net.get(ME, 0))
                for friend in {p for members in groups for p in members} - {ME}:
                    row = my_row(rows, friend)
                    # rule 3: the explain sheet for this friend in this group totals the row
                    self.assertEqual(explain(exps, ME, friend)[1], row)
                    # rule 1: all of our expenses in this group means the same amount as Friends
                    if all(gi == g for gi, e in tagged if involves(e, friend)):
                        self.assertEqual(row, friends.get(friend, 0), friend)
            for friend in {p for members in groups for p in members} - {ME}:
                rows_here = [my_row(rows, friend) for rows in rows_by_group]
                # rule 2: a Friends row is the sum of that friend's direct amounts across groups
                self.assertEqual(friends.get(friend, 0), sum(rows_here))
                self.assertEqual(explain(everything, ME, friend)[1], friends.get(friend, 0))
                oracle_total = sum(my_row(oracle_pairs(exps), friend) for exps in per_group)
                self.assertEqual(friends.get(friend, 0), oracle_total)
                # ...and differs from one group's row only when there are shared expenses elsewhere
                for g, row in enumerate(rows_here):
                    if row != friends.get(friend, 0):
                        self.assertTrue(any(gi != g and involves(e, friend) for gi, e in tagged), friend)
            if sum(1 for rows in rows_by_group if my_row(rows, "Arun")) >= 2:
                checked_two_groups += 1
        self.assertGreater(checked_two_groups, 50)  # Arun really had amounts in two groups, many times


if __name__ == "__main__":
    unittest.main()
