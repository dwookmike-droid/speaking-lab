#!/usr/bin/env python3
"""보유 기간이 지난 학생 자료를 찾아 지워요(동의서 retention 기준). 기본은 목록만 보여 줘요.

사용법:
  python3 tools/purge.py                      # 지울 대상 보기
  python3 tools/purge.py --apply              # 실제로 지우기
  python3 tools/purge.py --student S003 --now --apply   # 동의 철회: 기한과 상관없이 바로 지우기
"""
from __future__ import annotations
import argparse, datetime as dt, glob, os, re, shutil, sys
from teacher_common import ROOT, STUDENTS, SUBMISSIONS, load_roster, load_yaml, save_roster


def retention_months() -> int:
    files = sorted(glob.glob(os.path.join(ROOT, "content/legal/consent_v*.yaml")))
    m = re.search(r"(\d+)\s*개월", load_yaml(files[-1])["retention"]) if files else None
    return int(m.group(1)) if m else 3


def add_months(d: dt.date, n: int) -> dt.date:
    y, mo = divmod(d.month - 1 + n, 12)
    import calendar
    day = min(d.day, calendar.monthrange(d.year + y, mo + 1)[1])
    return dt.date(d.year + y, mo + 1, day)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--student")
    ap.add_argument("--now", action="store_true", help="보유 기간과 상관없이(동의 철회)")
    ap.add_argument("--today", help="기준일 YYYY-MM-DD (확인용)")
    a = ap.parse_args()
    today = dt.date.fromisoformat(a.today) if a.today else dt.date.today()
    months = retention_months()
    r = load_roster()
    targets = []
    for s in r["students"]:
        if s.get("purged") or (a.student and s["id"] != a.student):
            continue
        if a.now and a.student:
            targets.append((s, "동의 철회"))
        elif s.get("ended"):
            due = add_months(dt.date.fromisoformat(str(s["ended"])), months)
            if today >= due:
                targets.append((s, f"수업 종료 {s['ended']} + {months}개월 = {due}"))
    if not targets:
        print("지울 대상이 없어요.")
        return 0
    for s, why in targets:
        paths = [p for p in (os.path.join(STUDENTS, s["id"]), os.path.join(SUBMISSIONS, s["id"])) if os.path.exists(p)]
        print(f"{s['id']}  ({why})  →  {', '.join(os.path.relpath(p, ROOT) for p in paths) or '폴더 없음'} + 명단의 개인정보")
        if a.apply:
            for p in paths:
                shutil.rmtree(p)
            keep = {k: s.get(k) for k in ("id", "started", "ended")}
            s.clear(); s.update(keep); s["purged"] = today.isoformat()
    if a.apply:
        save_roster(r)
        print("지웠어요. 명단에는 학생 번호와 날짜만 남겼어요.")
    else:
        print("실제로 지우려면 --apply를 붙여요.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
