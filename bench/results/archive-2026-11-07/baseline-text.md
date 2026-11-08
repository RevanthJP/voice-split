# Kitty benchmark: baseline-text

Run on 2026-11-07 22:29. 34 items.

Models that answered: openai/gpt-oss-20b × 33. Main model failed and backup was tried: 1.

| Measure | Result |
|---|---|
| Final expense correct | 97% (33/34) |
| Amount | 100% (32/32) |
| Payer | 100% (32/32) |
| Participants | 100% (32/32) |
| Names (spelling, none invented) | 100% (32/32) |
| Reading time per item, s | 1.201 (n=33) |
| Errors (no result) | 1 |

**Why results went wrong**

| Problem | Items | Which |
|---|---|---|
| expected card check shown | 0/1 | |

| Language | Final correct |
|---|---|
| english | 100% (11/11) |
| hindi | 100% (3/3) |
| hinglish | 100% (6/6) |
| indian-english | 80% (4/5) |
| tamil | 100% (2/2) |
| tanglish | 100% (7/7) |

| Type of sentence | Final correct |
|---|---|
| amount-k | 100% (1/1) |
| amount-words | 100% (7/7) |
| assumption | 100% (1/1) |
| currency-format | 100% (1/1) |
| exclusion | 100% (6/6) |
| items | 100% (3/3) |
| known-not-present | 100% (3/3) |
| lakh | 100% (1/1) |
| missing | 100% (1/1) |
| names | 90% (9/10) |
| no-people | 100% (1/1) |
| payer | 100% (8/8) |
| payer-not-sharing | 100% (1/1) |
| payer-unstated | 100% (1/1) |
| percent | 100% (1/1) |
| prompt-insertion | 100% (1/1) |
| pronoun | 100% (4/4) |
| script | 100% (5/5) |
| shares | 100% (1/1) |
| sound-alike | 100% (2/2) |
| split | 67% (2/3) |
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
| b-ta-petrol | openai/gpt-oss-20b | pass |
| b-en-treat | openai/gpt-oss-20b | pass |
| b-hg-dedh-hazaar | openai/gpt-oss-20b | pass |
| b-tg-munnooru | openai/gpt-oss-20b | pass |
| b-en-exact | openai/gpt-oss-20b | pass |
| b-en-no-amount | openai/gpt-oss-20b | pass |
| b-inen-chai | - | error: BadRequestError: Error code: 400 - {'error': {'message': "Fa |
| b-hg-party-exclude | openai/gpt-oss-20b | pass |
| b-tg-shares | openai/gpt-oss-20b | pass |
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
