# Transcript report: amounts, names and offline variant E

**Kept local, not in git:** the raw speech results (`results/speech.json`) and all audio clips. The repository is public, so it holds only this summary, not raw API output or audio files. The fresh clips can be remade with `make_clips.py`. Tests that need the raw results skip when they are missing.

**The fresh clips, like the existing ones, are computer voices reading clean text.** They are a stress test of the prompts and are not evidence about real speakers.

Made only from the 168 saved Whisper transcripts. **No API calls, and no reading model.** These are transcript-level results, not entry success: they show what Whisper wrote, not what would be saved.

Noise verdicts use an exact sign test on clips where one side was right and the other wrong. Paired names within one clip are not fully independent, so name verdicts are slightly generous.

## 1. Amount in the transcript

### Existing clips

| Variant | digits-correct | number-words-correct | wrong | garbled/missing | needs human check | Right in total |
|---|---|---|---|---|---|---|
| A | 28/29 | 0/29 | 0/29 | 1/29 | 0/29 | **28/29** |
| B | 27/29 | 0/29 | 0/29 | 1/29 | 1/29 | **27/29** |
| B2 | 27/29 | 0/29 | 0/29 | 1/29 | 1/29 | **27/29** |
| C | 25/29 | 2/29 | 0/29 | 1/29 | 1/29 | **27/29** |

### Existing, amount spoken in digits

| Variant | digits-correct | number-words-correct | wrong | garbled/missing | needs human check | Right in total |
|---|---|---|---|---|---|---|
| A | 24/24 | 0/24 | 0/24 | 0/24 | 0/24 | **24/24** |
| B | 24/24 | 0/24 | 0/24 | 0/24 | 0/24 | **24/24** |
| B2 | 24/24 | 0/24 | 0/24 | 0/24 | 0/24 | **24/24** |
| C | 24/24 | 0/24 | 0/24 | 0/24 | 0/24 | **24/24** |

### Existing, amount spoken in number words

| Variant | digits-correct | number-words-correct | wrong | garbled/missing | needs human check | Right in total |
|---|---|---|---|---|---|---|
| A | 4/5 | 0/5 | 0/5 | 1/5 | 0/5 | **4/5** |
| B | 3/5 | 0/5 | 0/5 | 1/5 | 1/5 | **3/5** |
| B2 | 3/5 | 0/5 | 0/5 | 1/5 | 1/5 | **3/5** |
| C | 1/5 | 2/5 | 0/5 | 1/5 | 1/5 | **3/5** |

### Fresh clips (synthetic, all number words)

| Variant | digits-correct | number-words-correct | wrong | garbled/missing | needs human check | Right in total |
|---|---|---|---|---|---|---|
| A | 10/12 | 1/12 | 1/12 | 0/12 | 0/12 | **11/12** |
| B | 10/12 | 1/12 | 0/12 | 0/12 | 1/12 | **11/12** |
| B2 | 10/12 | 1/12 | 0/12 | 0/12 | 1/12 | **11/12** |
| C | 6/12 | 4/12 | 1/12 | 0/12 | 1/12 | **10/12** |

### Is any amount difference within noise?

| Clips | Pair | First right, second not | Second right, first not | Left out (needs check) | Verdict | With every check counted wrong |
|---|---|---|---|---|---|---|
| Existing clips | A vs B | 0 | 0 | 1 | p=1.000, within noise | 1 to 0: p=1.000, within noise |
| Existing clips | A vs B2 | 0 | 0 | 1 | p=1.000, within noise | 1 to 0: p=1.000, within noise |
| Existing clips | B2 vs B | 0 | 0 | 1 | p=1.000, within noise | 0 to 0: p=1.000, within noise |
| Existing clips | B vs C | 0 | 0 | 1 | p=1.000, within noise | 0 to 0: p=1.000, within noise |
| Existing clips | A vs C | 0 | 0 | 1 | p=1.000, within noise | 1 to 0: p=1.000, within noise |
| Fresh clips (synthetic, all number words) | A vs B | 0 | 1 | 1 | p=1.000, within noise | 1 to 1: p=1.000, within noise |
| Fresh clips (synthetic, all number words) | A vs B2 | 0 | 1 | 1 | p=1.000, within noise | 1 to 1: p=1.000, within noise |
| Fresh clips (synthetic, all number words) | B2 vs B | 0 | 0 | 1 | p=1.000, within noise | 0 to 0: p=1.000, within noise |
| Fresh clips (synthetic, all number words) | B vs C | 1 | 0 | 1 | p=1.000, within noise | 1 to 0: p=1.000, within noise |
| Fresh clips (synthetic, all number words) | A vs C | 0 | 0 | 1 | p=1.000, within noise | 1 to 0: p=1.000, within noise |

### Every clip

`digits` and `words` are right; `WRONG` is a different amount; `garbled` has no usable amount; `check` needs a person.

| Clip | Set | True amount | A | B | B2 | C |
|---|---|---|---|---|---|---|
| `b-inen-petrol-exclude` | existing | 1,800 | digits | digits | digits | digits |
| `b-tg-dinner` | existing | 2,500 | digits | digits | digits | digits |
| `b-hg-dinner` | existing | 2,500 | digits | digits | digits | digits |
| `b-en-other-payer` | existing | 3,000 | digits | digits | digits | digits |
| `b-hi-hotel` | existing | 6,000 | digits | digits | digits | words |
| `b-ta-petrol` | existing | 500 | digits | digits | digits | digits |
| `b-en-treat` | existing | 900 | digits | digits | digits | digits |
| `b-hg-dedh-hazaar` | existing | 1,500 | garbled | garbled | garbled | garbled |
| `b-en-exact` | existing | 1,000 | digits | digits | digits | digits |
| `b-inen-chai` | existing | 450 | digits | digits | digits | digits |
| `b-hg-party-exclude` | existing | 4,000 | digits | digits | digits | digits |
| `b-en-percent` | existing | 20,000 | digits | digits | digits | digits |
| `b-en-solo` | existing | 350 | digits | digits | digits | digits |
| `b-hi-grocery` | existing | 800 | digits | check | check | check |
| `b-tg-swiggy-k` | existing | 1,200 | digits | digits | digits | digits |
| `b-en-known-names` | existing | 2,400 | digits | digits | digits | digits |
| `b-ta-digits` | existing | 1,500 | digits | digits | digits | digits |
| `b-hg-other-payer` | existing | 2,000 | digits | digits | digits | digits |
| `b-inen-rs` | existing | 750 | digits | digits | digits | digits |
| `b-inen-lakh` | existing | 150,000 | digits | digits | digits | digits |
| `b-hg-chhod-ke` | existing | 1,200 | digits | digits | digits | digits |
| `b-inen-myself` | existing | 600 | digits | digits | digits | digits |
| `b-en-pronoun-her` | existing | 900 | digits | digits | digits | digits |
| `b-hi-drinks` | existing | 3,000 | digits | digits | digits | words |
| `b-en-group-unsaid` | existing | 500 | digits | digits | digits | digits |
| `b-en-soundalike` | existing | 800 | digits | digits | digits | digits |
| `b-tg-soundalike` | existing | 1,500 | digits | digits | digits | digits |
| `b-hg-friends-unsaid` | existing | 600 | digits | digits | digits | digits |
| `b-en-payer-unsaid` | existing | 1,200 | digits | digits | digits | digits |
| `fresh-synth-hi-1` | fresh | 300 | digits | digits | digits | words |
| `fresh-synth-hi-2` | fresh | 100 | words | words | words | words |
| `fresh-synth-hi-3` | fresh | 4,000 | digits | digits | digits | digits |
| `fresh-synth-hi-4` | fresh | 3,000 | digits | digits | digits | digits |
| `fresh-synth-hi-5` | fresh | 450 | digits | digits | digits | digits |
| `fresh-synth-ta-1` | fresh | 400 | digits | digits | digits | words |
| `fresh-synth-ta-2` | fresh | 900 | WRONG | digits | digits | WRONG |
| `fresh-synth-ta-3` | fresh | 6,000 | digits | check | check | check |
| `fresh-synth-ta-4` | fresh | 720 | digits | digits | digits | words |
| `fresh-synth-en-1` | fresh | 200 | digits | digits | digits | digits |
| `fresh-synth-en-2` | fresh | 8,000 | digits | digits | digits | digits |
| `fresh-synth-en-3` | fresh | 7,000 | digits | digits | digits | digits |

`b-en-no-amount` has no amount, so it is not scored here.

### Needs human check

- `b-hi-grocery` B (true amount 800): मैंने किराने पर आज सौ रुपये खर्च के, Neha के साथ ढातो।
- `b-hi-grocery` B2 (true amount 800): मैंने किराने पर आज सौ रुपये खर्च के, Neha के साथ ढातो।
- `b-hi-grocery` C (true amount 800): मैंने किराने पर आज सौ रुपये खर्च के, नेहा के साथ ढातो।
- `fresh-synth-ta-3` B (true amount 6,000): நான் Toxic கு ஆர் ஆயிரம் ரூபாய் கொடுத்தேன், Piriya Añjali கூட பிரிச்சுக்கோ.
- `fresh-synth-ta-3` B2 (true amount 6,000): நான் Toxic கு ஆர் ஆயிரம் ரூபாய் கொடுத்தேன், Piriya Añjali கூட பிரிச்சுக்கோ.
- `fresh-synth-ta-3` C (true amount 6,000): நான் toxic ஆர் ஆயிரம் ரூபாய் கொடுத்தேன், பிரியா அஞ்சலி கூட பிரிச்சுக்கோ.

### Counted as number-words-correct despite a non-standard spelling

- `fresh-synth-hi-2` A: non-standard spelling सो for सौ, after a count word: मैंने खाने के लिए एक सो रुपए दिये, राहुल के साथ ना तो.
- `fresh-synth-ta-4` C: non-standard joined spelling ஏழுநூறு: நான் petrol-க்கு ஏழுநூறு இருபது ரூபாய் கொடுத்தேன், Piriya Ganesh கூட பிரிச்சுக்கோ.

## 2. Clips where C wrote number words and A wrote digits

7 clips. C was meant to steer Whisper towards digits; on these it did the opposite.

| Clip | Set | True amount | A | C | C's class |
|---|---|---|---|---|---|
| `b-hi-hotel` | existing | 6,000 | रविवार ने होतेल के लिए 6,000 रुपए दिये, मेरे और अमित के साथ बराबर गातो. | रविवार ने होटेल के लिए छह हजार रुपये दिये, मेरे और Amit के साथ बराबर गातो। | words |
| `b-hi-grocery` | existing | 800 | मैंने किराने पर 800 रुपए खर्च के नेहा के साथ नातो. | मैंने किराने पर आज सौ रुपये खर्च के, नेहा के साथ ढातो। | check |
| `b-hi-drinks` | existing | 3,000 | मैंने दिनर के 3,000 दिये, राहुल, अमित और सुमित के साथ, पर सुमित ने ड्रिंक्स नहीं ली, ड्रिंक्स 600 की थी. | मैंने दिनर के तीन हजार दिये, Rahul, Amit और Sumit के साथ, पर Sumit ने drinks नहीं ली, drinks छैसो की थी। | words |
| `fresh-synth-hi-1` | fresh | 300 | मैंने खाने के लिए 300 रुपए दिये, अर्जुन और गनेश के साथ नातो. | मैंने खाने के लिए तीन सौ रुपये दिए, Arun और Ganesh के साथ दातो। | words |
| `fresh-synth-ta-1` | fresh | 400 | நான் டாக்சிக்கு 400 ரூபாயை கொடுத்தேன், அமிக்கூட பிரிச்சுக்கோ. | நான் toxic-க்கு நானூறு ரூபாய் கொடுத்தேன், Amit கூட பிரிச்சுக்கோ. | words |
| `fresh-synth-ta-3` | fresh | 6,000 | நான் டாக்சிக்கு 6,000 ரூபாய் கொடுத்தேன் பிரியா அஞ்جலி கூட பிரிச்சுக்கோ. | நான் toxic ஆர் ஆயிரம் ரூபாய் கொடுத்தேன், பிரியா அஞ்சலி கூட பிரிச்சுக்கோ. | check |
| `fresh-synth-ta-4` | fresh | 720 | நான் பெற்றோலுக்கு 720 ரூபாய் கொடுத்தேன் பிரியா கனேஷ் கூட பிரிச்சுக்கோ. | நான் petrol-க்கு ஏழுநூறு இருபது ரூபாய் கொடுத்தேன், Piriya Ganesh கூட பிரிச்சுக்கோ. | words |

### Which change in B caused the amount problem?

B2 has friend names but not 'Swiggy, Ola, rent'. Clips A got right and B2 did not: `b-hi-grocery`, `fresh-synth-ta-3`.
B has the same problem on: `b-hi-grocery`, `fresh-synth-ta-3`.
So on these clips the problem appears without the three extra words. Adding friend names is enough. This is a small sample.

### Second pass and how the amount was written

When Whisper detects Hindi or Tamil but writes no Hindi or Tamil script, the app listens again in that language. That second-pass hint is written in number words. C's digit ending only changed the first-pass hint.

| Variant | Second pass used: digits | Second pass used: anything else | First pass only: digits | First pass only: anything else |
|---|---|---|---|---|
| A | 0 | 1 | 38 | 2 |
| B | 13 | 3 | 24 | 1 |
| B2 | 10 | 3 | 27 | 1 |
| C | 6 | 9 | 25 | 1 |

This shows a pattern, not a proven cause. The clips that reach a second pass are not a random sample.


## 3. Names in the transcript

`yes` means the name is certainly there in any script, using the benchmark's matching. 17 of the 30 existing clips have an empty friend list, so B, B2 and C had no names to add on those.

### Existing clips

| Variant | Yes | No | Uncertain |
|---|---|---|---|
| A | **48/52** | 3/52 | 1/52 |
| B | **49/52** | 3/52 | 0/52 |
| B2 | **49/52** | 3/52 | 0/52 |
| C | **49/52** | 2/52 | 1/52 |
| E | **50/52** | 1/52 | 1/52 |

### Fresh clips (synthetic, all number words)

| Variant | Yes | No | Uncertain |
|---|---|---|---|
| A | **14/18** | 4/18 | 0/18 |
| B | **14/18** | 4/18 | 0/18 |
| B2 | **14/18** | 4/18 | 0/18 |
| C | **16/18** | 2/18 | 0/18 |
| E | **17/18** | 1/18 | 0/18 |

### All clips

| Variant | Yes | No | Uncertain |
|---|---|---|---|
| A | **62/70** | 7/70 | 1/70 |
| B | **63/70** | 7/70 | 0/70 |
| B2 | **63/70** | 7/70 | 0/70 |
| C | **65/70** | 4/70 | 1/70 |
| E | **67/70** | 2/70 | 1/70 |

### Is any name difference within noise?

| Clips | Pair | First yes, second not | Second yes, first not | Left out (uncertain) | Verdict |
|---|---|---|---|---|---|
| Existing clips | A vs B | 1 | 2 | 1 | p=1.000, within noise |
| Existing clips | A vs C | 1 | 2 | 1 | p=1.000, within noise |
| Existing clips | B vs C | 0 | 0 | 1 | p=1.000, within noise |
| Existing clips | E vs A | 2 | 0 | 1 | p=0.500, within noise |
| Existing clips | E vs B | 1 | 0 | 1 | p=1.000, within noise |
| Existing clips | E vs C | 1 | 0 | 1 | p=1.000, within noise |
| Fresh clips (synthetic, all number words) | A vs B | 3 | 3 | 0 | p=1.000, within noise |
| Fresh clips (synthetic, all number words) | A vs C | 2 | 4 | 0 | p=0.688, within noise |
| Fresh clips (synthetic, all number words) | B vs C | 0 | 2 | 0 | p=0.500, within noise |
| Fresh clips (synthetic, all number words) | E vs A | 3 | 0 | 0 | p=0.250, within noise |
| Fresh clips (synthetic, all number words) | E vs B | 4 | 1 | 0 | p=0.375, within noise |
| Fresh clips (synthetic, all number words) | E vs C | 2 | 1 | 0 | p=1.000, within noise |
| All clips | A vs B | 4 | 5 | 1 | p=1.000, within noise |
| All clips | A vs C | 3 | 6 | 1 | p=0.508, within noise |
| All clips | B vs C | 0 | 2 | 1 | p=0.500, within noise |
| All clips | E vs A | 5 | 0 | 1 | p=0.062, within noise |
| All clips | E vs B | 5 | 1 | 1 | p=0.219, within noise |
| All clips | E vs C | 3 | 1 | 1 | p=0.625, within noise |

### Every name

| Clip | Name | A | B | B2 | C | E |
|---|---|---|---|---|---|---|
| `b-inen-petrol-exclude` | Arun | yes | yes | yes | yes | yes |
| `b-inen-petrol-exclude` | Ravi | yes | yes | yes | yes | yes |
| `b-inen-petrol-exclude` | Suresh | yes | yes | yes | yes | yes |
| `b-tg-dinner` | Ravi | yes | yes | yes | yes | yes |
| `b-tg-dinner` | Suresh | yes | yes | yes | yes | yes |
| `b-hg-dinner` | Rahul | yes | yes | yes | yes | yes |
| `b-hg-dinner` | Amit | yes | yes | yes | yes | yes |
| `b-en-other-payer` | Ravi | yes | yes | yes | yes | yes |
| `b-en-other-payer` | Kavya | yes | yes | yes | yes | yes |
| `b-hi-hotel` | Ravi | uncertain | no | no | uncertain | uncertain |
| `b-hi-hotel` | Amit | yes | yes | yes | yes | yes |
| `b-ta-petrol` | Suresh | yes | yes | yes | yes | yes |
| `b-en-treat` | Arun | yes | yes | yes | yes | yes |
| `b-en-treat` | Ravi | yes | yes | yes | yes | yes |
| `b-hg-dedh-hazaar` | Priya | yes | yes | yes | yes | yes |
| `b-en-exact` | Ravi | yes | yes | yes | yes | yes |
| `b-inen-chai` | Karthik | yes | yes | yes | yes | yes |
| `b-inen-chai` | Divya | yes | yes | yes | yes | yes |
| `b-hg-party-exclude` | Rohit | yes | yes | yes | yes | yes |
| `b-hg-party-exclude` | Neha | yes | yes | yes | yes | yes |
| `b-hg-party-exclude` | Vikram | yes | yes | yes | yes | yes |
| `b-en-percent` | Meena | yes | yes | yes | yes | yes |
| `b-hi-grocery` | Neha | yes | yes | yes | yes | yes |
| `b-tg-swiggy-k` | Akash | yes | yes | yes | yes | yes |
| `b-tg-swiggy-k` | Priya | yes | yes | yes | yes | yes |
| `b-en-known-names` | Venkat | yes | yes | yes | yes | yes |
| `b-en-known-names` | Lakshmi | yes | yes | yes | yes | yes |
| `b-ta-digits` | Arun | yes | yes | yes | yes | yes |
| `b-ta-digits` | Ravi | yes | yes | yes | yes | yes |
| `b-hg-other-payer` | Rahul | yes | yes | yes | yes | yes |
| `b-hg-other-payer` | Sameer | yes | yes | yes | yes | yes |
| `b-inen-rs` | Sneha | yes | yes | yes | yes | yes |
| `b-inen-lakh` | Arjun | yes | yes | yes | yes | yes |
| `b-inen-lakh` | Karthik | yes | yes | yes | yes | yes |
| `b-hg-chhod-ke` | Ankit | yes | yes | yes | yes | yes |
| `b-hg-chhod-ke` | Pooja | yes | yes | yes | yes | yes |
| `b-hg-chhod-ke` | Rajat | yes | yes | yes | yes | yes |
| `b-inen-myself` | Ganesh | yes | yes | yes | yes | yes |
| `b-inen-myself` | Sathish | no | no | no | no | no |
| `b-en-pronoun-her` | Anjali | yes | yes | yes | yes | yes |
| `b-en-pronoun-her` | Rohan | yes | yes | yes | yes | yes |
| `b-hi-drinks` | Rahul | yes | yes | yes | yes | yes |
| `b-hi-drinks` | Amit | yes | yes | yes | yes | yes |
| `b-hi-drinks` | Sumit | yes | yes | yes | yes | yes |
| `b-en-group-unsaid` | Meena | yes | no | no | no | yes |
| `b-en-soundalike` | Priya | yes | yes | yes | yes | yes |
| `b-en-soundalike` | Karthik | yes | yes | yes | yes | yes |
| `b-tg-soundalike` | Karthika | yes | yes | yes | yes | yes |
| `b-tg-soundalike` | Divya | no | yes | yes | yes | yes |
| `b-hg-friends-unsaid` | Rohit | yes | yes | yes | yes | yes |
| `b-en-payer-unsaid` | Senthil | no | yes | yes | yes | yes |
| `b-en-payer-unsaid` | Pooja | yes | yes | yes | yes | yes |
| `fresh-synth-hi-1` | Arjun | yes | no | no | no | yes |
| `fresh-synth-hi-1` | Ganesh | no | yes | yes | yes | yes |
| `fresh-synth-hi-2` | Rahul | yes | yes | yes | yes | yes |
| `fresh-synth-hi-3` | Vijay | yes | yes | yes | yes | yes |
| `fresh-synth-hi-4` | Karthika | yes | yes | yes | yes | yes |
| `fresh-synth-hi-4` | Sneha | yes | yes | yes | yes | yes |
| `fresh-synth-hi-5` | Priyanka | yes | yes | yes | yes | yes |
| `fresh-synth-hi-5` | Divya | yes | yes | yes | yes | yes |
| `fresh-synth-ta-1` | Amit | no | yes | yes | yes | no |
| `fresh-synth-ta-2` | Kavya | yes | yes | yes | yes | yes |
| `fresh-synth-ta-2` | Meena | yes | yes | yes | yes | yes |
| `fresh-synth-ta-3` | Priya | yes | no | no | yes | yes |
| `fresh-synth-ta-3` | Anjali | no | no | no | yes | yes |
| `fresh-synth-ta-4` | Priya | yes | no | yes | no | yes |
| `fresh-synth-ta-4` | Ganesh | no | yes | no | yes | yes |
| `fresh-synth-en-1` | Pooja | yes | yes | yes | yes | yes |
| `fresh-synth-en-2` | Karthik | yes | yes | yes | yes | yes |
| `fresh-synth-en-3` | Ganesh | yes | yes | yes | yes | yes |

### Names in the transcript that were never said

- `fresh-synth-hi-1` B: Arun: मैंने खाने के लिए 300 रुपये दिए, Arun और Ganesh के साथ ना तो।
- `fresh-synth-hi-1` B2: Arun: मैंने खाने के लिए 300 रुपये दिए, Arun और Ganesh के साथ ना तो।
- `fresh-synth-hi-1` C: Arun: मैंने खाने के लिए तीन सौ रुपये दिए, Arun और Ganesh के साथ दातो।

## 4. Variant E: A's transcript plus offline name correction

**The rule.** Only words close to a name on that clip's own friend list can change, in English letters, Hindi or Tamil script. Digits, number words and exact spellings of a friend are never touched. A change needs the same first letter, a word of at least 4 characters, and an edit distance of 1 (2 in English letters if the consonant outline also matches). Two adjacent capitalised words can merge if their consonant outline matches. If two friends tie, nothing changes.

**Changes made: 5. Right: 5. Wrong: 0.** Digits and number words unchanged on 42/42 clips.

| Clip | Set | From | To | Right? |
|---|---|---|---|---|
| `b-tg-soundalike` | existing | devya | Divya | yes |
| `b-en-payer-unsaid` | existing | Saint Thil | Senthil | yes |
| `fresh-synth-hi-1` | fresh | गनेश | Ganesh | yes |
| `fresh-synth-ta-3` | fresh | அஞ்جலி | Anjali | yes |
| `fresh-synth-ta-4` | fresh | கனேஷ் | Ganesh | yes |

### Cases where E wrongly changed a word

None on the real friend lists.

### Harsher check: all 32 names on every clip's friend list

6 changes, 0 wrong.

No wrong changes.

### Limits of E

- **Written after reading these transcripts,** so its results here are in-sample and likely optimistic.
- **Native-script fixes rely on `bench/name_aliases.json`,** a hand-made list. The app has no such list for a real user's friends.
- **E can't help on the clips with an empty friend list,** and only fixes near-misses. It can't recover `रविवार`, or `அமிக்கூட` where a name and a word merged.
- A real friend whose name is close to another word could be changed wrongly; the 32-name check above tests this only on these clips.

## How to read this

**The fresh clips, like the existing ones, are computer voices reading clean text.** They are a stress test of the prompts and are not evidence about real speakers.
- Whisper repeats itself on the same clip and prompt, so these differences are real for these clips. Noise means too few clips to generalise.
- C's prompt was frozen before the fresh clips existed. The parser and E were written after reading the transcripts.
- Only the main amount is scored. A secondary amount, such as C writing `छैसो` for the 600 of drinks in `b-hi-drinks`, is not scored but appears in the transcript.
