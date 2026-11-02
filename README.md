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

## 콘텐츠 검증
```bash
python3 tools/validate_content.py --all
```
