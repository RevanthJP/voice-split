"""Web server: serves the page and four small endpoints. It stores nothing; the group lives on the phone."""
import time
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import reader as ai
from export import build_xlsx
from splits import ME, Expense, Item, SplitError, balances, explain, owed_shares, pairwise, splitwise_shares, with_person

DAILY_AI_CAP = 300  # protects the free Groq quota on a shared link
MAX_AUDIO = 4 * 1024 * 1024  # Vercel rejects bodies over 4.5 MB
PUBLIC = Path(__file__).parent / "public"
_usage = {"day": "", "count": 0}

app = FastAPI(title="Kitty", docs_url=None, redoc_url=None)


def _spend():
    today = time.strftime("%Y-%m-%d")
    if _usage["day"] != today:
        _usage.update(day=today, count=0)
    if _usage["count"] >= DAILY_AI_CAP:
        raise HTTPException(429, "The demo reached its daily limit. Please try again tomorrow, or add the expense by hand.")
    _usage["count"] += 1


class ItemIn(BaseModel):
    amount: float
    description: str = ""
    only: list[str] = []
    excluded: list[str] = []


class ExpenseIn(BaseModel):
    description: str = Field("Expense", max_length=60)
    total: Optional[float] = None
    payer: str = ME
    participants: list[str] = []
    mode: str = "equal"
    values: dict[str, float] = {}
    items: list[ItemIn] = []


def _expense(e: ExpenseIn):
    return Expense(e.description, e.total, e.payer, e.participants, e.mode, e.values,
                   [Item(i.amount, i.description, i.only, i.excluded) for i in e.items])


def _card(expense, missing=(), transcript=None, known=()):
    """Everything the confirmation card needs. If the split can't be worked out, say why."""
    out = {
        "expense": {"description": expense.description, "total": expense.total, "payer": expense.payer,
                    "participants": expense.participants, "mode": expense.mode, "values": expense.values,
                    "items": [i.__dict__ for i in expense.items]},
        "missing": list(missing),
        "transcript": transcript,
        "new_people": sorted({p for p in [expense.payer, *expense.participants] if p != ME and p not in known}),
        "owed": None, "splitwise": None, "problem": None,
    }
    if not missing:
        try:
            out["owed"] = {k: v / 100 for k, v in owed_shares(expense).items()}
            out["splitwise"] = splitwise_shares(expense)
        except SplitError as err:
            out["problem"] = str(err)
    return out


class TextIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    people: list[str] = []


@app.post("/api/read-text")
def read_text(body: TextIn):
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "Type or say an expense first.")
    _spend()
    try:
        data = ai.read_expense(text, body.people)
    except Exception as err:
        print("read failed:", type(err).__name__, flush=True)
        raise HTTPException(502, "The AI couldn't read that right now. Try again, or add it by hand.")
    expense, missing = ai.to_expense(data, body.people)
    return _card(expense, missing, text, body.people)


@app.post("/api/read-audio")
def read_audio(file: UploadFile = File(...), people: str = Form(""), language: str = Form("")):
    audio = file.file.read(MAX_AUDIO + 1)
    if len(audio) > MAX_AUDIO:
        raise HTTPException(413, "That recording is too long. Keep it under a minute.")
    if not audio:
        raise HTTPException(400, "No audio arrived. Please try again.")
    known = [p for p in people.split("|") if p]
    _spend()
    try:
        text = ai.transcribe(audio, Path(file.filename or "clip.webm").name, language or None)
    except Exception as err:
        print("speech failed:", type(err).__name__, flush=True)
        raise HTTPException(502, "We couldn't process that audio. Try again, or type it.")
    if not text:
        raise HTTPException(422, "We couldn't hear anything. Tap the mic and speak, or type it.")
    try:
        data = ai.read_expense(text, known)
    except Exception as err:
        print("read failed:", type(err).__name__, flush=True)
        raise HTTPException(502, "The AI couldn't read that right now. Try again, or type it.")
    expense, missing = ai.to_expense(data, known)
    return _card(expense, missing, text, known)


class CheckIn(BaseModel):
    expense: ExpenseIn
    people: list[str] = []


@app.post("/api/check")
def check(body: CheckIn):
    """Recalculate after the person edits the card. No AI call."""
    e = body.expense
    missing = [m for m, bad in (("amount", not e.total), ("people", not e.participants)) if bad]
    return _card(_expense(e), missing, None, body.people)


class GroupIn(BaseModel):
    expenses: list[ExpenseIn] = Field(default_factory=list, max_length=500)


@app.post("/api/balances")
def group_balances(body: GroupIn):
    try:
        expenses = [_expense(e) for e in body.expenses]
        net = balances(expenses)
        # Direct amounts between each pair of people, so a row shows what that person really owes.
        # settle_up() would reroute debts to save payments, and the amounts would then differ from Friends.
        rows = pairwise(expenses)
    except SplitError as err:
        raise HTTPException(400, str(err))
    return {"net": {k: v / 100 for k, v in net.items()},
            "payments": [{"from": p["from"], "to": p["to"], "amount": p["paise"] / 100} for p in rows]}


class AllIn(BaseModel):
    expenses: list[ExpenseIn] = Field(default_factory=list, max_length=3000)


@app.post("/api/friends")
def friends(body: AllIn):
    """Each person's balance with you across every group."""
    try:
        pairs = with_person([_expense(e) for e in body.expenses])
    except SplitError as err:
        raise HTTPException(400, str(err))
    return {"friends": {k: v / 100 for k, v in pairs.items() if v}}


class ExplainIn(BaseModel):
    expenses: list[ExpenseIn] = Field(default_factory=list, max_length=3000)
    person: Optional[str] = None  # a friend for their balance with you; empty for your balance in a group


@app.post("/api/explain")
def explain_balance(body: ExplainIn):
    """The expenses behind one balance, each signed (+ they owe you, - you owe them). The total is their sum,
    worked out by the same code as /api/friends and /api/balances, so it always matches what they show."""
    try:
        lines, total = explain([_expense(e) for e in body.expenses], ME, body.person or None)
    except SplitError as err:
        raise HTTPException(400, str(err))
    return {"total": total / 100, "lines": [{"index": i, "amount": paise / 100} for i, paise in lines]}


@app.post("/api/shares")
def shares(body: AllIn):
    """What each person owes for each expense, in the same order. Used for the charts."""
    try:
        return {"shares": [{k: v / 100 for k, v in owed_shares(_expense(e)).items()} for e in body.expenses]}
    except SplitError as err:
        raise HTTPException(400, str(err))


class ExportRow(BaseModel):
    date: str = Field("", max_length=20)
    group: str = Field("", max_length=60)
    expense: ExpenseIn


class ExportIn(BaseModel):
    title: str = Field("Kitty", max_length=80)
    rows: list[ExportRow] = Field(default_factory=list, max_length=3000)


@app.post("/api/export-xlsx")
def export_xlsx(body: ExportIn):
    try:
        data = build_xlsx([(r.date, r.group, _expense(r.expense)) for r in body.rows], body.title)
    except SplitError as err:
        raise HTTPException(400, str(err))
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": 'attachment; filename="kitty.xlsx"'})


@app.get("/manifest.webmanifest")
def manifest():
    return FileResponse(PUBLIC / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/sw.js")
def service_worker():
    return FileResponse(PUBLIC / "sw.js", media_type="text/javascript", headers={"Cache-Control": "no-cache"})


app.mount("/icons", StaticFiles(directory=PUBLIC / "icons", check_dir=False), name="icons")


@app.get("/")
def index():
    return FileResponse(PUBLIC / "index.html")


app.mount("/static", StaticFiles(directory=PUBLIC / "static", check_dir=False), name="static")
