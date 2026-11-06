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

Order for a new user: Welcome → How it works (6 steps) → Let's set you up → app. One expense runs through the walkthrough: the ₹10,000 dinner where Akash skipped drinks. Its numbers come from the app's own split maths.

| File | What it shows |
|---|---|
| 01-welcome.jpg | Welcome |
| 16-how-1-say.jpg | 1 Just say it: types Tanglish, Hinglish, Tamil and Hindi examples, then stops on the English dinner |
| 16-how-2-friends.jpg | 2 Find your friends: allow contacts, each person flips from Add to ✓ Added |
| 16-how-3-names.jpg | 3 Kitty finds the people: five names pop in, then Next |
| 16-how-4-check.jpg | 4 Check it, then save: food ₹7,500 for all 5, drinks ₹2,500 without Akash; Akash ₹1,500, everyone else ₹2,125 |
| 16-how-5-group-make.jpg | 5 Groups keep the tally, first half: making "Goa trip" |
| 16-how-5-group-tally.jpg | 5, second half on the same screen: dinner, hotel and cab; settle up in 4 payments |
| 16-how-6-share.jpg | 6 Split and share: everyone's share, WhatsApp opens with the message ready |
| 09-setup.jpg | Name and UPI ID, after How it works; names saved with capitals ("asha kumar" → "Asha Kumar") |
| 20-contacts-ask.jpg | Main app: "Now give your contacts access" |
| 21-split-share.jpg | A real AI-read split (typed by the test: ₹1,500 with Arun and Ravi) with Share on WhatsApp |
| 22-friends-after-tour.jpg | Friends after the tour: empty, sample friends not kept |
| 23-friends-add-contacts.jpg | Friends → From contacts: the privacy note first |
| 24-friends-add-number.jpg | Friends → By number: name and WhatsApp number (dummy 99999 99999), number required |
| 25-friends-list.jpg | The friend added with their number |

Also checked: a stray word from silence ("E aí") doesn't open the expense sheet; ₹0 balances don't open Friends; no Splitwise text and no example under the mic; a spoken "Meena" matched to the contact "Meena Sharma" in the browser with nothing written to storage.
