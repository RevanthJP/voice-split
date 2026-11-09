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
from splits import ME, Expense, Item, SplitError, balances, owed_shares, settle_up, splitwise_shares, with_person

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


def _card(expense, missing=(), transcript=None, known=(), data=None):
    """Everything the confirmation card needs. If the split can't be worked out, say why.
    "checks" are doubts about the AI's reading, compared with what was said, for the person to confirm."""
    out = {
        "expense": {"description": expense.description, "total": expense.total, "payer": expense.payer,
                    "participants": expense.participants, "mode": expense.mode, "values": expense.values,
                    "items": [i.__dict__ for i in expense.items]},
        "missing": list(missing),
        "transcript": transcript,
        "new_people": sorted({p for p in [expense.payer, *expense.participants] if p != ME and p not in known}),
        "owed": None, "splitwise": None, "problem": None,
        "checks": ai.review(expense, list(missing), transcript, known, data),
    }
    out["doubts"] = ai.doubtful_fields(out["checks"])
    if not missing:
        try:
            out["owed"] = {k: v / 100 for k, v in owed_shares(expense).items()}
            out["splitwise"] = splitwise_shares(expense)
        except SplitError as err:
            out["problem"] = str(err)
    return out


def _ai_error(err, step):
    """A plain message for a failed AI call. Only the error's type is logged, never keys or content."""
    name = type(err).__name__
    print(f"{step} failed:", name, flush=True)
    if name == "RateLimitError":
        return HTTPException(429, "Kitty's free AI limit is used up for the moment. Wait a minute and try again, or add it by hand.")
    if name in ("APITimeoutError", "TooSlow"):
        return HTTPException(504, "The AI took too long to answer. Try again, or add it by hand.")
    if name == "APIConnectionError":
        return HTTPException(502, "Kitty couldn't reach the AI. Check back in a moment, or add it by hand.")
    if step == "speech" and name in ("BadRequestError", "UnprocessableEntityError"):
        return HTTPException(400, "That recording couldn't be read. Please record it again, or type it.")
    return HTTPException(502, "The AI couldn't read that right now. Try again, or add it by hand.")


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
        data = ai.read_expense(text, body.people, ai.Deadline())
    except Exception as err:
        raise _ai_error(err, "read")
    expense, missing = ai.to_expense(data, body.people)
    return _card(expense, missing, text, body.people, data)


@app.post("/api/read-audio")
def read_audio(file: UploadFile = File(...), people: str = Form(""), language: str = Form("")):
    audio = file.file.read(MAX_AUDIO + 1)
    if len(audio) > MAX_AUDIO:
        raise HTTPException(413, "That recording is too long. Keep it under a minute.")
    if not audio:
        raise HTTPException(400, "No audio arrived. Please try again.")
    known = [p for p in people.split("|") if p][:200]
    _spend()
    deadline = ai.Deadline()
    try:
        text = ai.transcribe(audio, Path(file.filename or "clip.webm").name, language or None, known, deadline)
    except Exception as err:
        raise _ai_error(err, "speech")
    if not text:
        raise HTTPException(422, "We couldn't hear anything. Tap the mic and speak, or type it.")
    try:
        data = ai.read_expense(text, known, deadline)
    except Exception as err:
        raise _ai_error(err, "read")
    expense, missing = ai.to_expense(data, known)
    return _card(expense, missing, text, known, data)


class CheckIn(BaseModel):
    expense: ExpenseIn
    people: list[str] = []
    transcript: Optional[str] = Field(None, max_length=2000)


@app.post("/api/check")
def check(body: CheckIn):
    """Recalculate after the person edits the card. No AI call. With the transcript, the checks are
    run again on the edited expense, so a check clears once the person has fixed it."""
    e = body.expense
    missing = [m for m, bad in (("amount", not e.total), ("people", not e.participants)) if bad]
    return _card(_expense(e), missing, body.transcript, body.people)


class GroupIn(BaseModel):
    expenses: list[ExpenseIn] = Field(default_factory=list, max_length=500)


@app.post("/api/balances")
def group_balances(body: GroupIn):
    try:
        net = balances([_expense(e) for e in body.expenses])
    except SplitError as err:
        raise HTTPException(400, str(err))
    return {"net": {k: v / 100 for k, v in net.items()},
            "payments": [{"from": p["from"], "to": p["to"], "amount": p["paise"] / 100} for p in settle_up(net)]}


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
