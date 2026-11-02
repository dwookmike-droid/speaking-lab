#!/usr/bin/env python3
"""콘텐츠 YAML → app/data/*.json. 검증기를 먼저 통과해야 빌드해요.

사용법 (리포 루트에서):  python3 tools/build.py
"""
from __future__ import annotations
import glob, json, os, subprocess, sys
import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return yaml.safe_load(f)


def main() -> int:
    v = subprocess.run([sys.executable, os.path.join(ROOT, "tools/validate_content.py"), "--all"])
    if v.returncode:
        print("검증 오류가 있어서 빌드하지 않았어요.")
        return 1
    fmt, lv = load("schema/exam_formats.yaml"), load("schema/answer_levels.yaml")
    directions = load("content/toeic/directions.yaml")
    directions.pop("schema_version", None)
    checklists = load("content/toeic/checklists.yaml")
    checklists.pop("schema_version", None)
    sets = []
    for path in sorted(glob.glob(os.path.join(ROOT, "content/toeic/sets/*.yaml"))):
        d = yaml.safe_load(open(path, encoding="utf-8"))
        sets.append({k: d.get(k) for k in ("id", "title_ko", "status", "items")})
    out = {
        "format": fmt["toeic"],
        "levels": lv["toeic"],
        "directions": directions,
        "checklists": checklists,
        "sets": sets,
    }
    os.makedirs(os.path.join(ROOT, "app/data"), exist_ok=True)
    dst = os.path.join(ROOT, "app/data/toeic.json")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"빌드: {os.path.relpath(dst, ROOT)} (세트 {len(sets)}개, {os.path.getsize(dst)//1024}KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
