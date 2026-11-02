#!/usr/bin/env python3
"""Speaking Lab — 콘텐츠 YAML 검증기 (P0 뼈대).

사용법 (리포 루트에서):
  python3 tools/validate_content.py content/toeic/sets/set01.yaml
  python3 tools/validate_content.py --all
종료 코드: 0 = 통과, 1 = 오류 있음. 필요: PyYAML.
"""
from __future__ import annotations
import argparse, glob, os, sys
try:
    import yaml
except ImportError:
    sys.exit("PyYAML이 필요해요: pip3 install pyyaml")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FMT = yaml.safe_load(open(os.path.join(ROOT, "schema/exam_formats.yaml"), encoding="utf-8"))
LIM = yaml.safe_load(open(os.path.join(ROOT, "schema/limits.yaml"), encoding="utf-8"))
STATUS = {"draft", "ready", "reviewed"}


def toeic_type_of(no: int) -> str | None:
    for p in FMT["toeic"]["parts"]:
        if no in p["items"]:
            return p["type"]
    return None


def check_len(errs, where, val, limit):
    if isinstance(val, str) and len(val) > limit:
        errs.append(f"{where}: {len(val)}자 > {limit}자")


def validate_toeic(d, errs):
    items = d.get("items") or []
    if len(items) != FMT["toeic"]["total_items"]:
        errs.append(f"items: {len(items)}개 (11개여야 해요)")
    for i, it in enumerate(items):
        no = it.get("no")
        w = f"items[{i}] (Q{no})"
        if no != i + 1:
            errs.append(f"{w}: 번호가 순서와 달라요")
        want = toeic_type_of(no) if isinstance(no, int) else None
        if it.get("type") != want:
            errs.append(f"{w}: type={it.get('type')} (Q{no}는 {want})")
        t = it.get("type")
        if t == "read_aloud" and not it.get("text"):
            errs.append(f"{w}: text가 없어요")
        if t == "describe_photo" and not it.get("image"):
            errs.append(f"{w}: image가 없어요")
        if t in {"respond_q", "info_based", "opinion"} and not it.get("question"):
            errs.append(f"{w}: question이 없어요")
        if t != "read_aloud" and not (it.get("model") or {}).get("l7"):
            errs.append(f"{w}: model.l7이 없어요")
        check_len(errs, f"{w}.text", it.get("text"), LIM["toeic"]["read_aloud_text"])
        check_len(errs, f"{w}.question", it.get("question"), LIM["toeic"]["question"])
        check_len(errs, f"{w}.tip_ko", it.get("tip_ko"), LIM["toeic"]["tip_ko"])
        for k, v in (it.get("model") or {}).items():
            check_len(errs, f"{w}.model.{k}", v, LIM["toeic"]["model_answer"])
    ctx = {it.get("context") for it in items if it.get("type") == "respond_q"}
    if len(ctx) > 1:
        errs.append("Q5~7: context가 하나여야 해요")


def validate_opic(d, errs):
    types = set(FMT["opic"]["item_types"])
    for i, q in enumerate(d.get("questions") or []):
        w = f"questions[{i}] ({q.get('id')})"
        if q.get("type") not in types:
            errs.append(f"{w}: type={q.get('type')} 은(는) 없는 유형이에요")
        if not q.get("question"):
            errs.append(f"{w}: question이 없어요")
        lv = q.get("level") or []
        if not lv or any(not (1 <= x <= FMT["opic"]["self_assessment_levels"]) for x in lv):
            errs.append(f"{w}: level은 1~6 사이 목록이어야 해요")
        check_len(errs, f"{w}.question", q.get("question"), LIM["opic"]["question"])
        for k, v in (q.get("model") or {}).items():
            check_len(errs, f"{w}.model.{k}", v, LIM["opic"]["model_answer"])


def validate(path: str) -> list[str]:
    errs: list[str] = []
    d = yaml.safe_load(open(path, encoding="utf-8")) or {}
    if d.get("schema_version") != 1:
        errs.append("schema_version: 1 이어야 해요")
    if d.get("status") not in STATUS:
        errs.append(f"status: {d.get('status')} (draft/ready/reviewed)")
    if "/toeic/" in path.replace(os.sep, "/"):
        validate_toeic(d, errs)
    elif "/opic/topics/" in path.replace(os.sep, "/"):
        validate_opic(d, errs)
    return errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="*")
    ap.add_argument("--all", action="store_true")
    a = ap.parse_args()
    files = a.files
    if a.all:
        files = sorted(glob.glob(os.path.join(ROOT, "content/toeic/sets/*.yaml")) +
                       glob.glob(os.path.join(ROOT, "content/opic/topics/*.yaml")))
    if not files:
        print("검사할 파일이 없어요.")
        return 0
    bad = 0
    for f in files:
        errs = validate(f)
        rel = os.path.relpath(f, ROOT)
        print(f"{'OK ' if not errs else 'ERR'} {rel}" + (f" — 오류 {len(errs)}" if errs else ""))
        for e in errs:
            print("    -", e)
        bad += bool(errs)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
