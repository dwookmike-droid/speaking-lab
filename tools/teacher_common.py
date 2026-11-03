"""선생님 도구 공통: 경로, 학생 명단(students/roster.yaml) 읽고 쓰기, 레벨 목록."""
from __future__ import annotations
import json, os, sys
try:
    import yaml
except ImportError:
    sys.exit("PyYAML이 필요해요: pip3 install -r tools/requirements-teacher.txt")

ROOT = os.environ.get("SPEAKING_LAB_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STUDENTS = os.path.join(ROOT, "students")
SUBMISSIONS = os.path.join(ROOT, "submissions")
ROSTER = os.path.join(STUDENTS, "roster.yaml")


def load_yaml(path):
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)


def load_roster() -> dict:
    if not os.path.exists(ROSTER):
        return {"students": []}
    return load_yaml(ROSTER) or {"students": []}


def save_roster(r: dict):
    os.makedirs(STUDENTS, exist_ok=True)
    with open(ROSTER, "w", encoding="utf-8") as f:
        f.write("# 학생 명단 — 개인정보예요. git에 올리지 않아요(.gitignore). 양식: schema/roster.example.yaml\n")
        yaml.safe_dump(r, f, allow_unicode=True, sort_keys=False)


def levels(exam: str) -> list[str]:
    return load_yaml(os.path.join(ROOT, "schema/answer_levels.yaml"))[exam]["levels"]


def find_set(set_id: str) -> dict | None:
    import glob
    for p in glob.glob(os.path.join(ROOT, "content/*/sets/*.yaml")):
        d = load_yaml(p)
        if d.get("id") == set_id:
            return d
    return None


def resolve_attempt_dir(arg: str) -> str:
    """submissions/S001/a123 또는 응시 ID만 줘도 폴더를 찾아요."""
    if os.path.isdir(arg):
        return os.path.abspath(arg)
    import glob
    hits = glob.glob(os.path.join(SUBMISSIONS, "*", arg))
    if len(hits) == 1:
        return hits[0]
    sys.exit(f"제출 폴더를 찾지 못했어요: {arg}")
