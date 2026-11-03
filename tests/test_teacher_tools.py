"""선생님 도구 단위 테스트 (Whisper 없이 돌아요).  실행: python3 -m unittest tests/test_teacher_tools.py"""
import io, json, os, shutil, subprocess, sys, tempfile, unittest, zipfile
HERE = os.path.dirname(os.path.abspath(__file__)); REPO = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(REPO, "tools"))


def make_root():
    root = tempfile.mkdtemp()
    os.symlink(os.path.join(REPO, "schema"), os.path.join(root, "schema"))
    os.symlink(os.path.join(REPO, "content"), os.path.join(root, "content"))
    return root


def manifest(**over):
    m = {"type": "speaking_submission", "version": 1, "created_at": "2026-11-03T00:00:00Z",
         "student": {"name": "가상 학생", "email": "kim.virtual@example.com", "phone": "010-2222-3333", "under14": False,
                     "exams": ["toeic"], "targets": {"toeic": "lv7"}},
         "consent": {"version": 1, "required": True, "overseas": True, "optional": False, "guardian": None},
         "consent_history": [], "guardian": None,
         "attempt": {"id": "atest1", "exam": "toeic", "set_id": "toeic-set01", "target": "lv7"},
         "items": [{"num": 3, "file": "audio/q03.webm", "mime": "audio/webm", "ms": 30000}]}
    for k, v in over.items():
        m[k] = v
    return m


def make_zip(path, m, extra=()):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("manifest.json", json.dumps(m))
        z.writestr("audio/q03.webm", b"\x1a\x45\xdf\xa3fake")
        for name, data in extra:
            z.writestr(name, data)


def run(tool, *args, root):
    env = {**os.environ, "SPEAKING_LAB_ROOT": root}
    return subprocess.run([sys.executable, os.path.join(REPO, "tools", tool), *args], env=env, capture_output=True, text=True)


class Stats(unittest.TestCase):
    def test_stats(self):
        from transcribe import compute_stats
        w = [{"w": "I", "start": 1.0, "end": 1.2}, {"w": "um,", "start": 1.3, "end": 1.5},
             {"w": "think", "start": 3.0, "end": 3.3}, {"w": "so.", "start": 3.4, "end": 3.6}]
        s = compute_stats(w, 15.0)
        self.assertEqual(s["words"], 3)                 # 군말은 단어 수에서 빼요
        self.assertEqual(s["fillers"], 1)
        self.assertEqual(s["pauses_over_1s"], 1)
        self.assertEqual(s["longest_pause_s"], 1.5)
        self.assertEqual(s["silent_tail_s"], 11.4)
        self.assertEqual(compute_stats([], 30.0)["words"], 0)


class Intake(unittest.TestCase):
    def setUp(self):
        self.root = make_root(); self.zip = os.path.join(self.root, "s.zip")

    def tearDown(self):
        shutil.rmtree(self.root)

    def test_pseudonymized_and_filtered(self):
        make_zip(self.zip, manifest(), extra=[("../evil.txt", "x"), ("audio/q99.exe", "x"), ("other.json", "{}")])
        r = run("intake.py", self.zip, root=self.root)
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        d = os.path.join(self.root, "submissions", "S001", "atest1")
        files = sorted(os.path.relpath(os.path.join(dp, f), d) for dp, _, fs in os.walk(d) for f in fs)
        self.assertEqual(files, ["attempt.json", os.path.join("audio", "q03.webm")])
        self.assertFalse(os.path.exists(os.path.join(self.root, "evil.txt")))
        att = open(os.path.join(d, "attempt.json"), encoding="utf-8").read()
        for pii in ("가상 학생", "kim.virtual", "010-2222-3333"):
            self.assertNotIn(pii, att)
        self.assertIn("가상 학생", open(os.path.join(self.root, "students", "roster.yaml"), encoding="utf-8").read())
        # 같은 이메일 → 같은 번호, 같은 응시 → 거절
        self.assertNotEqual(run("intake.py", self.zip, root=self.root).returncode, 0)
        m2 = manifest(); m2["attempt"] = {**m2["attempt"], "id": "atest2"}; make_zip(self.zip, m2)
        self.assertEqual(run("intake.py", self.zip, root=self.root).returncode, 0)
        self.assertTrue(os.path.isdir(os.path.join(self.root, "submissions", "S001", "atest2")))

    def test_rejects_without_consent(self):
        make_zip(self.zip, manifest(consent={"version": 1, "required": True, "overseas": False}))
        r = run("intake.py", self.zip, root=self.root)
        self.assertNotEqual(r.returncode, 0); self.assertIn("동의", r.stderr)

    def test_rejects_under14_without_guardian(self):
        m = manifest(); m["student"]["under14"] = True
        make_zip(self.zip, m)
        self.assertNotEqual(run("intake.py", self.zip, root=self.root).returncode, 0)


class Purge(unittest.TestCase):
    def test_retention(self):
        root = make_root()
        try:
            os.makedirs(os.path.join(root, "students", "S001")); os.makedirs(os.path.join(root, "submissions", "S001"))
            import yaml
            yaml.safe_dump({"students": [{"id": "S001", "name": "가상", "ended": "2026-01-10", "started": "2025-09-01"},
                                         {"id": "S002", "name": "진행 중", "ended": None}]},
                           open(os.path.join(root, "students", "roster.yaml"), "w", encoding="utf-8"), allow_unicode=True)
            self.assertIn("지울 대상이 없어요", run("purge.py", "--today", "2026-04-09", root=root).stdout)
            r = run("purge.py", "--today", "2026-04-10", "--apply", root=root)
            self.assertIn("S001", r.stdout)
            self.assertFalse(os.path.exists(os.path.join(root, "submissions", "S001")))
            roster = open(os.path.join(root, "students", "roster.yaml"), encoding="utf-8").read()
            self.assertNotIn("가상\n", roster); self.assertIn("purged", roster); self.assertIn("진행 중", roster)
        finally:
            shutil.rmtree(root)


if __name__ == "__main__":
    unittest.main()
