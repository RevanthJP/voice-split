"""Measure how well the AI reads spoken-style expenses. Each case uses one Groq call.

Run: ./.venv/bin/python eval_reading.py [cases.json]
The AI's reading is scored on the final money: who paid and what each person owes, to the paise.
"""
import json
import sys
import time

import reader
from splits import ME, SplitError, owed_shares

cases = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "cases.json", encoding="utf-8"))
passed, rows = 0, []
for c in cases:
    data = reader.read_expense(c["text"], c.get("people", []))
    expense, missing = reader.to_expense(data, c.get("people", []))
    if "missing" in c:
        ok = c["missing"] in missing
        got = f"missing={missing}"
    else:
        try:
            owed = {k: v / 100 for k, v in owed_shares(expense).items()} if not missing else None
        except SplitError as err:
            owed = f"error: {err}"
        want = {k: float(v) for k, v in c["owed"].items()}
        got_owed = {k: v for k, v in (owed or {}).items() if v} if isinstance(owed, dict) else owed
        # Which person gets the leftover paisa is the app's choice, so allow one paisa either way.
        ok = (expense.payer == c.get("payer", ME) and isinstance(got_owed, dict) and got_owed.keys() == want.keys()
              and all(abs(got_owed[k] - want[k]) <= 0.011 for k in want))
        got = f"payer={expense.payer} owed={got_owed} missing={missing}"
    passed += ok
    rows.append({"id": c["id"], "lang": c["lang"], "ok": ok, "text": c["text"], "got": got, "ai": data})
    print(("PASS " if ok else "FAIL ") + c["id"], c["lang"], "|", c["text"][:70], "|", got, flush=True)
    time.sleep(1.5)

print(f"\n{passed}/{len(cases)} read correctly")
json.dump(rows, open("results_reading.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
