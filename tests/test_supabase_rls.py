"""supabase/001_speaking.sql 접근 규칙(RLS) 테스트 — 로컬 Postgres에 Supabase 흉내(tests/sql/supabase_stub.sql)를 깔고 돌려요.

실행: python3 -m unittest tests/test_supabase_rls.py
필요: psql과 빈 테스트용 Postgres. 접속 정보는 PGHOST/PGPORT/PGUSER 환경변수(기본 /var/tmp/slpg, 5433, postgres).
실제 Supabase 프로젝트에는 절대 돌리지 않아요(데이터베이스를 지우고 새로 만들어요).
"""
import os, subprocess, unittest, uuid

HERE = os.path.dirname(os.path.abspath(__file__)); REPO = os.path.dirname(HERE)
PG = {"PGHOST": os.environ.get("PGHOST", "/var/tmp/slpg"), "PGPORT": os.environ.get("PGPORT", "5433"),
      "PGUSER": os.environ.get("PGUSER", "postgres")}
DB = "speaking_rls_test"
A, B, R, T = (str(uuid.uuid4()) for _ in range(4))     # 학생 A, 학생 B, rw 학생(등록 코드 없음), 선생님


def psql(sql, db=DB, user=None, check=True):
    """user가 있으면 그 계정(authenticated 역할 + JWT sub)으로, 없으면 관리자로 실행해요. (성공여부, 출력)"""
    if user == "anon":
        sql = "set role anon; " + sql
    elif user:
        sql = f"select set_config('request.jwt.claim.sub', '{user}', false); set role authenticated; " + sql
    p = subprocess.run(["psql", "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-d", db, "-c", sql],
                       env={**os.environ, **PG}, capture_output=True, text=True)
    if check and p.returncode:
        raise AssertionError(p.stderr)
    out = [l for l in p.stdout.strip().splitlines() if l.strip() not in ("", A, B, R, T)]
    return p.returncode == 0, ("\n".join(out) if p.returncode == 0 else p.stderr.strip())


def denied(sql, user):
    ok, err = psql(sql, user=user, check=False)
    return (not ok) and ("row-level security" in err or "permission denied" in err or "42501" in err
                         or "선생님" in err or "등록 코드" in err or "아이디" in err or "학생이 아니에요" in err or "로그인이" in err), err


class RLS(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        psql(f"drop database if exists {DB}", db="postgres")
        psql(f"create database {DB}", db="postgres")
        for f in ("tests/sql/supabase_stub.sql", "supabase/001_speaking.sql", "supabase/001_speaking.sql"):   # 두 번 돌려도 돼야 해요
            p = subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", DB, "-f", os.path.join(REPO, f)],
                               env={**os.environ, **PG}, capture_output=True, text=True)
            assert p.returncode == 0, f"{f}: {p.stderr}"
        psql(f"""insert into auth.users (id, email) values
              ('{A}', 'alice@speaking.local'), ('{B}', 'bob@speaking.local'), ('{R}', 'ddj.2.s.x@rw.local'), ('{T}', 'teacher@example.com');
              insert into public.teachers (id, name) values ('{T}', 'T');""")

    def test_1_flow(self):
        # 등록 코드는 선생님만 만들어요
        self.assertTrue(denied("insert into speaking_invites (code, student_code) values ('AAAA1111', 'S001')", A)[0])
        psql("insert into speaking_invites (code, student_code) values ('AAAA1111', 'S001'), ('BBBB2222', 'S002'), ('CCCC3333', 'S003')", user=T)
        self.assertEqual(psql("select count(*) from speaking_invites", user=A)[1], "0", "학생은 등록 코드 목록을 못 봐요")
        # 코드 없이 / 틀린 코드 / 다른 아이디로는 못 묶어요
        self.assertTrue(denied("select speaking_claim('ZZZZ9999', 'alice')", A)[0])
        self.assertTrue(denied("select speaking_claim('AAAA1111', 'bob')", A)[0], "아이디가 로그인 계정과 달라요")
        self.assertTrue(denied("select speaking_claim('AAAA1111', 'x')", "anon")[0])
        self.assertEqual(psql("select speaking_claim('aaaa1111', 'Alice')", user=A)[1], "S001")
        self.assertEqual(psql("select speaking_claim('AAAA1111', 'alice')", user=A)[1], "S001", "다시 불러도 같아요")
        self.assertTrue(denied("select speaking_claim('AAAA1111', 'bob')", B)[0], "쓴 코드는 다시 못 써요")
        self.assertEqual(psql("select speaking_claim('BBBB2222', 'bob')", user=B)[1], "S002")

        # 등록 안 한 계정(rw 학생)은 아무것도 못 봐요/못 써요
        for t in ("speaking_students", "speaking_attempts", "speaking_feedback", "speaking_invites"):
            self.assertEqual(psql(f"select count(*) from {t}", user=R)[1], "0", t)
        self.assertTrue(denied(f"insert into speaking_attempts (id, student_id, exam, set_id) values ('ar1', '{R}', 'toeic', 's')", R)[0])
        self.assertTrue(denied(f"insert into storage.objects (bucket_id, name) values ('speaking-audio', '{R}/ar1/q01.webm')", R)[0])
        # anon은 표 자체에 권한이 없어요
        self.assertTrue(denied("select * from speaking_students", "anon")[0])

        # 학생 정보: 자기 것만, 정해진 칸만
        psql(f"update speaking_students set profile = '{{\"name\": \"A\"}}', consent = '{{\"version\": 2}}' where id = '{A}'", user=A)
        self.assertEqual(psql("select count(*) from speaking_students", user=A)[1], "1")
        self.assertTrue(denied(f"update speaking_students set code = 'S999' where id = '{A}'", A)[0], "학생 번호는 못 바꿔요")
        self.assertTrue(denied(f"update speaking_students set ended_on = '2026-01-01' where id = '{A}'", A)[0])
        psql(f"update speaking_students set profile = '{{}}' where id = '{B}'", user=A)             # 남의 행: 0행 수정
        self.assertEqual(psql(f"select profile->>'name' from speaking_students where id = '{A}'", user=T)[1], "A")
        self.assertEqual(psql(f"select count(*) from speaking_students where id = '{B}' and profile = '{{}}'::jsonb", user=T)[1], "1")

        # 응시 기록: 자기 이름으로만
        self.assertTrue(denied(f"insert into speaking_attempts (id, student_id, exam, set_id) values ('ax1', '{B}', 'toeic', 's')", A)[0])
        psql(f"insert into speaking_attempts (id, student_id, exam, set_id, submitted_at) values ('aa1', '{A}', 'toeic', 'toeic-set01', now())", user=A)
        psql(f"insert into speaking_attempts (id, student_id, exam, set_id, submitted_at) values ('ab1', '{B}', 'opic', 'opic', now())", user=B)
        self.assertEqual(psql("select string_agg(id, ',') from speaking_attempts", user=A)[1], "aa1")
        self.assertTrue(denied("update speaking_attempts set pulled_at = now() where id = 'aa1'", A)[0], "pulled_at은 선생님만")
        psql("update speaking_attempts set finished_at = now() where id = 'aa1'", user=A)
        psql("update speaking_attempts set finished_at = now() where id = 'ab1'", user=A)             # 남의 행: 0행
        self.assertEqual(psql("select count(*) from speaking_attempts where id = 'ab1' and finished_at is null", user=T)[1], "1")

        # 녹음: 자기 폴더만
        psql(f"insert into storage.objects (bucket_id, name) values ('speaking-audio', '{A}/aa1/q01.webm')", user=A)
        self.assertTrue(denied(f"insert into storage.objects (bucket_id, name) values ('speaking-audio', '{B}/aa1/q01.webm')", A)[0])
        self.assertTrue(denied(f"insert into storage.objects (bucket_id, name) values ('other-bucket', '{A}/x')", A)[0])
        psql(f"insert into storage.objects (bucket_id, name) values ('speaking-audio', '{B}/ab1/q01.webm')", user=B)
        self.assertEqual(psql("select count(*) from storage.objects", user=A)[1], "1")
        self.assertEqual(psql("select count(*) from storage.objects", user=T)[1], "2", "선생님은 모두 봐요")

        # 선생님: 내려받음 표시, 피드백 쓰기
        psql("update speaking_attempts set pulled_at = now() where id in ('aa1', 'ab1')", user=T)
        self.assertTrue(denied("insert into speaking_feedback (attempt_id, student_id, feedback) values ('aa1', null, '{}')", A)[0])
        psql(f"insert into speaking_feedback (attempt_id, student_id, feedback) values ('aa1', '{B}', '{{\"x\": 1}}')", user=T)
        self.assertEqual(psql("select student_id from speaking_feedback where attempt_id = 'aa1'", user=T)[1] or A, A,
                         "피드백 학생은 응시 기록에서 정해져요(잘못 넣어도)")
        self.assertEqual(psql("select count(*) from speaking_feedback", user=A)[1], "1")
        self.assertEqual(psql("select count(*) from speaking_feedback", user=B)[1], "0")
        psql("update speaking_feedback set read_at = now() where attempt_id = 'aa1'", user=A)
        self.assertTrue(denied("update speaking_feedback set feedback = '{}' where attempt_id = 'aa1'", A)[0])

        # 동의 철회: 응시·피드백이 지워지고 정보가 비고, 이후엔 쓰기 불가
        psql("select speaking_withdraw()", user=A)
        self.assertEqual(psql(f"select count(*) from speaking_attempts where student_id = '{A}'", user=T)[1], "0")
        self.assertEqual(psql(f"select count(*) from speaking_feedback", user=T)[1], "0")
        self.assertEqual(psql(f"select profile::text || coalesce(consent::text, 'null') || (withdrawn_at is not null)::text from speaking_students where id = '{A}'", user=T)[1], "{}nulltrue")
        self.assertTrue(denied(f"insert into speaking_attempts (id, student_id, exam, set_id) values ('aa2', '{A}', 'toeic', 's')", A)[0])
        self.assertTrue(denied(f"insert into storage.objects (bucket_id, name) values ('speaking-audio', '{A}/aa2/q01.webm')", A)[0])
        psql(f"delete from storage.objects where name like '{A}/%'", user=A)                       # 자기 녹음은 철회 후에도 지울 수 있어요
        self.assertEqual(psql(f"select count(*) from storage.objects where name like '{A}/%'", user=T)[1], "0")
        # B는 그대로
        self.assertEqual(psql(f"select count(*) from speaking_attempts where student_id = '{B}'", user=T)[1], "1")


if __name__ == "__main__":
    unittest.main()
