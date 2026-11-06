# Test outputs

Evidence from testing Kitty, kept so the results can be checked later.

## Screenshots (`screenshots/`)

Every screenshot is made by `node tools/screenshots.mjs`, which opens the app in a fresh Chrome profile as a brand-new user, at phone size (375 × 812). They are numbered in the order a new user sees them. Test details are made up: the sample name "Asha Kumar" (typed as "asha kumar"), the friend "Meena" and the number `99999 99999`.

### Welcome and guide tour

Every tour screen after Welcome has Back and Next; Back on the first step returns to Welcome, and Back on set up returns to the last step. One expense runs through the guide: a ₹10,000 dinner where Akash skipped drinks. Its numbers come from the app's own split maths (`splits.py`).

| File | What it shows |
|---|---|
| `01-welcome.jpg` | Welcome |
| `02-how-1-say.jpg` | 1 Just say it: types Tanglish, Hinglish, Tamil and Hindi examples, then stops on the English dinner |
| `02-how-1-say-laptop-window.jpg` | The same step in a laptop-size window: the phone frame grows (300 × 470) instead of looking small |
| `03-how-2-friends-1-contacts.jpg` | 2 Find your friends: allow contacts, then each person flips from Add to ✓ Added |
| `03-how-2-friends-2-by-number.jpg` | 2, same screen: adding Priya by name and WhatsApp number |
| `03-how-2-friends-3-added.jpg` | 2, end: Priya joins the list |
| `04-how-3-names.jpg` | 3 Kitty finds the people: five names pop in, then Next |
| `05-how-4-check.jpg` | 4 Check it, then save: food ₹7,500 for all 5, drinks ₹2,500 without Akash; Akash ₹1,500, everyone else ₹2,125 |
| `06-how-5-group-make.jpg` | 5 Groups keep the tally, first half: making "Goa trip" |
| `06-how-5-group-tally.jpg` | 5, second half on the same screen: dinner, hotel and cab, settled in 4 payments |
| `07-how-6-share.jpg` | 6 Split and share: everyone's share, and WhatsApp opens with the message ready |
| `08-setup.jpg` | Let's set you up: name and UPI ID. An empty name is blocked, and names are saved with capitals |

### The app

| File | What it shows |
|---|---|
| `09-contacts-ask.jpg` | "Now give your contacts access", shown once after the tour |
| `10-home.jpg` | Home for a new user: greeting, balance card (₹0 shortcuts don't open Friends), type box and empty charts |
| `11-split-share.jpg` | A real AI-read split ("Dinner yesterday ₹1,500 split with Arun and Ravi") with Share on WhatsApp |
| `12-friends.jpg` | Friends for a new user: two equal add buttons, search, a placeholder chart and "How friends work" |
| `13-friends-from-contacts.jpg` | From contacts: the privacy note before the phone's contact list opens |
| `14-friends-by-number.jpg` | By number: name and WhatsApp number, number required |
| `15-friends-list.jpg` | The friend added, with their number |
| `16-friends-search.jpg` | Search with no match, offering to add that name by number |
| `17-groups.jpg` | Groups for a new user: one-tap group ideas and "How groups work" |
| `18-account.jpg` | Account |

The same run also checks: a stray word from silence ("E aí") doesn't open the expense sheet; no Splitwise text and no example under the mic; a spoken "Meena" is matched to the contact "Meena Sharma" in the browser with nothing written to storage; search finds people by name or by part of their number; sample friends saved by an older version are removed; replaying the tour (`/#welcome`) never pre-fills the name.

Not covered: recording with a real microphone, the phone's contact picker, opening WhatsApp, and installing on a phone. Those need a real phone.

## AI reading results (`ai-reading-results.json`)

The most recent run of `eval_reading.py`: for each test sentence, what the AI returned and whether the payer and every share matched to the paisa. Each run overwrites this file.

The saved copy is from the held-back set (`cases_heldout.json`): 7 of 8 read correctly. The miss is a Tamil-script sentence where the AI got the payer wrong, which the confirmation screen lets you fix.
