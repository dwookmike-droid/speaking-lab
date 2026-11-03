#!/usr/bin/env python3
"""콘텐츠 YAML → app/data/*.json. 검증기를 먼저 통과해야 빌드해요.

사용법 (리포 루트에서):  python3 tools/build.py
"""
from __future__ import annotations
import glob, json, os, re, subprocess, sys
import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return yaml.safe_load(f)


def build_consent():
    """content/legal/consent_vN.yaml(가장 높은 N) → app/data/consent.json + docs/legal/개인정보_수집이용_동의서_vN.md"""
    files = glob.glob(os.path.join(ROOT, "content/legal/consent_v*.yaml"))
    if not files:
        return None
    src = max(files, key=lambda f: int(re.search(r"_v(\d+)\.yaml$", f).group(1)))
    d = yaml.safe_load(open(src, encoding="utf-8"))
    ver = d["consent_version"]
    vals = {**d["operator"], "retention": d["retention"]}
    fill = lambda t: re.sub(r"\{(\w+)\}", lambda m: str(vals.get(m.group(1), m.group(0))), str(t))
    keys = set()
    out = {k: d.get(k) for k in ("consent_version", "status", "effective", "title")}
    out["operator"] = d["operator"]
    out["intro"] = fill(d["intro"])
    out["sections"] = []
    for sec in d["sections"]:
        o = {"id": sec["id"], "title": sec["title"]}
        for k in ("paragraphs", "bullets"):
            if sec.get(k):
                o[k] = [fill(x) for x in sec[k]]
        if sec.get("table"):
            t = sec["table"]
            rows = [[fill(c) for c in r] + ([d["retention"]] if t.get("retention_col") else []) for r in t["rows"]]
            if any(len(r) != len(t["head"]) for r in rows):
                sys.exit(f"{src}: {sec['id']} 표 칸 수가 머리글과 달라요")
            o["table"] = {"head": t["head"], "rows": rows}
        for k in ("check", "only_if", "fields"):
            if sec.get(k):
                o[k] = sec[k]
        if sec.get("check"):
            keys.add(sec["check"]["key"])
        out["sections"].append(o)
    missing = {"required", "overseas", "guardian"} - keys
    if missing:
        sys.exit(f"{src}: 동의 체크 항목이 빠졌어요 ({', '.join(sorted(missing))})")
    json.dump(out, open(os.path.join(ROOT, "app/data/consent.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    # 사람이 읽는 문서판 (인쇄·보관용). 직접 고치지 말고 YAML을 고쳐요.
    md = [f"---\nconsent_version: {ver}\neffective: {d.get('effective') or '미정'}\nstatus: {d['status']}\n---\n",
          f"<!-- 이 파일은 {os.path.relpath(src, ROOT)}에서 tools/build.py가 만들어요. 직접 고치지 마세요. -->\n",
          f"# {d['title']} (v{ver})\n"]
    if d["status"] == "draft":
        md.append("> **초안이에요.** 실제로 쓰기 전에 개인정보보호위원회 표준 동의서 양식과 비교하거나 전문가 검토를 받아 주세요.\n")
    md.append(out["intro"] + "\n")
    for o in out["sections"]:
        md.append(f"## {o['title']}")
        md += [p + "\n" for p in o.get("paragraphs", [])]
        if o.get("table"):
            t = o["table"]
            md.append("| " + " | ".join(t["head"]) + " |\n|" + "---|" * len(t["head"]))
            md += ["| " + " | ".join(r) + " |" for r in t["rows"]]
            md.append("")
        md += [f"- {b}" for b in o.get("bullets", [])]
        for f_ in o.get("fields", []):
            md.append(f"- {f_}: ____________")
        if o.get("check"):
            md.append(f"\n☐ {o['check']['label']}")
        md.append("")
    md.append("---\n동의 일시: ____년 __월 __일 · 학생 이름: ____________ (서명) ________\n")
    dst = os.path.join(ROOT, f"docs/legal/개인정보_수집이용_동의서_v{ver}.md")
    open(dst, "w", encoding="utf-8").write("\n".join(md))
    return ver


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
    levels = {ex: {"levels": lv[ex]["levels"], "labels": lv[ex]["labels"]} for ex in ("toeic", "opic")}
    json.dump(levels, open(os.path.join(ROOT, "app/data/levels.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    cv = build_consent()
    if cv:
        print(f"빌드: app/data/consent.json · docs/legal/개인정보_수집이용_동의서_v{cv}.md (동의서 v{cv})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
