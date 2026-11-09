# 인계 (2026-11-09)

새 세션은 이 문서 → `CLAUDE.md` → `docs/PLAN.md` 순서로 읽고 시작해요.

## 지금 상태
- 배포: https://dwookmike-droid.github.io/speaking-lab/ (main 병합 시 `.github/workflows/pages.yml`이 자동 배포. 리포 공개, Pages Source = GitHub Actions)
- 서버: Supabase **R&R archive**(`abaakjkidxsnfigqfcbx`, rw-english와 공유). `speaking_` 표·`speaking-audio` 버킷·RLS는 `supabase/001_speaking.sql`. 2026-11-09 Mike가 SQL Editor에서 실행 완료(표 4개, 버킷 비공개 확인).
- 끝난 단계: P0~P4(토익 3세트, OPIc 65문항, 등록·동의 v2, 제출·전사·피드백), P6a(Supabase), P6b(배포), 선생님 모드(이 브랜치 `teacher-mode`, PR 열림 — 병합은 Mike 확인 후).
- 남은 단계: **P5 학습 모드**(유형 연습, 표현 템플릿, 따라 말하기, 기록) — `docs/PLAN.md` 3절.

## Mike가 할 일 (막혀 있는 것)
1. ~~R&R archive에서 `supabase/001_speaking.sql` 실행~~ 완료(2026-11-09). 남은 것: 학생 계정 하나로 가입 → 제출 → `cloud_sync.py pull` → `push` 실제 왕복
2. 동의서 처리자 정보: `content/legal/consent_v2.yaml`의 `operator`(이름·연락처)·`retention`·`status` → 값만 알려 주면 넣고 `python3 tools/build.py`
3. 휴대폰 확인표 (`docs/DEPLOY.md`), Mac에서 실제 Whisper 전사(`tools/transcribe.py`) 첫 실행
4. 모범답변 검수(토익 216개, OPIc 780개), 토익 Q3–4 임시 일러스트 → 실사진

## 작업 환경 제약 (클라우드 세션)
- 막힌 호스트: supabase.co, github.io, huggingface.co, wikimedia/unsplash. GitHub Pages·Actions 재실행 API도 막힘(배포는 main 병합으로만 돌아요).
- PR 병합은 Mike가 "병합해"라고 해야 해요(자동 병합은 막혀요).
- 로컬 Postgres로 RLS 테스트: `/var/tmp/slpg`에 initdb (postgres 사용자, 포트 5433) — `tests/test_supabase_rls.py` 상단 참고. 새 세션에서는 다시 띄워야 해요:
  `mkdir -p /var/tmp/slpg && chown postgres /var/tmp/slpg && su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/initdb -D /var/tmp/slpg/data -A trust -U postgres && /usr/lib/postgresql/16/bin/pg_ctl -D /var/tmp/slpg/data -o '-p 5433 -k /var/tmp/slpg -c listen_addresses=' -l /var/tmp/slpg/log start"`

## 테스트 (앱 서버: `python3 -m http.server 8765 -d app &`)
| 명령 | 확인하는 것 |
|---|---|
| `python3 tools/validate_content.py --all` | 콘텐츠 21파일 + 설문 |
| `python3 -m unittest tests/test_teacher_tools.py tests/test_supabase_rls.py` | 선생님 도구, RLS(로컬 Postgres) |
| `node tests/test_opic_plan.mjs` | OPIc 문항 조합 |
| `node tests/e2e_toeic.js` · `e2e_opic.js` · `e2e_onboarding.js` · `bash tests/roundtrip.sh` | `?sb=off`(기기 안) 모드 |
| `node tests/e2e_cloud.js` · `node tests/e2e_teacher.js` | 가짜 Supabase(`tests/mock_supabase.js`)로 서버 모드·선생님 모드 |
모두 2026-11-09 기준 통과.
