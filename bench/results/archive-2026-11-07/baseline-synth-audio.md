# Kitty benchmark: baseline-synth-audio

Run on 2026-11-07 22:48. 30 items.

Models that answered: openai/gpt-oss-20b × 27. Main model failed and backup was tried: 3.

| Measure | Result |
|---|---|
| Final expense correct | 73% (22/30) |
| Amount | 96% (25/26) |
| Payer | 96% (25/26) |
| Participants | 85% (22/26) |
| Names (spelling, none invented) | 92% (24/26) |
| Word error rate (lower is better) | 0.307 (n=30) |
| Character error rate | 0.235 (n=30) |
| Names heard in transcript | 0.714 (n=28) |
| Speech time per clip, s | 0.831 (n=30) |
| Reading time per item, s | 1.052 (n=27) |
| Wrong results that the card flagged | 1/5 |
| Errors (no result) | 3 |

**Why results went wrong**

| Problem | Items | Which |
|---|---|---|
| payer error | 1 | b-hg-chhod-ke.wav |
| amount error | 1 | b-hg-dedh-hazaar.wav |
| extra sharers | 2 | b-hg-other-payer.wav, b-inen-myself.wav |
| missing sharers | 4 | b-hi-hotel.wav, b-hg-dedh-hazaar.wav, b-hg-other-payer.wav, b-inen-myself.wav |
| amount: from number words | 1 | |
| friend name in transcript but not said | 1 | b-ta-digits.wav: Arun/Ravi |
| script: switched to Tamil/Hindi script | 6 | |

| Language | Final correct |
|---|---|
| english | 82% (9/11) |
| hindi | 67% (2/3) |
| hinglish | 50% (3/6) |
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
| items | 100% (2/2) |
| known-not-present | 100% (2/2) |
| lakh | 100% (1/1) |
| missing | 100% (1/1) |
| names | 80% (8/10) |
| no-people | 100% (1/1) |
| payer | 57% (4/7) |
| payer-not-sharing | 100% (1/1) |
| payer-unstated | 0% (0/1) |
| percent | 100% (1/1) |
| prompt-insertion | 100% (1/1) |
| pronoun | 100% (4/4) |
| script | 80% (4/5) |
| sound-alike | 100% (2/2) |
| split | 100% (3/3) |
| treat | 100% (1/1) |
| unequal | 50% (1/2) |

Synthetic clips: final 73% (22/30), WER 0.307 (n=30), unscored 0

| Item | Model | Result |
|---|---|---|
| synthetic/b-inen-petrol-exclude.wav | openai/gpt-oss-20b | pass |
| synthetic/b-tg-dinner.wav | openai/gpt-oss-20b | pass |
| synthetic/b-hg-dinner.wav | openai/gpt-oss-20b | pass |
| synthetic/b-en-other-payer.wav | openai/gpt-oss-20b | pass |
| synthetic/b-hi-hotel.wav | openai/gpt-oss-20b | FAIL |
| synthetic/b-ta-petrol.wav | openai/gpt-oss-20b | pass |
| synthetic/b-en-treat.wav | openai/gpt-oss-20b | pass |
| synthetic/b-hg-dedh-hazaar.wav | openai/gpt-oss-20b | FAIL |
| synthetic/b-en-exact.wav | - | error: BadRequestError: Error code: 400 - {'error': {'message': "Fa |
| synthetic/b-en-no-amount.wav | openai/gpt-oss-20b | pass |
| synthetic/b-inen-chai.wav | openai/gpt-oss-20b | pass |
| synthetic/b-hg-party-exclude.wav | openai/gpt-oss-20b | pass |
| synthetic/b-en-percent.wav | openai/gpt-oss-20b | pass |
| synthetic/b-en-solo.wav | openai/gpt-oss-20b | pass |
| synthetic/b-hi-grocery.wav | openai/gpt-oss-20b | pass |
| synthetic/b-tg-swiggy-k.wav | - | error: BadRequestError: Error code: 400 - {'error': {'message': "Fa |
| synthetic/b-en-known-names.wav | openai/gpt-oss-20b | pass |
| synthetic/b-ta-digits.wav | openai/gpt-oss-20b | pass |
| synthetic/b-hg-other-payer.wav | openai/gpt-oss-20b | FAIL |
| synthetic/b-inen-rs.wav | openai/gpt-oss-20b | pass |
| synthetic/b-inen-lakh.wav | openai/gpt-oss-20b | pass |
| synthetic/b-hg-chhod-ke.wav | openai/gpt-oss-20b | FAIL |
| synthetic/b-inen-myself.wav | openai/gpt-oss-20b | FAIL |
| synthetic/b-en-pronoun-her.wav | openai/gpt-oss-20b | pass |
| synthetic/b-hi-drinks.wav | openai/gpt-oss-20b | pass |
| synthetic/b-en-group-unsaid.wav | openai/gpt-oss-20b | pass |
| synthetic/b-en-soundalike.wav | openai/gpt-oss-20b | pass |
| synthetic/b-tg-soundalike.wav | openai/gpt-oss-20b | pass |
| synthetic/b-hg-friends-unsaid.wav | openai/gpt-oss-20b | pass |
| synthetic/b-en-payer-unsaid.wav | - | error: BadRequestError: Error code: 400 - {'error': {'message': "Fa |
