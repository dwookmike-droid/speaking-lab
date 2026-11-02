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
LVL = yaml.safe_load(open(os.path.join(ROOT, "schema/answer_levels.yaml"), encoding="utf-8"))
STATUS = {"draft", "ready", "reviewed"}


def toeic_type_of(no: int) -> str | None:
    for p in FMT["toeic"]["parts"]:
        if no in p["items"]:
            return p["type"]
    return None


def toeic_speak_of(no: int) -> int | None:
    for p in FMT["toeic"]["parts"]:
        if no in p["items"]:
            return p["speak"][p["items"].index(no)]
    return None


def check_models(errs, warns, where, model, exam, words_key, draft):
    """목표 레벨별 답변: 레벨 빠짐·가짓수·단어 수 확인. draft면 빠짐·가짓수는 경고."""
    spec = LVL[exam]
    rng = spec["words"].get(words_key) or spec["words"].get("default")
    model = model or {}
    for k in model:
        if k not in spec["levels"]:
            errs.append(f"{where}.model.{k}: 없는 레벨이에요 ({', '.join(spec['levels'])})")
    short = []
    for lv in spec["levels"]:
        answers = model.get(lv) or []
        if len(answers) < spec["variants_min"]:
            short.append(f"{lv} {len(answers)}/{spec['variants_min']}")
        for j, a in enumerate(answers):
            text = a.get("text") if isinstance(a, dict) else a
            if not text:
                errs.append(f"{where}.model.{lv}[{j}]: text가 없어요")
                continue
            n = len(text.split())
            if rng and lv in rng and not (rng[lv][0] <= n <= rng[lv][1]):
                errs.append(f"{where}.model.{lv}[{j}]: {n}단어 (기준 {rng[lv][0]}~{rng[lv][1]})")
    if short:
        (warns if draft else errs).append(f"{where}: 레벨별 답변 가짓수 부족 — {', '.join(short)}")


def check_len(errs, where, val, limit):
    if isinstance(val, str) and len(val) > limit:
        errs.append(f"{where}: {len(val)}자 > {limit}자")


def validate_toeic(d, errs, warns):
    items = d.get("items") or []
    if len(items) != FMT["toeic"]["total_items"]:
        errs.append(f"items: {len(items)}개 (11개여야 해요)")
    for i, it in enumerate(items):
        no = it.get("num")
        w = f"items[{i}] (Q{no})"
        if no != i + 1:
            errs.append(f"{w}: num이 순서와 달라요")
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
        draft = d.get("status") == "draft"
        if t == "read_aloud":
            if not it.get("marks"):
                (warns if draft else errs).append(f"{w}: marks(끊어 읽기 표시)가 없어요")
        elif t:
            check_models(errs, warns, w, it.get("model"), "toeic", f"{t}_{toeic_speak_of(no)}", draft)
        check_len(errs, f"{w}.text", it.get("text"), LIM["toeic"]["read_aloud_text"])
        check_len(errs, f"{w}.question", it.get("question"), LIM["toeic"]["question"])
        check_len(errs, f"{w}.tip_ko", it.get("tip_ko"), LIM["toeic"]["tip_ko"])
    by = {it.get("num"): it for it in items}
    if 5 in by and not by[5].get("context"):
        errs.append("Q5: context(Q5~7 공통 상황)가 없어요")
    if 8 in by:
        info = by[8].get("info") or {}
        if not info.get("title") or not info.get("rows"):
            errs.append("Q8: info.title / info.rows(Q8~10 공통 자료)가 없어요")
        elif len(info["rows"]) > LIM["toeic"]["info_table_rows"]:
            errs.append(f"Q8: info.rows {len(info['rows'])}줄 > {LIM['toeic']['info_table_rows']}줄")
    for it in items:
        img = it.get("image")
        if img and not os.path.exists(os.path.join(ROOT, "app", img)):
            errs.append(f"Q{it.get('num')}: 이미지 파일이 없어요 (app/{img})")


def validate_opic(d, errs, warns):
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
        check_models(errs, warns, w, q.get("model"), "opic", q.get("type"), d.get("status") == "draft")


def validate(path: str):
    errs: list[str] = []
    warns: list[str] = []
    d = yaml.safe_load(open(path, encoding="utf-8")) or {}
    if d.get("schema_version") != 1:
        errs.append("schema_version: 1 이어야 해요")
    if d.get("status") not in STATUS:
        errs.append(f"status: {d.get('status')} (draft/ready/reviewed)")
    if "/toeic/" in path.replace(os.sep, "/"):
        validate_toeic(d, errs, warns)
    elif "/opic/topics/" in path.replace(os.sep, "/"):
        validate_opic(d, errs, warns)
    return errs, warns


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
        errs, warns = validate(f)
        rel = os.path.relpath(f, ROOT)
        print(f"{'OK ' if not errs else 'ERR'} {rel} — 오류 {len(errs)} · 경고 {len(warns)}")
        for e in errs:
            print("    ✗", e)
        for e in warns:
            print("    !", e)
        bad += bool(errs)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
