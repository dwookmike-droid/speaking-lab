# Speaking Lab

학생 주소: https://dwookmike-droid.github.io/speaking-lab/ (배포 방법: [`docs/DEPLOY.md`](docs/DEPLOY.md))

토익스피킹 · OPIc 모의테스트와 유형별 학습을 한 곳에서 하는 웹앱이에요.

- 실제 시험처럼 준비 시간 → 신호음 → 녹음으로 자동 진행
- 문항별 내 녹음 다시 듣기, 모범답변·해설 비교
- 유형 연습, 표현 템플릿, 따라 말하기

계획: [`docs/PLAN.md`](docs/PLAN.md) · 콘텐츠 스키마: [`schema/SCHEMA.md`](schema/SCHEMA.md)

## 로컬 실행
마이크는 `localhost` 또는 HTTPS에서만 켜져요.
```bash
python3 -m http.server 8000 -d app
```

확인용 주소 옵션: `index.html?fast=20` (20배 빠르게), `?notts` (문항 음성 대신 글자)

## 콘텐츠 검증 · 빌드
콘텐츠(`content/`)를 고치면 빌드해서 `app/data/toeic.json`을 다시 만들어요. 빌드는 검증을 먼저 돌려요.
```bash
python3 tools/build.py
```

## 끝까지 응시 테스트
```bash
python3 -m http.server 8765 -d app &
node tests/e2e_toeic.js          # SET=1, SET=2로 다른 세트
node tests/e2e_onboarding.js     # 학생 등록·동의·재동의·철회
node tests/e2e_opic.js           # OPIc 설문 → 자가평가 → 15문항 → 재조정 → 제출
node tests/test_opic_plan.mjs    # OPIc 문항 조합(자가평가 1~6)
node tests/e2e_cloud.js          # 서버 모드 왕복(가짜 Supabase): 등록 코드 → 제출 → pull → push → 철회
python3 -m unittest tests/test_supabase_rls.py   # 접근 규칙(로컬 Postgres, PGHOST/PGPORT)
```

처음 접속하면 학생 정보 입력과 개인정보 동의를 거쳐야 시험 화면이 열려요. 동의서 원본은 `content/legal/consent_v1.yaml`이에요.

## 서버(Supabase)
학생 계정·제출·피드백은 R&R archive Supabase로 주고받아요. 설정은 [`supabase/SETUP.md`](supabase/SETUP.md). 주소 뒤에 `?sb=off`를 붙이면 서버 없이 기기 안에서만 동작해요(제출은 zip).

## 선생님: 녹음 받아서 피드백 보내기 (zip 방식)
형식과 흐름은 [`schema/FEEDBACK.md`](schema/FEEDBACK.md)에 있어요. 처음 한 번 설치해요.
```bash
pip3 install -r tools/requirements-teacher.txt
```
```bash
python3 tools/intake.py ~/Downloads/speaking-lab_xxx.zip       # 학생 번호 붙여 정리 (이름은 students/에만)
python3 tools/transcribe.py submissions/S001/<응시ID>          # 로컬 Whisper 전사 (처음엔 모델 내려받기)
# Claude Code에서: "speaking-feedback 스킬로 submissions/S001/<응시ID> 피드백 써줘"
python3 tools/validate_feedback.py submissions/S001/<응시ID>  # 형식·전사본 일치·개인정보 검사
python3 tools/pack_feedback.py submissions/S001/<응시ID>      # 학생에게 보낼 .json
python3 tools/purge.py                                        # 보유 기간 지난 자료 찾기 (--apply로 삭제)
```
테스트: `python3 -m unittest tests/test_teacher_tools.py`, 왕복 전체는 `bash tests/roundtrip.sh`(앱 서버 8765 필요).
