"""Four speech prompts over the same synthetic clips: A, B, B2 and C (bench/prompt_test/prompts.json).

Only the Whisper prompt changes. Everything else is the current app code, swapped from outside at run
time, so reader.py is not edited. All clips are synthetic: a stress test, not evidence about real speakers.

Steps, run from the project folder:
  python bench/prompt_test/experiment.py plan      no API calls: what the speech step will use
  python bench/prompt_test/experiment.py speech    Whisper only; safe to re-run, finished clips are skipped
  python bench/prompt_test/experiment.py usage     no API calls: how many readings are needed
  python bench/prompt_test/experiment.py read      main reading model only; stops at --max-calls, re-run to continue
  python bench/prompt_test/experiment.py report    no API calls: writes results/report.md
"""
import argparse
import hashlib
import json
import math
import re
import sys
import time
import unicodedata
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent))
import run as bench  # noqa: E402  (the existing benchmark: scoring and call tracking)

VARIANTS = ("A", "B", "B2", "C")
PAIRS = (("A", "B"), ("A", "B2"), ("B2", "B"), ("B", "C"), ("A", "C"))
SETS = ("existing", "fresh", "all")
READS_PER_DAY = 100  # about 200,000 tokens a day at about 2,000 tokens a reading
STRICT_P = 0.0025  # 0.05 shared across the 20 comparisons (5 pairs x 4 measures) reported for each clip set
SYNTHETIC_NOTE = ("**All clips are synthetic.** Computer voices reading clean text are a stress test of the prompt. "
                  "These results are not evidence about real speakers.")


class Stop(Exception):
    """The API refused because of a limit. Saved work stays; re-run later to continue."""


def frozen_prompts(folder=HERE):
    want = re.search(r"sha256 ([0-9a-f]{64})", (folder / "FREEZE.txt").read_text(encoding="utf-8")).group(1)
    raw = (folder / "prompts.json").read_bytes()
    if hashlib.sha256(raw).hexdigest() != want:
        sys.exit("prompts.json does not match FREEZE.txt: stopping.")
    return {k: v for k, v in json.loads(raw).items() if not k.startswith("_")}


def build_prompt(reader, spec, language, people):
    """The same name cleaning and token budget as the app; names are dropped first if the prompt runs over."""
    hint = spec["hints"][language or "auto"]

    def render(names):
        if not names or spec["names"] == "none":
            return hint
        listed = ", ".join(names)
        return f"Names: {listed}. {hint}" if spec["names"] == "before" else f"{hint} Names: {listed}."

    names = []
    for raw in people:
        name = reader._clean_name(raw)
        if not name or name == reader.ME or name.lower() in (n.lower() for n in names):
            continue
        if reader._tokens(render([*names, name])) > reader._PROMPT_BUDGET:
            break
        names.append(name)
    return render(names)


def use_variant(reader, spec):
    reader.speech_prompt = lambda language=None, people=(): build_prompt(reader, spec, language, people)


def all_clips(folder=HERE):
    cases = {c["id"]: c for c in bench.read_json(bench.HERE / "text.json")}
    out = []
    for c in bench.read_json(bench.HERE / "audio" / "synthetic.json"):
        out.append({"id": c["case"], "set": "existing", "path": bench.HERE / "audio" / c["file"], "reference": c["reference"],
                    "case": {**cases[c["case"]], "reference": c["reference"]}})
    for c in bench.read_json(folder / "clips.json"):
        out.append({"id": c["case"]["id"], "set": "fresh", "path": folder / c["file"], "reference": c["reference"],
                    "case": {**c["case"], "reference": c["reference"]}})
    return out


def amount_kind(clip):
    if "missing" in clip["case"]:
        return "none"
    return "digits" if re.search(r"\d", clip["reference"]) else "words"


def load(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    tmp.replace(path)


def step_speech(reader, clips, prompts, out, sleep=4.0):
    store = load(out / "speech.json")
    for clip in clips:
        for variant in VARIANTS:
            key = f"{variant}|{clip['id']}"
            if store.get(key, {}).get("status") == "ok":
                continue
            use_variant(reader, prompts[variant])
            people = clip["case"].get("people", [])
            text, secs, err = bench.transcribe(reader, clip["path"], people)
            if err and "RateLimit" in err:
                save(out / "speech.json", store)
                raise Stop(f"Whisper limit reached at {key}. Saved so far; re-run later to continue.")
            fields = bench.speech_fields()
            store[key] = {"variant": variant, "clip": clip["id"], "status": "error" if err else "ok", "error": err,
                          "text": text, "secs": secs, "prompt_first_pass": build_prompt(reader, prompts[variant], None, people),
                          "calls": fields["speech_first_calls"] + fields["speech_second_calls"],
                          "second_pass": fields["speech_second_calls"], "speech_calls": fields["speech_calls"]}
            save(out / "speech.json", store)
            print(f"{key}: {'ok' if not err else err} | {text!r}", flush=True)
            time.sleep(sleep * max(1, store[key]["calls"]))
    return store


def needed_readings(clips, store):
    """One reading per distinct (clip, transcript). Identical transcripts share it, so reading-model
    randomness can't create a difference between variants."""
    wanted = {}
    for clip in clips:
        for variant in VARIANTS:
            row = store.get(f"{variant}|{clip['id']}")
            if row and row["status"] == "ok" and row["text"]:
                wanted[f"{clip['id']}|{row['text']}"] = (clip, row["text"])
    return wanted


def step_read(reader, splits, clips, store, out, max_calls=90, sleep=8.0):
    missing = [f"{v}|{c['id']}" for c in clips for v in VARIANTS if store.get(f"{v}|{c['id']}", {}).get("status") != "ok"]
    if missing:
        sys.exit(f"{len(missing)} speech results are missing or failed. Run the speech step again first.")
    reader.LLM_MODELS[:] = reader.LLM_MODELS[:1]  # main model only: no backup, so no mixed-model comparison
    reads = load(out / "reads.json")
    calls = 0
    for key, (clip, text) in needed_readings(clips, store).items():
        if key in reads:
            continue
        if calls >= max_calls:
            print(f"Stopped at the {max_calls}-call cap. Re-run tomorrow to continue.", flush=True)
            return reads
        row = bench.reading_row(clip["case"], reader, splits, text, clip["case"].get("people", []))
        calls += 1
        if "RateLimit" in str(row.get("error", "")):
            save(out / "reads.json", reads)
            raise Stop("Reading model limit reached. Saved so far; re-run later to continue.")
        reads[key] = row
        save(out / "reads.json", reads)
        print(f"{key}: {'PASS' if row.get('final_ok') else 'FAIL'}", flush=True)
        time.sleep(sleep)
    print("All readings done.", flush=True)
    return reads


def punctuation_free(text):
    kept = "".join(" " if unicodedata.category(ch)[0] in "PS" and ch != "," else ch for ch in text or "").replace(",", "")
    return " ".join(kept.lower().split())


def sign_test(wins, losses):
    n = wins + losses
    if not n:
        return 1.0
    return min(1.0, 2 * sum(math.comb(n, k) for k in range(min(wins, losses) + 1)) / 2 ** n)


def verdict(wins, losses):
    p = sign_test(wins, losses)
    if p < STRICT_P:
        return f"p={p:.4f}, clear difference on these clips"
    return f"p={p:.3f}, suggestive only" if p < 0.05 else f"p={p:.3f}, within noise"


def table(clips, store, reads):
    """Clip -> variant -> outcome. A clip is dropped from every variant if any variant has no result."""
    rows, dropped = {}, {}
    for clip in clips:
        per = {}
        for variant in VARIANTS:
            s = store[f"{variant}|{clip['id']}"]
            if s["status"] != "ok":
                dropped[clip["id"]] = f"speech error in {variant}"
                break
            if not s["text"]:
                nothing = {"amount_ok": False if amount_kind(clip) != "none" else None,
                           "names_ok": False if amount_kind(clip) != "none" else None, "final_ok": False}
                per[variant] = {"text": "", **nothing}
                continue
            r = reads.get(f"{clip['id']}|{s['text']}")
            if r is None or r.get("error"):
                dropped[clip["id"]] = f"no reading in {variant}" + (f": {r['error']}" if r else "")
                break
            per[variant] = {"text": s["text"], "amount_ok": r.get("amount_ok"), "names_ok": r.get("names_ok"),
                            "final_ok": bool(r.get("final_ok")), "answered_by": r.get("answered_by")}
        else:
            rows[clip["id"]] = per
    return rows, dropped


def in_set(clips, name):
    return [c for c in clips if name == "all" or c["set"] == name]


MEASURES = (("Amount, digits", "amount_ok", "digits"), ("Amount, number words", "amount_ok", "words"),
            ("Names", "names_ok", None), ("Entry success", "final_ok", None))


def measure_rows(clips, rows, field, kind):
    return [c for c in clips if c["id"] in rows and (kind is None or amount_kind(c) == kind)
            and rows[c["id"]][VARIANTS[0]].get(field) is not None]


def previous_transcripts(results):
    found = {}
    for variant, label in (("A", "stageB-baseline-synth-audio"), ("B", "stageB-current-synth-audio")):
        path = results / f"{label}.json"
        if path.exists():
            found[variant] = {r["id"].split("/")[-1][:-4]: r.get("transcript") for r in json.loads(path.read_text(encoding="utf-8"))}
    return found


def write_report(clips, prompts, store, reads, out, earlier):
    rows, dropped = table(clips, store, reads)
    wrong_model = sorted(k for k, r in reads.items() if r.get("answered_by") not in ("primary", None))
    lines = ["# Speech-prompt experiment: A, B, B2, C", "", SYNTHETIC_NOTE, "",
             f"**Validity:** {'INVALID: a reading came from the backup model: ' + ', '.join(wrong_model) if wrong_model else 'every reading came from the main model (gpt-oss-20b).'}",
             "", "| Variant | What it is |", "|---|---|", *[f"| {v} | {prompts[v]['what']} |" for v in VARIANTS], ""]
    if dropped:
        lines += ["## Clips left out of every variant", "", *[f"- `{k}`: {v}" for k, v in dropped.items()], ""]
    for name in SETS:
        chosen = in_set(clips, name)
        lines += [f"## Counts: {name} clips ({len([c for c in chosen if c['id'] in rows])} scored)", "",
                  "| Measure | " + " | ".join(VARIANTS) + " |", "|---|" + "---|" * len(VARIANTS)]
        for title, field, kind in MEASURES:
            use = measure_rows(chosen, rows, field, kind)
            cells = [f"{sum(bool(rows[c['id']][v][field]) for c in use)}/{len(use)}" for v in VARIANTS]
            lines.append(f"| {title} | " + " | ".join(cells) + " |")
        lines += ["", f"### Is any difference within noise? ({name} clips)", "",
                  "Wins count only clips where one variant was right and the other wrong (exact sign test).", "",
                  "| Pair | Measure | First wins | Second wins | Verdict |", "|---|---|---|---|---|"]
        for x, y in PAIRS:
            for title, field, kind in MEASURES:
                use = measure_rows(chosen, rows, field, kind)
                wins = sum(bool(rows[c["id"]][x][field]) and not rows[c["id"]][y][field] for c in use)
                losses = sum(bool(rows[c["id"]][y][field]) and not rows[c["id"]][x][field] for c in use)
                lines.append(f"| {x} vs {y} | {title} | {wins} | {losses} | {verdict(wins, losses)} |")
        lines += ["", "| Pair | Transcripts differ (exact text) | Differ (punctuation ignored) |", "|---|---|---|"]
        for x, y in PAIRS:
            use = [c for c in chosen if c["id"] in rows]
            exact = sum(rows[c["id"]][x]["text"] != rows[c["id"]][y]["text"] for c in use)
            loose = sum(punctuation_free(rows[c["id"]][x]["text"]) != punctuation_free(rows[c["id"]][y]["text"]) for c in use)
            lines.append(f"| {x} vs {y} | {exact}/{len(use)} | {loose}/{len(use)} |")
        lines.append("")
    if earlier:
        lines += ["## Is this run repeating Stage B?", ""]
        for variant, old in earlier.items():
            same = [c for c in in_set(clips, "existing") if c["id"] in rows and old.get(c["id"]) is not None]
            match = sum(rows[c["id"]][variant]["text"] == old[c["id"]] for c in same)
            lines.append(f"- {variant}: {match}/{len(same)} transcripts identical to Stage B")
        lines.append("")
    lines += ["## Every clip whose transcript differs between variants", ""]
    for clip in clips:
        per = rows.get(clip["id"])
        if not per or len({per[v]["text"] for v in VARIANTS}) == 1:
            continue
        only_punctuation = len({punctuation_free(per[v]["text"]) for v in VARIANTS}) == 1
        lines += [f"### `{clip['id']}` ({clip['set']}){' (punctuation only)' if only_punctuation else ''}", "",
                  f"Reference: {clip['reference']}", "", "| Variant | Entry | Transcript |", "|---|---|---|",
                  *[f"| {v} | {'right' if per[v]['final_ok'] else 'wrong'} | {per[v]['text'] or '(nothing)'} |" for v in VARIANTS], ""]
    lines += ["## How to read this", "", SYNTHETIC_NOTE,
              "- Variant C was written after seeing `b-hi-grocery` fail, so its result on that clip is weak evidence. Its prompt was frozen before the fresh clips existed.",
              "- Whisper gives the same transcript for the same clip and prompt, so differences are real for these clips. Noise here means too few clips to generalise.",
              "- C as tested puts names before the hint. `_echoes_prompt` expects names after the hint, so it would need changing if C were chosen.", ""]
    report = "\n".join(lines)
    (out / "report.md").write_text(report, encoding="utf-8")
    return report


def main():
    p = argparse.ArgumentParser()
    p.add_argument("step", choices=["plan", "speech", "usage", "read", "report"])
    p.add_argument("--max-calls", type=int, default=90)
    args = p.parse_args()
    prompts = frozen_prompts()
    clips, out = all_clips(), HERE / "results"
    worst = len(clips) * len(VARIANTS)
    if args.step == "plan":
        print(f"{len(clips)} clips x {len(VARIANTS)} variants = {worst} first passes, at most {worst * 2} Whisper calls with second passes.")
        print(f"Free limits: 20 a minute, 2,000 a day; 7,200 audio seconds an hour. Worst case at 10 billed seconds a call: {worst * 20:,} s.")
        print("Readings are counted by the usage step once the transcripts exist.")
    elif args.step == "usage":
        store = load(out / "speech.json")
        done = load(out / "reads.json")
        wanted = needed_readings(clips, store)
        left = [k for k in wanted if k not in done]
        print(f"Speech results: {sum(r['status'] == 'ok' for r in store.values())}/{worst}, Whisper calls {sum(r['calls'] for r in store.values())}")
        print(f"Distinct transcripts needing a reading: {len(wanted)}. Done: {len(wanted) - len(left)}. Left: {len(left)}.")
        print(f"The daily reading limit is about {READS_PER_DAY}. Other Groq use today counts against it.")
        print("OVER a day's limit: split across days." if len(left) > 90 else "Fits within one day's cap of 90.")
    elif args.step == "report":
        print(write_report(clips, prompts, load(out / "speech.json"), load(out / "reads.json"), out, previous_transcripts(bench.RESULTS)))
    else:
        reader, splits = bench.load_code("current")
        try:
            if args.step == "speech":
                step_speech(reader, clips, prompts, out)
            else:
                step_read(reader, splits, clips, load(out / "speech.json"), out, args.max_calls)
        except Stop as stop:
            sys.exit(str(stop))


if __name__ == "__main__":
    main()
