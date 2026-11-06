"""Opens the exported Excel file and checks its numbers match the split maths."""
import unittest
from io import BytesIO

from openpyxl import load_workbook

from export import build_xlsx
from splits import ME, Expense, Item


class ExcelExport(unittest.TestCase):
    def setUp(self):
        rows = [("01 Oct", "Goa trip", Expense("Dinner", 1500, ME, [ME, "அருண்", "Ravi"], items=[Item(300, "drinks", excluded=["அருண்"])])),
                ("03 Oct", "Flat", Expense("Cab", 1200, "Ravi", [ME, "Ravi"]))]
        self.wb = load_workbook(BytesIO(build_xlsx(rows, "Voice Split: October")))

    def test_expense_rows(self):
        ws = self.wb["Expenses"]
        self.assertEqual(ws.max_row, 3)
        self.assertEqual([c.value for c in ws[2]][:5], ["01 Oct", "Goa trip", "Dinner", 1500, "You"])
        self.assertEqual(ws.cell(2, 7).value, 550)  # your share
        self.assertIn("அருண் ₹400.00", ws.cell(2, 8).value)  # Tamil names survive

    def test_summary_totals(self):
        s = self.wb["Summary"]
        values = {r[0].value: r[1].value for r in s.iter_rows() if r[0].value and len(r) > 1}
        self.assertEqual(values["Total spent by the group"], 2700)
        self.assertEqual(values["Your share"], 1150)
        self.assertEqual(values["அருண்"], 400)   # owes you
        self.assertEqual(values["Ravi"], -50)    # 550 owed to you minus 600 you owe

    def test_empty(self):
        wb = load_workbook(BytesIO(build_xlsx([], "Nothing")))
        self.assertEqual(wb["Expenses"].max_row, 1)


if __name__ == "__main__":
    unittest.main()
