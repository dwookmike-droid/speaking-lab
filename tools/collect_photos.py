#!/usr/bin/env python3
"""사진 창고: Openverse에서 라이선스가 확실한 사진을 파트·장면별로 모아 쌓아요.

사용법 (리포 루트에서):
  python3 tools/collect_photos.py collect --part toeic_q3q4 [--budget 60] [--per-scene 3] [--scene office]
  python3 tools/collect_photos.py sheet --part toeic_q3q4 [--status candidate] [--out 폴더]   # 검수용 모아보기 이미지
  python3 tools/collect_photos.py mark --part toeic_q3q4 <id> [<id> ...] --status approved|rejected|used [--note "..."] [--used-in "set04 Q3"]
  python3 tools/collect_photos.py summary

- 검색어·라이선스·출처는 assets/photos/queries.yaml에 있어요.
- 받은 사진은 assets/photos/<파트>/<장면>/<id>.webp, 정보는 assets/photos/<파트>/index.yaml에 쌓여요.
- 새로 받은 사진은 모두 candidate예요. 상표·로고·읽히는 간판이 없는지 눈으로 보고 approved로 바꿔요.
  rejected로 바꾸면 파일은 지우고 기록은 남겨서 다시 받지 않아요.
- Openverse 익명 한도는 분당 20회, 하루 200회예요. 요청마다 간격을 두고, 막히면 거기서 멈추고 저장해요.
  다음에 다시 돌리면 이어서 다음 쪽(page)을 받아요.
"""
import argparse
import datetime
import io
import json
import os
import subprocess
import sys
import time
import urllib.parse

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, "assets", "photos")
API = "https://api.openverse.org/v1/images/"
GAP = 3.3          # 요청 사이 간격(초): 분당 20회 한도 아래로
STATUSES = ("candidate", "approved", "rejected", "used")


class Blocked(Exception):
    """요청 한도나 차단에 걸려 이번 수집을 멈춰요."""


def load_queries():
    with open(os.path.join(BASE, "queries.yaml"), encoding="utf-8") as f:
        return yaml.safe_load(f)


def index_path(part):
    return os.path.join(BASE, part, "index.yaml")


def load_index(part):
    p = index_path(part)
    if not os.path.exists(p):
        return {"schema_version": 1, "part": part, "state": {}, "photos": []}
    with open(p, encoding="utf-8") as f:
        d = yaml.safe_load(f) or {}
    d.setdefault("state", {}); d.setdefault("photos", [])
    return d


def save_index(part, d):
    os.makedirs(os.path.join(BASE, part), exist_ok=True)
    d["photos"].sort(key=lambda p: (p["scene"], p["added"], p["id"]))
    with open(index_path(part), "w", encoding="utf-8") as f:
        f.write("# tools/collect_photos.py가 관리해요. status·note·used_in만 손으로 고쳐도 돼요.\n")
        yaml.safe_dump(d, f, allow_unicode=True, sort_keys=False, width=140)


_last = [0.0]


def fetch(url, timeout=40):
    """curl로 받아요(프록시 설정을 그대로 써요). 한도·차단이면 한 번 쉬었다가 다시, 그래도 안 되면 Blocked."""
    for attempt in range(2):
        wait = GAP - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        r = subprocess.run(["curl", "-s", "-m", str(timeout), "-w", "\n%{http_code}", url], capture_output=True)
        body, _, code = r.stdout.rpartition(b"\n")
        code = code.decode().strip()
        if r.returncode == 0 and code == "200":
            return body
        if code in ("403", "429") or r.returncode == 28:
            if attempt == 0:
                time.sleep(45)
                continue
            raise Blocked(f"HTTP {code or r.returncode}")
        raise RuntimeError(f"HTTP {code or r.returncode}: {url}")
    raise Blocked("retry")


def to_webp(data, max_width):
    from PIL import Image
    im = Image.open(io.BytesIO(data)).convert("RGB")
    if im.width > max_width:
        im = im.resize((max_width, round(im.height * max_width / im.width)))
    out = io.BytesIO()
    im.save(out, "WEBP", quality=82)
    return out.getvalue(), im.size


def cmd_collect(a):
    q = load_queries()
    part_cfg = q["parts"][a.part]
    dflt = q.get("defaults", {})
    d = load_index(a.part)
    known = {p["openverse_id"] for p in d["photos"]}
    scenes = [a.scene] if a.scene else list(part_cfg["scenes"])
    budget = a.budget
    got = {s: 0 for s in scenes}
    today = datetime.date.today().isoformat()

    def spend():
        nonlocal budget
        if budget <= 0:
            raise Blocked("이번 실행 요청 수(--budget)를 다 썼어요")
        budget -= 1

    try:
        # 장면을 돌아가며 하나씩 채워요. 한 바퀴에 장면마다 검색 1번 + 새 사진 몇 장.
        progress = True
        while progress and any(got[s] < a.per_scene for s in scenes):
            progress = False
            for scene in scenes:
                if got[scene] >= a.per_scene:
                    continue
                queries = part_cfg["scenes"][scene]
                st = d["state"].setdefault(scene, {"query": 0, "page": {}})
                qi = st["query"] % len(queries)
                query = queries[qi]
                page = st["page"].get(query, 1)
                params = {"q": query, "license": ",".join(dflt.get("licenses", ["cc0"])), "page_size": 20, "page": page,
                          "aspect_ratio": "wide", "size": "large"}
                if dflt.get("sources"):
                    params["source"] = ",".join(dflt["sources"])
                spend()
                res = json.loads(fetch(API + "?" + urllib.parse.urlencode(params)))
                results = [r for r in res.get("results", []) if r["id"] not in known]
                # 다음 실행은 다음 검색어·다음 쪽부터
                st["page"][query] = page + 1 if page < res.get("page_count", 1) else 1
                st["query"] = qi + 1
                progress = True
                for r in results:
                    if got[scene] >= a.per_scene:
                        break
                    spend()
                    try:
                        raw = fetch(f"{API}{r['id']}/thumb/?full_size=true", timeout=90)
                        webp, (w, h) = to_webp(raw, dflt.get("max_width", 1280))
                    except RuntimeError as e:
                        print(f"  건너뜀 {r['id'][:8]}: {e}")
                        continue
                    if w < 800:
                        print(f"  건너뜀 {r['id'][:8]}: 너무 작아요({w}px)")
                        known.add(r["id"])
                        continue
                    pid = r["id"].split("-")[0]
                    rel = f"assets/photos/{a.part}/{scene}/{pid}.webp"
                    os.makedirs(os.path.join(ROOT, os.path.dirname(rel)), exist_ok=True)
                    with open(os.path.join(ROOT, rel), "wb") as f:
                        f.write(webp)
                    d["photos"].append({
                        "id": pid, "openverse_id": r["id"], "scene": scene, "file": rel,
                        "title": r.get("title"), "creator": r.get("creator"),
                        "license": f"{r.get('license', '').upper()} {r.get('license_version') or ''}".strip(),
                        "source": r.get("source"), "landing_url": r.get("foreign_landing_url"),
                        "width": w, "height": h, "query": query, "added": today,
                        "status": "candidate", "note": "", "used_in": [],
                    })
                    known.add(r["id"]); got[scene] += 1
                    print(f"  + {scene}/{pid}  {r.get('license')}  {r.get('title')!s:.50}")
                save_index(a.part, d)
    except Blocked as e:
        print(f"멈춤: {e}")
    save_index(a.part, d)
    print("이번에 받은 사진:", ", ".join(f"{s} {n}" for s, n in got.items() if n) or "없음")


def cmd_sheet(a):
    from PIL import Image, ImageDraw
    d = load_index(a.part)
    out = a.out or os.path.join(ROOT, "test-shots", "photo-sheets")
    os.makedirs(out, exist_ok=True)
    by_scene = {}
    for p in d["photos"]:
        if p["status"] == a.status and os.path.exists(os.path.join(ROOT, p["file"])):
            by_scene.setdefault(p["scene"], []).append(p)
    for scene, ps in by_scene.items():
        cols, tw, th = 4, 360, 240
        sheet = Image.new("RGB", (cols * (tw + 10), ((len(ps) + cols - 1) // cols) * (th + 10)), "white")
        dr = ImageDraw.Draw(sheet)
        for k, p in enumerate(ps):
            im = Image.open(os.path.join(ROOT, p["file"])).convert("RGB"); im.thumbnail((tw, th))
            x, y = (k % cols) * (tw + 10), (k // cols) * (th + 10)
            sheet.paste(im, (x, y)); dr.rectangle([x, y, x + 80, y + 18], fill="black"); dr.text((x + 4, y + 3), p["id"], fill="yellow")
        path = os.path.join(out, f"{a.part}_{scene}_{a.status}.jpg")
        sheet.save(path, quality=80)
        print(path, len(ps))


def cmd_mark(a):
    d = load_index(a.part)
    ids = set(a.ids)
    for p in d["photos"]:
        if p["id"] in ids:
            p["status"] = a.status
            if a.note is not None:
                p["note"] = a.note
            if a.used_in:
                p["used_in"] = sorted(set(p.get("used_in") or []) | {a.used_in})
            f = os.path.join(ROOT, p["file"])
            if a.status == "rejected" and os.path.exists(f):
                os.remove(f)                       # 기록은 남겨서 다시 받지 않아요
            ids.discard(p["id"])
    save_index(a.part, d)
    if ids:
        sys.exit(f"없는 id: {', '.join(sorted(ids))}")


def cmd_summary(a):
    q = load_queries()
    for part in q["parts"]:
        d = load_index(part)
        print(f"== {part} ({q['parts'][part].get('title_ko', '')}) — {len(d['photos'])}장")
        scenes = sorted({p['scene'] for p in d['photos']} | set(q['parts'][part]['scenes']))
        for s in scenes:
            c = {k: 0 for k in STATUSES}
            for p in d["photos"]:
                if p["scene"] == s:
                    c[p["status"]] += 1
            print(f"  {s:<14} " + "  ".join(f"{k} {v}" for k, v in c.items()))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("collect"); c.add_argument("--part", required=True); c.add_argument("--scene")
    c.add_argument("--budget", type=int, default=60, help="이번 실행에서 쓸 최대 요청 수 (하루 한도 200)")
    c.add_argument("--per-scene", type=int, default=3, help="장면마다 새로 받을 최대 장수")
    s = sub.add_parser("sheet"); s.add_argument("--part", required=True); s.add_argument("--status", default="candidate", choices=STATUSES); s.add_argument("--out")
    m = sub.add_parser("mark"); m.add_argument("--part", required=True); m.add_argument("ids", nargs="+")
    m.add_argument("--status", required=True, choices=STATUSES); m.add_argument("--note"); m.add_argument("--used-in")
    sub.add_parser("summary")
    a = ap.parse_args()
    {"collect": cmd_collect, "sheet": cmd_sheet, "mark": cmd_mark, "summary": cmd_summary}[a.cmd](a)


if __name__ == "__main__":
    main()
