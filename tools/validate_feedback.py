#!/usr/bin/env python3
"""feedback.yaml 검증: 형식, 레벨, 전사본과 맞는지, 그리고 개인정보가 섞이지 않았는지.

사용법:  python3 tools/validate_feedback.py submissions/S001/a123
종료 코드: 0 = 통과, 1 = 오류.
"""
from __future__ import annotations
import os, re, sys
from teacher_common import attempt_items, levels, load_json, load_roster, load_yaml, resolve_attempt_dir

HANGUL = re.compile(r"[가-힣]")
PRON = {"check", "ok", "note"}


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9' ]", " ", str(s).lower())).strip()


def pii_terms(student_id: str) -> list[str]:
    e = next((s for s in load_roster()["students"] if s.get("id") == student_id), None)
    if not e:
        return []
    terms = [e.get("name"), e.get("email"), (e.get("email") or "").split("@")[0], e.get("phone")]
    g = e.get("guardian") or {}
    terms += [g.get("name"), g.get("phone")]
    out = []
    for t in terms:
        t = str(t or "").strip()
        if len(t) >= 2:
            out.append(t)
            if re.search(r"\d", t):
                out.append(re.sub(r"\D", "", t))          # 숫자만 쓴 전화번호도 잡아요
            if " " in t:
                out.append(t.replace(" ", ""))
    return [t for t in out if len(t) >= 2]


def validate(folder: str) -> tuple[list[str], list[str]]:
    errs, warns = [], []
    fp = os.path.join(folder, "feedback.yaml")
    if not os.path.exists(fp):
        return [f"{fp}가 없어요"], []
    raw = open(fp, encoding="utf-8").read()
    try:
        fb = load_yaml(fp) or {}
    except Exception as e:                                    # YAML 문법 오류는 줄 번호만 알려 줘요
        mark = getattr(e, "problem_mark", None)
        return [f"feedback.yaml YAML 문법 오류{f' ({mark.line + 1}번째 줄)' if mark else ''}: "
                f"따옴표로 시작하는 문장은 전체를 작은따옴표로 감싸요"], []
    att = load_json(os.path.join(folder, "attempt.json"))
    tpath = os.path.join(folder, "transcript.json")
    tr = load_json(tpath) if os.path.exists(tpath) else None
    if not tr:
        errs.append("transcript.json이 없어요. 전사본 없이 쓴 피드백은 받지 않아요")
        tr = {"items": []}
    lv = levels(att["exam"])
    types = {n: q.get("type") for n, q in attempt_items(att).items()}
    said_src = {it["num"]: norm(it.get("text", "")) for it in tr["items"]}

    if fb.get("schema_version") != 1:
        errs.append("schema_version: 1 이어야 해요")
    for k in ("student_id", "attempt_id", "set_id", "target"):
        want = att["student_id" if k == "student_id" else k]
        if fb.get(k) != want:
            errs.append(f"{k}: {fb.get(k)!r} (attempt.json은 {want!r})")

    def ko(where, v, lim, required=True):
        if not v:
            if required:
                errs.append(f"{where}: 비어 있어요")
            return
        if not HANGUL.search(str(v)):
            errs.append(f"{where}: 한국어로 써요")
        if len(str(v)) > lim:
            errs.append(f"{where}: {len(str(v))}자 > {lim}자")

    o = fb.get("overall") or {}
    if o.get("est_level") not in lv:
        errs.append(f"overall.est_level: {o.get('est_level')} ({', '.join(lv)} 중 하나)")
    ko("overall.summary_ko", o.get("summary_ko"), 300)
    for k, lo, hi in (("strengths_ko", 1, 3), ("priorities_ko", 1, 3)):
        xs = o.get(k) or []
        if not (lo <= len(xs) <= hi):
            errs.append(f"overall.{k}: {len(xs)}개 ({lo}~{hi}개)")
        for i, x in enumerate(xs):
            ko(f"overall.{k}[{i}]", x, 160)

    seen = set()
    for i, it in enumerate(fb.get("items") or []):
        n = it.get("num"); w = f"items[{i}] (Q{n})"
        if n in seen:
            errs.append(f"{w}: 같은 문항이 두 번 있어요")
        seen.add(n)
        if n not in types:
            errs.append(f"{w}: 세트에 없는 문항이에요"); continue
        if n not in said_src:
            errs.append(f"{w}: 전사본에 없는 문항이에요(녹음이 없어요)")
        if types[n] != "read_aloud" and it.get("est_level") not in lv:
            errs.append(f"{w}: est_level이 없거나 틀렸어요")
        if it.get("est_level") and it["est_level"] not in lv:
            errs.append(f"{w}: est_level {it['est_level']}")
        good = it.get("good_ko") or []
        if not (1 <= len(good) <= 2):
            errs.append(f"{w}: good_ko {len(good)}개 (1~2개)")
        for j, x in enumerate(good):
            ko(f"{w}.good_ko[{j}]", x, 160)
        fixes = it.get("fixes") or []
        if len(fixes) > 3:
            errs.append(f"{w}: fixes {len(fixes)}개 (최대 3개)")
        for j, fx in enumerate(fixes):
            if not fx.get("said") or not fx.get("better"):
                errs.append(f"{w}.fixes[{j}]: said와 better가 모두 있어야 해요"); continue
            if norm(fx["said"]) not in said_src.get(n, ""):
                errs.append(f"{w}.fixes[{j}].said: 전사본에 없는 말이에요 — \"{fx['said']}\"")
            if norm(fx["said"]) == norm(fx["better"]):
                errs.append(f"{w}.fixes[{j}]: said와 better가 같아요")
            ko(f"{w}.fixes[{j}].why_ko", fx.get("why_ko"), 160)
        ko(f"{w}.next_ko", it.get("next_ko"), 160)
        if it.get("pronunciation") not in PRON:
            errs.append(f"{w}.pronunciation: check / ok / note 중 하나")
        if it.get("pronunciation") == "note" and not it.get("teacher_note_ko"):
            errs.append(f"{w}: pronunciation이 note면 teacher_note_ko를 써요")
        ko(f"{w}.teacher_note_ko", it.get("teacher_note_ko"), 200, required=False)
    for t in tr["items"]:
        if (t.get("stats") or {}).get("words") and t["num"] not in seen:
            warns.append(f"Q{t['num']}: 녹음이 있는데 피드백이 없어요")

    def values(x):                                            # 키 이름(student_id 등)은 빼고 쓴 값만 모아요
        if isinstance(x, dict):
            return [v for y in x.values() for v in values(y)]
        if isinstance(x, list):
            return [v for y in x for v in values(y)]
        return [str(x)] if x is not None else []
    low = "\n".join(values(fb)).lower()
    for term in pii_terms(att["student_id"]):
        t = term.lower()
        # 한글 이름은 글자 그대로, 영문·숫자(이메일 아이디, 번호)는 단어 단위로 찾아요("student" ≠ "students")
        hit = t in low if HANGUL.search(t) else re.search(rf"(?<![a-z0-9]){re.escape(t)}(?![a-z0-9])", low)
        if hit:
            errs.append(f"개인정보가 들어 있어요: '{term[:2]}…' — 학생 번호만 써요")
    return errs, warns


def main() -> int:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    d = resolve_attempt_dir(sys.argv[1])
    errs, warns = validate(d)
    print(f"{'OK ' if not errs else 'ERR'} {os.path.relpath(d)}/feedback.yaml — 오류 {len(errs)} · 경고 {len(warns)}")
    for e in errs:
        print("    ✗", e)
    for e in warns:
        print("    !", e)
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
