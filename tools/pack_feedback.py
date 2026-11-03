#!/usr/bin/env python3
"""검증을 통과한 feedback.yaml → 학생에게 보낼 feedback.json (학생 번호도 빼요).

사용법:  python3 tools/pack_feedback.py submissions/S001/a123
"""
from __future__ import annotations
import datetime as dt, os, sys
from teacher_common import load_yaml, resolve_attempt_dir, save_json
from validate_feedback import validate


def main() -> int:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    d = resolve_attempt_dir(sys.argv[1])
    errs, _ = validate(d)
    if errs:
        print("검증 오류가 있어서 만들지 않았어요:")
        for e in errs:
            print("    ✗", e)
        return 1
    fb = load_yaml(os.path.join(d, "feedback.yaml"))
    out = {"type": "speaking_feedback", "version": 1, "attempt_id": fb["attempt_id"], "set_id": fb["set_id"],
           "target": fb["target"], "created_at": dt.datetime.now().isoformat(timespec="seconds"),
           "overall": fb["overall"],
           "items": [{k: v for k, v in it.items() if v not in (None, "", [])} for it in fb["items"]]}
    dst = os.path.join(d, f"speaking-lab_feedback_{fb['attempt_id']}.json")
    save_json(dst, out)
    print(f"만들었어요: {os.path.relpath(dst)}")
    print("이 파일을 학생에게 보내면, 학생 앱 홈의 '피드백 불러오기'로 열 수 있어요.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
