#!/usr/bin/env python3
"""Supabase(R&R archive) ↔ 선생님 컴퓨터. 선생님 계정으로 로그인해서 써요(관리자 키는 쓰지 않아요).

준비: 선생님 계정(R&R archive teachers 표에 있는 계정)의 이메일·비밀번호를 환경변수로 줘요. 파일에 적지 않아요.
  export SL_TEACHER_EMAIL=...   SL_TEACHER_PASSWORD=...

사용법:
  python3 tools/cloud_sync.py invite [--note "화요일 7시반"]   # 새 학생 등록 코드 (학생 번호 자동)
  python3 tools/cloud_sync.py pull                             # 새 제출 받기 → submissions/S00N/<응시ID>/, 철회 알림
  python3 tools/cloud_sync.py push submissions/S001/<응시ID>   # 피드백 검증·포장 후 올리기
  python3 tools/cloud_sync.py delete S001                      # 서버에서 학생 자료 지우기(보유 기간 끝·철회 처리)
"""
from __future__ import annotations
import argparse, datetime as dt, json, os, re, secrets, sys, urllib.error, urllib.parse, urllib.request
from teacher_common import ROOT, STUDENTS, SUBMISSIONS, load_json, load_roster, load_yaml, resolve_attempt_dir, save_json, save_roster

BUCKET = "speaking-audio"


def config():
    src = open(os.path.join(ROOT, "app/config.js"), encoding="utf-8").read()
    get = lambda k: re.search(rf"{k}:\s*'([^']*)'", src).group(1)
    url = os.environ.get("SL_SUPABASE_URL") or get("SUPABASE_URL")
    return url.rstrip("/"), get("SUPABASE_KEY")


class Cloud:
    def __init__(self):
        self.url, self.key = config()
        email, pw = os.environ.get("SL_TEACHER_EMAIL"), os.environ.get("SL_TEACHER_PASSWORD")
        if not email or not pw:
            sys.exit("SL_TEACHER_EMAIL, SL_TEACHER_PASSWORD 환경변수를 먼저 설정해 주세요.")
        j = self.call("POST", "/auth/v1/token?grant_type=password", {"email": email, "password": pw}, auth=False)
        self.token = j["access_token"]
        if not self.call("POST", "/rest/v1/rpc/is_teacher", {}):
            sys.exit("이 계정은 teachers 표에 없어요. 선생님 계정으로 로그인해 주세요.")

    def call(self, method, path, body=None, auth=True, headers=None, raw=False):
        h = {"apikey": self.key, "Authorization": f"Bearer {self.token if auth else self.key}", **(headers or {})}
        data = None
        if body is not None:
            data = json.dumps(body).encode(); h["Content-Type"] = "application/json"
        rq = urllib.request.Request(self.url + path, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(rq, timeout=60) as r:
                b = r.read()
                return b if raw else (json.loads(b) if b else None)
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors="replace")
            raise SystemExit(f"서버 오류 {e.code} ({method} {path.split('?')[0]}): {msg[:300]}")

    def get(self, table, query):
        return self.call("GET", f"/rest/v1/{table}?{query}")


def cmd_invite(c: Cloud, a):
    used = [r["code"] for r in c.get("speaking_students", "select=code")] + [r["student_code"] for r in c.get("speaking_invites", "select=student_code")]
    nums = [int(x[1:]) for x in used if re.fullmatch(r"S\d+", x)] + [int(s["id"][1:]) for s in load_roster()["students"] if re.fullmatch(r"S\d+", s.get("id", ""))]
    sc = f"S{(max(nums) + 1) if nums else 1:03d}"
    code = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(8))   # 헷갈리는 0/O, 1/I 빼고
    c.call("POST", "/rest/v1/speaking_invites", {"code": code, "student_code": sc, "note": a.note}, headers={"Prefer": "return=minimal"})
    print(f"학생 번호 {sc} · 등록 코드 {code}  (14일 동안 한 번만 쓸 수 있어요)")
    print("학생에게: 앱에서 '처음 왔어요' → 아이디·PIN을 정하고 이 등록 코드를 넣어요.")


def cmd_pull(c: Cloud, a):
    r = load_roster()
    students = {s["id"]: s for s in c.get("speaking_students", "select=id,code,login_id,profile,consent,consent_history,withdrawn_at,created_at")}
    # 명단 맞추기 (이름·연락처는 students/에만)
    for s in students.values():
        e = next((x for x in r["students"] if x.get("id") == s["code"]), None)
        if not e:
            e = {"id": s["code"], "started": s["created_at"][:10], "ended": None}; r["students"].append(e)
        if s["withdrawn_at"]:
            if not e.get("withdrawn_at") and not e.get("purged"):
                print(f"⚠ {s['code']}가 {s['withdrawn_at'][:10]}에 동의를 철회했어요 → python3 tools/purge.py --student {s['code']} --now --apply 와 cloud_sync.py delete {s['code']}")
            e["withdrawn_at"] = s["withdrawn_at"]; continue
        p = s["profile"] or {}
        e.update({"login_id": s["login_id"], "name": p.get("name"), "phone": p.get("phone"), "under14": bool(p.get("under14")),
                  "guardian": p.get("guardian"), "exams": p.get("exams"), "targets": p.get("targets"), "consent": s["consent"]})
    save_roster(r)
    inbox = c.get("speaking_attempts", "select=*&submitted_at=not.is.null&pulled_at=is.null&order=submitted_at")
    if not inbox:
        print("새 제출이 없어요."); return
    for at in inbox:
        s = students.get(at["student_id"])
        if not s or s["withdrawn_at"]:
            continue
        cons = s["consent"] or {}
        if not (cons.get("required") and cons.get("overseas")):
            print(f"✗ {s['code']} {at['id']}: 동의 기록이 없어서 받지 않았어요"); continue
        dst = os.path.join(SUBMISSIONS, s["code"], at["id"])
        os.makedirs(os.path.join(dst, "audio"), exist_ok=True)
        for it in at["items"]:
            if not re.fullmatch(r"audio/q\d{2}\.(webm|mp4|ogg)", it["file"]):
                continue
            path = f"{at['student_id']}/{at['id']}/{it['file'][6:]}"
            data = c.call("GET", f"/storage/v1/object/authenticated/{BUCKET}/{urllib.parse.quote(path)}", raw=True)
            open(os.path.join(dst, it["file"]), "wb").write(data)
        save_json(os.path.join(STUDENTS, s["code"], "consent", f"{at['id']}.json"),
                  {"received_at": dt.datetime.now().isoformat(timespec="seconds"), "consent": s["consent"], "consent_history": s["consent_history"]})
        save_json(os.path.join(dst, "attempt.json"), {
            "student_id": s["code"], "attempt_id": at["id"], "exam": at["exam"], "set_id": at["set_id"], "target": at["target"],
            "started_at": at["started_at"], "finished_at": at["finished_at"], "submitted_at": at["submitted_at"],
            "received_at": dt.datetime.now().isoformat(timespec="seconds"), "items": at["items"], **(at.get("meta") or {}),
        })
        c.call("PATCH", f"/rest/v1/speaking_attempts?id=eq.{at['id']}", {"pulled_at": dt.datetime.now(dt.timezone.utc).isoformat()}, headers={"Prefer": "return=minimal"})
        print(f"받았어요: {os.path.relpath(dst, ROOT)} · {s['code']} · {at['set_id']} · 목표 {at['target']} · 녹음 {len(at['items'])}개")
    print("다음: python3 tools/transcribe.py <폴더>")


def cmd_push(c: Cloud, a):
    import subprocess
    d = resolve_attempt_dir(a.folder)
    p = subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "pack_feedback.py"), d])
    if p.returncode:
        sys.exit(p.returncode)
    fb_file = max((f for f in os.listdir(d) if f.startswith("speaking-lab_feedback_")), key=lambda f: os.path.getmtime(os.path.join(d, f)))
    fb = load_json(os.path.join(d, fb_file))
    exists = c.get("speaking_feedback", f"select=attempt_id&attempt_id=eq.{fb['attempt_id']}")
    if exists:
        c.call("PATCH", f"/rest/v1/speaking_feedback?attempt_id=eq.{fb['attempt_id']}", {"feedback": fb, "read_at": None}, headers={"Prefer": "return=minimal"})
    else:
        c.call("POST", "/rest/v1/speaking_feedback", {"attempt_id": fb["attempt_id"], "feedback": fb}, headers={"Prefer": "return=minimal"})
    print(f"올렸어요: {fb['attempt_id']} — 학생 앱 홈에 '피드백 도착'이 떠요.")


def cmd_delete(c: Cloud, a):
    rows = c.get("speaking_students", f"select=id,code&code=eq.{a.code}")
    if not rows:
        sys.exit(f"{a.code} 학생이 서버에 없어요.")
    uid = rows[0]["id"]
    lst = lambda prefix: c.call("POST", f"/storage/v1/object/list/{BUCKET}", {"prefix": prefix, "limit": 1000, "offset": 0}) or []
    paths = [f"{uid}/{d['name']}/{f['name']}" for d in lst(f"{uid}/") for f in lst(f"{uid}/{d['name']}/")]
    if paths:
        c.call("DELETE", f"/storage/v1/object/{BUCKET}", {"prefixes": paths})
    c.call("DELETE", f"/rest/v1/speaking_students?id=eq.{uid}", headers={"Prefer": "return=minimal"})
    print(f"서버에서 {a.code} 자료를 지웠어요(녹음 {len(paths)}개, 응시·피드백·학생 정보). 로그인 계정은 남아 있어요 — 필요하면 Supabase 대시보드 Authentication에서 지워요.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("invite"); s.add_argument("--note")
    sub.add_parser("pull")
    s = sub.add_parser("push"); s.add_argument("folder")
    s = sub.add_parser("delete"); s.add_argument("code")
    a = ap.parse_args()
    c = Cloud()
    {"invite": cmd_invite, "pull": cmd_pull, "push": cmd_push, "delete": cmd_delete}[a.cmd](c, a)


if __name__ == "__main__":
    main()
