# Kitty benchmark: stageB-baseline-synth-audio

Run on 2026-11-07 23:42. 30 items.

Models that answered: openai/gpt-oss-20b × 29. Main model failed on: 1. Rate-limit waits by the benchmark: 0.

| Measure | Result |
|---|---|
| Final expense correct | 77% (23/30) |
| Amount | 96% (27/28) |
| Payer | 93% (26/28) |
| Participants | 79% (22/28) |
| Names (spelling, none invented) | 82% (23/28) |
| Word error rate (lower is better) | 0.307 (n=30) |
| Character error rate | 0.235 (n=30) |
| Names heard in transcript | 0.929 (n=28) |
| Speech time per clip, s | 0.833 (n=30) |
| Reading time per item, s | 1.307 (n=29) |
| Wrong results that the card flagged | 1/6 |
| Errors (no result) | 1 |

**Why results went wrong**

| Problem | Items | Which |
|---|---|---|
| payer error | 2 | b-hi-hotel.wav, b-hg-chhod-ke.wav |
| amount error | 1 | b-hg-dedh-hazaar.wav |
| extra sharers | 4 | b-hg-other-payer.wav, b-hg-chhod-ke.wav, b-inen-myself.wav, b-en-payer-unsaid.wav |
| missing sharers | 6 | b-hi-hotel.wav, b-hg-dedh-hazaar.wav, b-hg-other-payer.wav, b-hg-chhod-ke.wav, b-inen-myself.wav, b-en-payer-unsaid.wav |
| amount: from number words | 1 | |
| friend name in transcript but not said | 0 |  |
| name comparison uncertain (not counted as inserted) | 1 | b-hi-hotel.wav: Ravi |
| script: switched to Tamil/Hindi script | 6 | |
| expected card check shown | 0/1 | |

| Language | Final correct |
|---|---|
| english | 91% (10/11) |
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
| unequal | 100% (2/2) |

Synthetic clips: final 77% (23/30), WER 0.307 (n=30), unscored 0

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
| synthetic/b-en-exact.wav | openai/gpt-oss-20b | pass |
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
| synthetic/b-en-payer-unsaid.wav | openai/gpt-oss-20b | FAIL |
