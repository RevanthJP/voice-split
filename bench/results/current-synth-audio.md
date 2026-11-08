# Kitty benchmark: current-synth-audio

Run on 2026-11-07 22:53. 30 items.

Models that answered: openai/gpt-oss-20b × 26, openai/gpt-oss-120b × 2. Main model failed and backup was tried: 2. **Mixed models: results are not comparable with a single-model run.**

| Measure | Result |
|---|---|
| Final expense correct | 77% (23/30) |
| Amount | 93% (26/28) |
| Payer | 96% (27/28) |
| Participants | 86% (24/28) |
| Names (spelling, none invented) | 89% (25/28) |
| Word error rate (lower is better) | 0.368 (n=30) |
| Character error rate | 0.314 (n=30) |
| Names heard in transcript | 0.714 (n=28) |
| Speech time per clip, s | 1.035 (n=30) |
| Reading time per item, s | 1.299 (n=28) |
| Wrong results that the card flagged | 4/5 |
| Errors (no result) | 2 |

**Why results went wrong**

| Problem | Items | Which |
|---|---|---|
| payer error | 1 | b-hg-party-exclude.wav |
| amount error | 2 | b-hg-dedh-hazaar.wav, b-hi-grocery.wav |
| extra sharers | 2 | b-hg-party-exclude.wav, b-inen-myself.wav |
| missing sharers | 4 | b-hg-dedh-hazaar.wav, b-hg-party-exclude.wav, b-tg-swiggy-k.wav, b-inen-myself.wav |
| amount: from number words | 2 | |
| friend name in transcript but not said | 5 | b-hi-hotel.wav: Amit, b-ta-petrol.wav: Suresh, b-hi-grocery.wav: Neha, b-ta-digits.wav: Arun/Ravi, b-hi-drinks.wav: Amit |
| script: switched to Tamil/Hindi script | 6 | |

| Language | Final correct |
|---|---|
| english | 82% (9/11) |
| hindi | 67% (2/3) |
| hinglish | 67% (4/6) |
| indian-english | 80% (4/5) |
| tamil | 100% (2/2) |
| tanglish | 67% (2/3) |

| Type of sentence | Final correct |
|---|---|
| amount-k | 0% (0/1) |
| amount-words | 67% (4/6) |
| assumption | 100% (1/1) |
| currency-format | 100% (1/1) |
| exclusion | 75% (3/4) |
| items | 50% (1/2) |
| known-not-present | 100% (2/2) |
| lakh | 100% (1/1) |
| missing | 0% (0/1) |
| names | 80% (8/10) |
| no-people | 100% (1/1) |
| payer | 86% (6/7) |
| payer-not-sharing | 100% (1/1) |
| payer-unstated | 0% (0/1) |
| percent | 100% (1/1) |
| prompt-insertion | 100% (1/1) |
| pronoun | 100% (4/4) |
| script | 80% (4/5) |
| sound-alike | 100% (2/2) |
| split | 100% (3/3) |
| treat | 100% (1/1) |
| unequal | 100% (2/2) |

Synthetic clips: final 77% (23/30), WER 0.368 (n=30), unscored 0

| Item | Model | Result |
|---|---|---|
| synthetic/b-inen-petrol-exclude.wav | openai/gpt-oss-20b | pass |
| synthetic/b-tg-dinner.wav | openai/gpt-oss-20b | pass |
| synthetic/b-hg-dinner.wav | openai/gpt-oss-20b | pass |
| synthetic/b-en-other-payer.wav | openai/gpt-oss-20b | pass |
| synthetic/b-hi-hotel.wav | openai/gpt-oss-20b | pass |
| synthetic/b-ta-petrol.wav | openai/gpt-oss-20b | pass |
| synthetic/b-en-treat.wav | openai/gpt-oss-20b | pass |
| synthetic/b-hg-dedh-hazaar.wav | openai/gpt-oss-20b | FAIL |
| synthetic/b-en-exact.wav | openai/gpt-oss-120b | pass |
| synthetic/b-en-no-amount.wav | - | error: nothing heard |
| synthetic/b-inen-chai.wav | openai/gpt-oss-20b | pass |
| synthetic/b-hg-party-exclude.wav | openai/gpt-oss-20b | FAIL |
| synthetic/b-en-percent.wav | openai/gpt-oss-20b | pass |
| synthetic/b-en-solo.wav | openai/gpt-oss-20b | pass |
| synthetic/b-hi-grocery.wav | openai/gpt-oss-20b | FAIL |
| synthetic/b-tg-swiggy-k.wav | openai/gpt-oss-120b | FAIL |
| synthetic/b-en-known-names.wav | openai/gpt-oss-20b | pass |
| synthetic/b-ta-digits.wav | openai/gpt-oss-20b | pass |
| synthetic/b-hg-other-payer.wav | openai/gpt-oss-20b | pass |
| synthetic/b-inen-rs.wav | openai/gpt-oss-20b | pass |
| synthetic/b-inen-lakh.wav | openai/gpt-oss-20b | pass |
| synthetic/b-hg-chhod-ke.wav | openai/gpt-oss-20b | pass |
| synthetic/b-inen-myself.wav | openai/gpt-oss-20b | FAIL |
| synthetic/b-en-pronoun-her.wav | openai/gpt-oss-20b | pass |
| synthetic/b-hi-drinks.wav | openai/gpt-oss-20b | pass |
| synthetic/b-en-group-unsaid.wav | openai/gpt-oss-20b | pass |
| synthetic/b-en-soundalike.wav | openai/gpt-oss-20b | pass |
| synthetic/b-tg-soundalike.wav | openai/gpt-oss-20b | pass |
| synthetic/b-hg-friends-unsaid.wav | openai/gpt-oss-20b | pass |
| synthetic/b-en-payer-unsaid.wav | - | error: nothing heard |
