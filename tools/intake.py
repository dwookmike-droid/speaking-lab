#!/usr/bin/env python3
"""학생 제출 꾸러미(zip)를 받아 정리해요.

사용법:  python3 tools/intake.py ~/Downloads/speaking-lab_xxx.zip [--force]

- 학생 명단(students/roster.yaml)에서 이메일로 학생을 찾고, 없으면 새 번호(S001…)를 붙여요.
- 이름·연락처·동의 기록은 students/ 아래에만 두고, submissions/<번호>/<응시ID>/에는 번호만 남겨요.
- 꾸러미 안에서 manifest.json과 audio/qNN.(webm|mp4|ogg)만 꺼내요. 다른 파일은 무시해요.
"""
from __future__ import annotations
import argparse, datetime as dt, os, re, sys, zipfile
from teacher_common import SUBMISSIONS, STUDENTS, load_roster, save_json, save_roster, levels

AUDIO_RE = re.compile(r"^audio/q(\d{2})\.(webm|mp4|ogg)$")
MAX_AUDIO = 30 * 1024 * 1024


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("zip")
    ap.add_argument("--force", action="store_true", help="이미 받은 응시면 덮어써요")
    a = ap.parse_args()

    try:
        z = zipfile.ZipFile(a.zip)
    except zipfile.BadZipFile:
        sys.exit("zip 파일이 아니에요.")
    import json
    try:
        m = json.loads(z.read("manifest.json").decode("utf-8"))
    except KeyError:
        sys.exit("manifest.json이 없어요. Speaking Lab 제출 파일이 맞나요?")
    if m.get("type") != "speaking_submission" or m.get("version") != 1:
        sys.exit("Speaking Lab 제출 파일(version 1)이 아니에요.")
    st, att, consent = m["student"], m["attempt"], m.get("consent") or {}
    if not (consent.get("required") and consent.get("overseas")):
        sys.exit("필수·국외 이전 동의 기록이 없어요. 피드백 작업을 하지 말고 학생에게 동의부터 받아 주세요.")
    if st.get("under14") and not consent.get("guardian"):
        sys.exit("만 14세 미만인데 보호자 동의 기록이 없어요.")
    if att.get("target") not in levels(att["exam"]):
        sys.exit(f"알 수 없는 목표 레벨이에요: {att.get('target')}")
    if not re.fullmatch(r"a[0-9a-z]+", att["id"]):
        sys.exit("응시 ID 형식이 이상해요.")

    # 학생 찾기 / 등록
    r = load_roster()
    email = (st.get("email") or "").strip().lower()
    entry = next((s for s in r["students"] if (s.get("email") or "").lower() == email), None)
    today = dt.date.today().isoformat()
    if not entry:
        nums = [int(s["id"][1:]) for s in r["students"] if re.fullmatch(r"S\d+", s.get("id", ""))]
        entry = {"id": f"S{(max(nums) + 1) if nums else 1:03d}", "started": today, "ended": None}
        r["students"].append(entry)
        print(f"새 학생으로 등록했어요: {entry['id']}")
    entry.update({
        "name": st.get("name"), "email": st.get("email"), "phone": st.get("phone"), "under14": bool(st.get("under14")),
        "guardian": m.get("guardian"), "exams": st.get("exams"), "targets": st.get("targets"),
        "consent": consent,
    })
    save_roster(r)
    sid = entry["id"]
    save_json(os.path.join(STUDENTS, sid, "consent", f"{att['id']}.json"),
              {"received_at": dt.datetime.now().isoformat(timespec="seconds"), "consent": consent,
               "consent_history": m.get("consent_history"), "guardian": m.get("guardian")})

    # 제출 폴더 (이름 없음)
    dst = os.path.join(SUBMISSIONS, sid, att["id"])
    if os.path.exists(os.path.join(dst, "attempt.json")) and not a.force:
        sys.exit(f"이미 받은 응시예요: {os.path.relpath(dst)} (다시 받으려면 --force)")
    os.makedirs(os.path.join(dst, "audio"), exist_ok=True)
    items = []
    wanted = {it["file"]: it for it in m.get("items", [])}
    for info in z.infolist():
        mm = AUDIO_RE.match(info.filename)
        if not mm or info.filename not in wanted:
            continue
        if info.file_size > MAX_AUDIO:
            sys.exit(f"녹음 파일이 너무 커요: {info.filename}")
        with open(os.path.join(dst, info.filename), "wb") as f:
            f.write(z.read(info))
        it = wanted[info.filename]
        items.append({"num": int(mm.group(1)), "file": info.filename, "mime": it.get("mime"), "ms": it.get("ms"),
                      **({"qid": it["qid"], "type": it.get("type")} if it.get("qid") else {})})
    items.sort(key=lambda x: x["num"])
    save_json(os.path.join(dst, "attempt.json"), {
        "student_id": sid, "attempt_id": att["id"], "exam": att["exam"], "set_id": att["set_id"], "target": att["target"],
        "started_at": att.get("started_at"), "finished_at": att.get("finished_at"), "submitted_at": m.get("created_at"),
        "received_at": dt.datetime.now().isoformat(timespec="seconds"), "items": items,
        **{k: att[k] for k in ("self_assessment", "readjust", "difficulty", "survey_topics") if k in att},
    })
    print(f"받았어요: {os.path.relpath(dst)} · 학생 {sid} · {att['set_id']} · 목표 {att['target']} · 녹음 {len(items)}개")
    print(f"다음: python3 tools/transcribe.py {os.path.relpath(dst)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
