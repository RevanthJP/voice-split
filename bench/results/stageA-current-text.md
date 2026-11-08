# Kitty benchmark: stageA-current-text

Run on 2026-11-07 23:30. 34 items.

Models that answered: openai/gpt-oss-20b × 33, openai/gpt-oss-120b × 1. Main model failed on: 1. Rate-limit waits by the benchmark: 0. **Mixed models: results are not comparable with a single-model run.**

| Measure | Result |
|---|---|
| Final expense correct | 97% (33/34) |
| Amount | 97% (32/33) |
| Payer | 100% (33/33) |
| Participants | 100% (33/33) |
| Names (spelling, none invented) | 100% (33/33) |
| Reading time per item, s | 1.183 (n=34) |
| Wrong results that the card flagged | 1/1 |
| Errors (no result) | 0 |
| Final correct, answered by primary model only | 97% (32/33) |
| Final correct, answered by backup model only | 100% (1/1) |

**Why results went wrong**

| Problem | Items | Which |
|---|---|---|
| amount error | 1 | b-ta-petrol |
| amount: from number words | 1 | |
| expected card check shown | 1/1 | |

| Language | Final correct |
|---|---|
| english | 100% (11/11) |
| hindi | 100% (3/3) |
| hinglish | 100% (6/6) |
| indian-english | 100% (5/5) |
| tamil | 50% (1/2) |
| tanglish | 100% (7/7) |

| Type of sentence | Final correct |
|---|---|
| amount-k | 100% (1/1) |
| amount-words | 86% (6/7) |
| assumption | 100% (1/1) |
| currency-format | 100% (1/1) |
| exclusion | 100% (6/6) |
| items | 100% (3/3) |
| known-not-present | 100% (3/3) |
| lakh | 100% (1/1) |
| missing | 100% (1/1) |
| names | 100% (10/10) |
| no-people | 100% (1/1) |
| payer | 88% (7/8) |
| payer-not-sharing | 100% (1/1) |
| payer-unstated | 100% (1/1) |
| percent | 100% (1/1) |
| prompt-insertion | 100% (1/1) |
| pronoun | 75% (3/4) |
| script | 80% (4/5) |
| shares | 100% (1/1) |
| sound-alike | 100% (2/2) |
| split | 100% (3/3) |
| treat | 100% (1/1) |
| unequal | 100% (3/3) |

| Item | Model | Result |
|---|---|---|
| b-inen-petrol-exclude | openai/gpt-oss-20b | pass |
| b-tg-dinner | openai/gpt-oss-20b | pass |
| b-hg-dinner | openai/gpt-oss-20b | pass |
| b-en-other-payer | openai/gpt-oss-20b | pass |
| b-tg-drinks-exclude | openai/gpt-oss-20b | pass |
| b-hi-hotel | openai/gpt-oss-20b | pass |
| b-ta-petrol | openai/gpt-oss-20b | FAIL |
| b-en-treat | openai/gpt-oss-20b | pass |
| b-hg-dedh-hazaar | openai/gpt-oss-20b | pass |
| b-tg-munnooru | openai/gpt-oss-20b | pass |
| b-en-exact | openai/gpt-oss-20b | pass |
| b-en-no-amount | openai/gpt-oss-20b | pass |
| b-inen-chai | openai/gpt-oss-20b | pass |
| b-hg-party-exclude | openai/gpt-oss-20b | pass |
| b-tg-shares | openai/gpt-oss-120b (backup, after main model failed) | pass |
| b-en-percent | openai/gpt-oss-20b | pass |
| b-en-solo | openai/gpt-oss-20b | pass |
| b-hi-grocery | openai/gpt-oss-20b | pass |
| b-tg-swiggy-k | openai/gpt-oss-20b | pass |
| b-en-known-names | openai/gpt-oss-20b | pass |
| b-ta-digits | openai/gpt-oss-20b | pass |
| b-hg-other-payer | openai/gpt-oss-20b | pass |
| b-inen-rs | openai/gpt-oss-20b | pass |
| b-inen-lakh | openai/gpt-oss-20b | pass |
| b-hg-chhod-ke | openai/gpt-oss-20b | pass |
| b-inen-myself | openai/gpt-oss-20b | pass |
| b-en-pronoun-her | openai/gpt-oss-20b | pass |
| b-tg-absent | openai/gpt-oss-20b | pass |
| b-hi-drinks | openai/gpt-oss-20b | pass |
| b-en-group-unsaid | openai/gpt-oss-20b | pass |
| b-en-soundalike | openai/gpt-oss-20b | pass |
| b-tg-soundalike | openai/gpt-oss-20b | pass |
| b-hg-friends-unsaid | openai/gpt-oss-20b | pass |
| b-en-payer-unsaid | openai/gpt-oss-20b | pass |
