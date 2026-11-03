#!/usr/bin/env python3
"""테스트용: 가상 학생 글(tests/fixtures/student_*.yaml)로 transcript.json을 만들어요(engine: fixture).
실제 전사는 tools/transcribe.py(로컬 Whisper)로 해요. 이 스크립트는 Whisper 없이 흐름을 확인할 때만 써요.

사용법:  python3 tests/make_transcript.py tests/fixtures/student_set01.yaml <제출 폴더>
"""
import datetime as dt, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
from teacher_common import load_json, load_yaml, save_json, ROOT
from transcribe import compute_stats, FILLERS


def fake_words(text):
    t, words = 0.9, []
    for raw in text.split():
        if raw == "<pause>":
            t += 1.6; continue
        clean = raw.strip(".,?!").lower()
        if clean in FILLERS:
            t += 0.9
        words.append({"w": raw, "start": round(t, 2), "end": round(t + 0.32, 2)})
        t += 0.40 + (0.30 if raw[-1] in ".,?!" else 0)
    return words


def main():
    src, folder = sys.argv[1], sys.argv[2]
    answers = load_yaml(src)
    att = load_json(os.path.join(folder, "attempt.json"))
    fmt = load_yaml(os.path.join(ROOT, "schema/exam_formats.yaml"))[att["exam"]]["parts"]
    speak = {n: p["speak"][p["items"].index(n)] for p in fmt for n in p["items"]}
    items = []
    for it in att["items"]:
        text = answers.get(it["num"], "")
        words = fake_words(text)
        dur = float(speak[it["num"]])
        items.append({"num": it["num"], "file": it["file"], "duration_s": dur,
                      "text": " ".join(w["w"] for w in words), "words": words, "stats": compute_stats(words, dur)})
    save_json(os.path.join(folder, "transcript.json"),
              {"engine": "fixture", "model": os.path.basename(src), "created_at": dt.datetime.now().isoformat(timespec="seconds"), "items": items})
    print(f"테스트용 전사본: {os.path.join(folder, 'transcript.json')} ({len(items)}문항)")


if __name__ == "__main__":
    main()
