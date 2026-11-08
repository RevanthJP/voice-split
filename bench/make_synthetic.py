"""Make the synthetic audio set from bench/text.json with the Mac's built-in Indian voices.

Run: python3 bench/make_synthetic.py      (macOS only, free, no network)

Voices: Rishi (Indian English), Lekha (Hindi), Vani (Tamil). These are computer voices reading
clean text in a quiet room, so they test the pipeline, not real-world accuracy. Real recordings
from real people go in bench/audio/real/ (see bench/README.md).
"""
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE / "audio" / "synthetic"
OUT.mkdir(parents=True, exist_ok=True)
manifest = []
for case in json.load(open(HERE / "text.json", encoding="utf-8")):
    if not case.get("voice"):
        continue
    wav = OUT / f"{case['id']}.wav"
    subprocess.run(["say", "-v", case["voice"], "-o", str(wav), "--data-format=LEI16@16000", case["text"]], check=True)
    manifest.append({"file": f"synthetic/{wav.name}", "case": case["id"], "kind": "synthetic",
                     "voice": case["voice"], "reference": case["text"]})
json.dump(manifest, open(HERE / "audio" / "synthetic.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(len(manifest), "clips written to", OUT)
