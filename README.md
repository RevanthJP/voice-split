# Kitty

Say a shared expense the way you'd tell a friend, in Tamil, Hindi, English or a mix, and see who owes what.

> "Petrol-ku naan 1,200 kuduthen, Arun Ravi kooda split pannu" → You, Arun and Ravi owe ₹400 each.

A working prototype of voice input for splitting shared expenses with friends, built as a mobile web app that also installs on a phone.

## How it works

1. **Speech to text:** Whisper large-v3 on Groq. The language is detected automatically. If Tamil or Hindi speech comes back translated into English, it listens again in that language.
2. **Reading the expense:** one call to gpt-oss-20b on Groq returns structured JSON: who paid, the amount, who shares, and any parts only some people share ("Arun didn't have drinks, that was 300"). It turns Tamil and Hindi number words into digits (aayiram → 1000, dedh hazaar → 1500).
3. **The maths is plain code, not AI:** `splits.py` works in paise, so shares always add up to the exact total. It supports equal, exact, shares and percent splits, items only some people share, and direct balances between each pair of people.
4. **You confirm:** nothing is saved until you check the card. You can change the amount, the payer or who shares.
5. **Settle up:** Kitty shows who owes whom, person by person, so the amount you see is the amount you send. A group shows the same amount as the Friends tab for its expenses, with a WhatsApp reminder for each, including your UPI ID if you add one.
6. **Record a payment:** when someone pays you, or you pay them, record it from their row in a group or in Friends, and both screens go down by that amount. Payments are stored with their group and are never counted as spending. Version 1 cannot record payments between two other people, only payments you made or received.

**Screens:** Home (speak or type an expense, totals, recent expenses), Friends (each person's balance with you across all groups), Groups (separate groups such as a trip or a flat, each with its own settle-up), and Account (your details, Excel and PDF export by month or range, and features marked as coming soon). It can be installed from the browser as a phone app.

Everything is stored only on your phone. No sign-up. Password, sign-in and sync are shown as coming soon, not built.

## Testing

| Check | Result |
|---|---|
| Split maths (`python -m unittest`) | 35 tests pass, including random trips that always settle to zero, friend balances that match each person's total, and an Excel export opened and checked |
| Written expenses, development set (`cases.json`) | 24/24 read correctly after tuning, including a real Tamil recording's transcript. The first run got 20/22 |
| Written expenses, held-back set (`cases_heldout.json`) | 7/8. The first run got 5/8: one was an error in the test itself, and two led to fixes, so this set is no longer fully unseen |
| Synthetic voice clips (macOS voices, Tamil, Hindi, English) | 5/5 after adding name matching and the language picker |
| Real phone recordings | Not yet tested |

"Read correctly" means the payer and every person's share match to the paise.

**Limits**
- The tests use sentences I wrote and computer voices, not real people's speech. Real Tanglish recordings may do worse.
- One Tamil-script sentence in the held-back set had the wrong payer. That's why the confirmation card always shows the payer.
- The Tamil and Hindi in the examples haven't been reviewed by native speakers.

Reproduce with `python eval_reading.py cases.json` (one Groq call per sentence).

## Run it

```bash
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
echo "GROQ_API_KEY=your-key" > .env
./.venv/bin/uvicorn server:app --port 8502
```

## Privacy

Speech and text are sent to Groq to be read. This app doesn't store them. The group's names and expenses stay in your browser.
