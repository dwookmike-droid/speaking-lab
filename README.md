# Speaking Lab

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
```

처음 접속하면 학생 정보 입력과 개인정보 동의를 거쳐야 시험 화면이 열려요. 동의서 원본은 `content/legal/consent_v1.yaml`이에요.
