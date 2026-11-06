"""Split maths. The AI only reads who paid, how much and who shares; everything here is plain code.

All money is handled in paise (integers), so shares always add up to the exact total.
"""
from dataclasses import dataclass, field

ME = "You"


class SplitError(ValueError):
    """The expense can't be split as described. The message is shown to the person."""


def to_paise(amount):
    try:
        value = round(float(amount) * 100)
    except (TypeError, ValueError):
        raise SplitError("The amount is missing or not a number.")
    if value <= 0:
        raise SplitError("The amount must be more than zero.")
    return value


def _spread(total, weights):
    """Divide total paise in proportion to weights. Leftover paise go to the largest remainders,
    ties broken by position, so the result is exact and always the same for the same input."""
    weight_sum = sum(weights)
    if weight_sum <= 0:
        raise SplitError("Nobody is left to share this.")
    raw = [total * w / weight_sum for w in weights]
    parts = [int(r) for r in raw]
    order = sorted(range(len(weights)), key=lambda i: (-(raw[i] - parts[i]), i))
    for i in order[: total - sum(parts)]:
        parts[i] += 1
    return parts


@dataclass
class Item:
    """Part of the bill that only some people share, like drinks or someone's own shopping."""
    amount: float
    description: str = ""
    only: list = field(default_factory=list)
    excluded: list = field(default_factory=list)


@dataclass
class Expense:
    description: str
    total: float
    payer: str
    participants: list
    mode: str = "equal"  # equal | exact | shares | percent
    values: dict = field(default_factory=dict)
    items: list = field(default_factory=list)


def owed_shares(expense):
    """Return {name: paise owed}. Raises SplitError with a plain explanation if it can't add up."""
    total = to_paise(expense.total)
    people = list(dict.fromkeys(expense.participants))
    if not people:
        raise SplitError("Say who shares this expense.")
    # The payer need not be a participant: "I paid for Arun and Ravi" means only they owe.
    owed = {p: 0 for p in people}

    remaining = total
    for item in expense.items:
        amount = to_paise(item.amount)
        if item.only:
            sharers = [p for p in item.only]
        else:
            sharers = [p for p in people if p not in item.excluded]
        unknown = [p for p in sharers if p not in owed]
        for p in unknown:
            owed[p] = 0
        if not sharers:
            raise SplitError(f"Nobody is left to share {item.description or 'part of the bill'}.")
        for p, part in zip(sharers, _spread(amount, [1] * len(sharers))):
            owed[p] += part
        remaining -= amount
    if remaining < 0:
        raise SplitError("The separate items add up to more than the total.")

    mode = expense.mode
    if mode == "equal":
        parts = _spread(remaining, [1] * len(people))
    elif mode == "shares":
        weights = [float(expense.values.get(p, 0) or 0) for p in people]
        if any(w < 0 for w in weights):
            raise SplitError("Shares can't be negative.")
        parts = _spread(remaining, weights)
    elif mode == "percent":
        weights = [float(expense.values.get(p, 0) or 0) for p in people]
        if abs(sum(weights) - 100) > 0.01:
            raise SplitError(f"The percentages add up to {sum(weights):g}%, not 100%.")
        parts = _spread(remaining, weights)
    elif mode == "exact":
        parts = [to_paise(expense.values[p]) if expense.values.get(p) else 0 for p in people]
        if sum(parts) != remaining:
            raise SplitError(f"The amounts add up to ₹{sum(parts) / 100:g}, not ₹{remaining / 100:g}.")
    else:
        raise SplitError(f"Unknown split type: {mode}.")
    for p, part in zip(people, parts):
        owed[p] += part
    return owed


def splitwise_shares(expense):
    """The same result in Splitwise's create_expense format: paid_share and owed_share per person."""
    owed = owed_shares(expense)
    total = to_paise(expense.total)
    names = list(owed) + ([expense.payer] if expense.payer not in owed else [])
    rows = []
    for name in names:
        paid = total if name == expense.payer else 0
        rows.append({"name": name, "paid_share": f"{paid / 100:.2f}", "owed_share": f"{owed.get(name, 0) / 100:.2f}"})
    return rows


def balances(expenses):
    """Net paise per person across expenses: positive means they get money back."""
    net = {}
    for e in expenses:
        owed = owed_shares(e)
        total = to_paise(e.total)
        net[e.payer] = net.get(e.payer, 0) + total
        for p, amount in owed.items():
            net[p] = net.get(p, 0) - amount
    return net


def with_person(expenses, me=ME):
    """What each other person owes `me` directly (positive) or `me` owes them (negative), in paise.
    Only debts between `me` and that person count, the way a friends list shows balances."""
    out = {}
    for e in expenses:
        owed = owed_shares(e)
        if e.payer == me:
            for p, amount in owed.items():
                if p != me:
                    out[p] = out.get(p, 0) + amount
        elif owed.get(me):
            out[e.payer] = out.get(e.payer, 0) - owed[me]
    return out


def settle_up(net):
    """Fewest simple payments that clear the balances: largest debtor pays largest creditor."""
    debtors = sorted(((-v, p) for p, v in net.items() if v < 0), key=lambda x: (-x[0], x[1]))
    creditors = sorted(((v, p) for p, v in net.items() if v > 0), key=lambda x: (-x[0], x[1]))
    payments = []
    i = j = 0
    debtors = [list(d) for d in debtors]
    creditors = [list(c) for c in creditors]
    while i < len(debtors) and j < len(creditors):
        amount = min(debtors[i][0], creditors[j][0])
        payments.append({"from": debtors[i][1], "to": creditors[j][1], "paise": amount})
        debtors[i][0] -= amount
        creditors[j][0] -= amount
        if debtors[i][0] == 0:
            i += 1
        if creditors[j][0] == 0:
            j += 1
    return payments
