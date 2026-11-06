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

## Onboarding, contacts and sharing (taken by `tools/screenshots.mjs`)

| File | What it shows |
|---|---|
| 15-find-friends.jpg | After the name: five sample friends, the example to try, and "How it works" |
| 16-how-contacts.jpg | How it works 1: allowing contacts, names appear |
| 17-how-voice.jpg | How it works 2: the mic and "Share my expenses for last night dinner ₹10,000 with 5 people" |
| 18-how-names.jpg | How it works 3: five names pop in one by one, then Next |
| 19-how-whatsapp.jpg | How it works 4: ₹2,000 each, WhatsApp opens with the message ready |
| 20-contacts-ask.jpg | Main app: "Now give your contacts access" |
| 21-split-share.jpg | A real AI-read split (₹1,500 with Arun and Ravi) with Share on WhatsApp |
| 22-friends-samples.jpg | Friends tab with the sample friends marked |

Checks in the same run: sample friends saved; a spoken "Meena" matched to the contact "Meena Sharma" in the browser with nothing written to storage; the share message lists each share; browsers without a contact picker get a clear note.
