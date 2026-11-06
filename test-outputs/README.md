# Test outputs

Evidence from testing Kitty, kept so the results can be checked later.

## Screenshots (`screenshots/`)

Taken on 6 November 2026 in a browser set to phone size (375 × 812). They show sample test data: the UPI ID `yourname@upi` and the number `99999 99999` are made up.

| File | What it shows |
|---|---|
| `01-welcome.jpg` | First screen of the welcome tour |
| `02-tour-tanglish.jpg` to `06-tour-english.jpg` | The tour's example typed in Tanglish, Hinglish, Tamil, Hindi and English, with the split it produces |
| `07-tour-split-explained.jpg` | How a bill splits when one person skips the drinks |
| `08-tour-settle-up.jpg` | Who owes whom, and the WhatsApp reminder |
| `09-setup.jpg` | Setup: name and UPI ID only |
| `10-home.jpg` | Home for a new user: greeting, balance card, typing box and empty charts |
| `11-friends.jpg` | Friends: who-owes-whom chart and reminder buttons |
| `12-whatsapp-send.jpg` | The reminder sheet, with the message and an optional number |
| `13-account.jpg`, `14-account-more.jpg` | Account: name, phone, UPI ID, export, and features marked coming soon |

Not covered by these screenshots: recording with a real microphone, opening WhatsApp, and installing on a phone. Those need a real phone.

`01-welcome.jpg`, `02-tour-tanglish.jpg`, `09-setup.jpg`, `10-home.jpg` and `13-account.jpg` are made by `node tools/screenshots.mjs`, which opens the app in a fresh Chrome profile as a brand-new user and finishes setup with the sample name "Asha". It also checks that the tour appears, the name and UPI ID start empty, an empty name is blocked, Account has no speaking-language row, and replaying the tour never pre-fills the name. Home and Account show a new user with no expenses yet.

## AI reading results (`ai-reading-results.json`)

The most recent run of `eval_reading.py`: for each test sentence, what the AI returned and whether the payer and every share matched to the paisa. Each run overwrites this file.

The saved copy is from the held-back set (`cases_heldout.json`): 7 of 8 read correctly. The miss is a Tamil-script sentence where the AI got the payer wrong, which the confirmation screen lets you fix.
