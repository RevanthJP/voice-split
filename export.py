"""Excel export. Built in memory and returned straight away; nothing is stored."""
from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from splits import ME, owed_shares, to_paise, with_person

HEAD = Font(bold=True, color="FFFFFF")
HEAD_FILL = PatternFill("solid", fgColor="3B4CCA")
MONEY = '₹#,##0.00'


def _header(ws, cols):
    ws.append(cols)
    for cell in ws[ws.max_row]:
        cell.font, cell.fill = HEAD, HEAD_FILL
        cell.alignment = Alignment(vertical="center")
    ws.freeze_panes = "A2"


def _widths(ws, widths):
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w


def build_xlsx(rows, title):
    """rows: list of (date_text, group_name, Expense). Returns xlsx bytes."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Expenses"
    _header(ws, ["Date", "Group", "Expense", "Amount", "Paid by", "Split between", "Your share", "Shares"])
    total = mine = 0
    for date, group, e in rows:
        owed = owed_shares(e)
        amount = to_paise(e.total)
        total += amount
        mine += owed.get(ME, 0)
        shares = "; ".join(f"{p} ₹{v / 100:,.2f}" for p, v in owed.items() if v)
        ws.append([date, group, e.description, amount / 100, e.payer, ", ".join(e.participants), owed.get(ME, 0) / 100, shares])
    for r in range(2, ws.max_row + 1):
        ws.cell(r, 4).number_format = MONEY
        ws.cell(r, 7).number_format = MONEY
    _widths(ws, [12, 16, 24, 12, 12, 28, 12, 44])

    s = wb.create_sheet("Summary")
    s.append([title])
    s["A1"].font = Font(bold=True, size=14)
    s.append([])
    s.append(["Expenses", len(rows)])
    s.append(["Total spent by the group", total / 100])
    s.append(["Your share", mine / 100])
    for r in (4, 5):
        s.cell(r, 2).number_format = MONEY
    s.append([])
    _header(s, ["Friend", "Balance with you", "Meaning"])
    for person, paise in sorted(with_person([e for _, _, e in rows]).items()):
        if paise:
            s.append([person, paise / 100, "owes you" if paise > 0 else "you owe"])
            s.cell(s.max_row, 2).number_format = MONEY
    s.freeze_panes = None
    _widths(s, [28, 18, 12])

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()
