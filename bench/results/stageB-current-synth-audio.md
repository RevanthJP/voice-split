# Kitty benchmark: stageB-current-synth-audio

Run on 2026-11-07 23:48. 30 items.

Models that answered: openai/gpt-oss-20b × 28, openai/gpt-oss-120b × 2. Main model failed on: 2. Rate-limit waits by the benchmark: 0. **Mixed models: results are not comparable with a single-model run.**

| Measure | Result |
|---|---|
| Final expense correct | 73% (22/30) |
| Amount | 93% (27/29) |
| Payer | 97% (28/29) |
| Participants | 79% (23/29) |
| Names (spelling, none invented) | 90% (26/29) |
| Word error rate (lower is better) | 0.302 (n=30) |
| Character error rate | 0.247 (n=30) |
| Names heard in transcript | 0.929 (n=28) |
| Speech time per clip, s | 0.867 (n=30) |
| Reading time per item, s | 1.220 (n=30) |
| Wrong results that the card flagged | 6/8 |
| Errors (no result) | 0 |
| Final correct, answered by primary model only | 79% (22/28) |
| Final correct, answered by backup model only | 0% (0/2) |

**Why results went wrong**

| Problem | Items | Which |
|---|---|---|
| payer error | 1 | b-hg-chhod-ke.wav |
| amount error | 2 | b-hg-dedh-hazaar.wav, b-hi-grocery.wav |
| extra sharers | 2 | b-hg-other-payer.wav, b-inen-myself.wav |
| missing sharers | 6 | b-hi-hotel.wav, b-hg-dedh-hazaar.wav, b-tg-swiggy-k.wav, b-hg-other-payer.wav, b-inen-myself.wav, b-tg-soundalike.wav |
| amount: from number words | 2 | |
| friend name in transcript but not said | 0 |  |
| script: switched to Tamil/Hindi script | 6 | |
| expected card check shown | 1/1 | |

| Language | Final correct |
|---|---|
| english | 100% (11/11) |
| hindi | 33% (1/3) |
| hinglish | 50% (3/6) |
| indian-english | 80% (4/5) |
| tamil | 100% (2/2) |
| tanglish | 33% (1/3) |

| Type of sentence | Final correct |
|---|---|
| amount-k | 0% (0/1) |
| amount-words | 50% (3/6) |
| assumption | 100% (1/1) |
| currency-format | 100% (1/1) |
| exclusion | 75% (3/4) |
| items | 100% (2/2) |
| known-not-present | 100% (2/2) |
| lakh | 100% (1/1) |
| missing | 100% (1/1) |
| names | 70% (7/10) |
| no-people | 100% (1/1) |
| payer | 71% (5/7) |
| payer-not-sharing | 100% (1/1) |
| payer-unstated | 100% (1/1) |
| percent | 100% (1/1) |
| prompt-insertion | 100% (1/1) |
| pronoun | 100% (4/4) |
| script | 60% (3/5) |
| sound-alike | 50% (1/2) |
| split | 100% (3/3) |
| treat | 100% (1/1) |
| unequal | 100% (2/2) |

Synthetic clips: final 73% (22/30), WER 0.302 (n=30), unscored 0

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
| synthetic/b-hi-grocery.wav | openai/gpt-oss-20b | FAIL |
| synthetic/b-tg-swiggy-k.wav | openai/gpt-oss-120b (backup, after main model failed) | FAIL |
| synthetic/b-en-known-names.wav | openai/gpt-oss-20b | pass |
| synthetic/b-ta-digits.wav | openai/gpt-oss-20b | pass |
| synthetic/b-hg-other-payer.wav | openai/gpt-oss-20b | FAIL |
| synthetic/b-inen-rs.wav | openai/gpt-oss-20b | pass |
| synthetic/b-inen-lakh.wav | openai/gpt-oss-20b | pass |
| synthetic/b-hg-chhod-ke.wav | openai/gpt-oss-120b (backup, after main model failed) | FAIL |
| synthetic/b-inen-myself.wav | openai/gpt-oss-20b | FAIL |
| synthetic/b-en-pronoun-her.wav | openai/gpt-oss-20b | pass |
| synthetic/b-hi-drinks.wav | openai/gpt-oss-20b | pass |
| synthetic/b-en-group-unsaid.wav | openai/gpt-oss-20b | pass |
| synthetic/b-en-soundalike.wav | openai/gpt-oss-20b | pass |
| synthetic/b-tg-soundalike.wav | openai/gpt-oss-20b | FAIL |
| synthetic/b-hg-friends-unsaid.wav | openai/gpt-oss-20b | pass |
| synthetic/b-en-payer-unsaid.wav | openai/gpt-oss-20b | pass |
