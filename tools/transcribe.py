#!/usr/bin/env python3
"""제출 녹음을 로컬 Whisper(faster-whisper)로 받아 적어요. 녹음은 이 컴퓨터 밖으로 나가지 않아요.

사용법:  python3 tools/transcribe.py submissions/S001/a123 [--model small.en]
처음 실행할 때 모델을 내려받아요(small.en 약 500MB). 설치: pip3 install -r tools/requirements-teacher.txt
"""
from __future__ import annotations
import argparse, datetime as dt, os, re, sys
from teacher_common import load_json, resolve_attempt_dir, save_json

FILLERS = {"uh", "um", "er", "ah", "erm", "hmm", "mm", "uhm", "umm", "uhh"}
# Whisper는 군말을 지우는 버릇이 있어요. 군말이 섞인 예시를 앞에 주면 덜 지워요.
PROMPT = "Um, so, uh, I think... you know, I usually, um, go there with my friends."


def compute_stats(words: list[dict], duration_s: float, pause_s: float = 1.0) -> dict:
    """words: [{"w", "start", "end"}] → 단어 수, 말한 시간, 분당 단어, 멈춤, 군말."""
    toks = [(re.sub(r"[^a-z']", "", w["w"].lower()), w) for w in words]
    fillers = [t for t, _ in toks if t in FILLERS]
    real = [w for t, w in toks if t and t not in FILLERS]
    if not words:
        return {"words": 0, "speak_s": 0.0, "wpm": 0.0, "first_word_s": None, "pauses_over_1s": 0,
                "longest_pause_s": 0.0, "fillers": 0, "filler_words": [], "silent_tail_s": round(duration_s, 1)}
    gaps = [b["start"] - a["end"] for a, b in zip(words, words[1:])]
    speak = max(0.01, words[-1]["end"] - words[0]["start"])
    return {
        "words": len(real),
        "speak_s": round(speak, 1),
        "wpm": round(len(real) / speak * 60, 1),
        "first_word_s": round(words[0]["start"], 2),
        "pauses_over_1s": sum(g > pause_s for g in gaps),
        "longest_pause_s": round(max(gaps, default=0.0), 1),
        "fillers": len(fillers),
        "filler_words": sorted(set(fillers)),
        "silent_tail_s": round(max(0.0, duration_s - words[-1]["end"]), 1),   # 시간이 남았는데 말을 멈춘 길이
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--model", default="small.en", help="tiny.en / base.en / small.en / medium.en")
    ap.add_argument("--device", default="auto")
    ap.add_argument("--compute-type", default="int8")
    a = ap.parse_args()
    d = resolve_attempt_dir(a.folder)
    att = load_json(os.path.join(d, "attempt.json"))
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        sys.exit("faster-whisper가 필요해요: pip3 install -r tools/requirements-teacher.txt")
    model = WhisperModel(a.model, device=a.device, compute_type=a.compute_type)
    out = {"engine": "faster-whisper", "model": a.model, "created_at": dt.datetime.now().isoformat(timespec="seconds"), "items": []}
    for it in att["items"]:
        path = os.path.join(d, it["file"])
        segs, info = model.transcribe(path, language="en", word_timestamps=True, initial_prompt=PROMPT,
                                      vad_filter=False, condition_on_previous_text=False)
        words = [{"w": w.word.strip(), "start": round(w.start, 2), "end": round(w.end, 2)} for s in segs for w in (s.words or [])]
        text = " ".join(w["w"] for w in words).strip()
        dur = round(info.duration, 1)
        stats = compute_stats(words, dur)
        out["items"].append({"num": it["num"], "file": it["file"], "duration_s": dur, "text": text, "words": words, "stats": stats})
        print(f"Q{it['num']:>2}  {stats['words']:>3}단어  {stats['wpm']:>5}wpm  멈춤 {stats['pauses_over_1s']}  군말 {stats['fillers']}  | {text[:60]}")
    save_json(os.path.join(d, "transcript.json"), out)
    print(f"저장: {os.path.relpath(os.path.join(d, 'transcript.json'))}")
    print(f"다음: Claude Code에서 \"speaking-feedback 스킬로 {os.path.relpath(d)} 피드백 써줘\"")
    return 0


if __name__ == "__main__":
    sys.exit(main())
