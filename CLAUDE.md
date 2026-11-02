# Speaking Lab — Claude Code 작업 규칙

토익스피킹 · OPIc 모의테스트 & 학습 웹앱이에요. 계획은 `docs/PLAN.md`, 콘텐츠 필드는 `schema/SCHEMA.md`.

## 구조 원칙
- 콘텐츠는 `content/**/*.yaml`에만 써요. 앱 코드(`app/`)에 문항·답변을 직접 넣지 않아요.
- 시험 시간·문항 수는 `schema/exam_formats.yaml`이 기준이에요. 코드에 숫자를 따로 박지 않아요.
- 앱은 빌드 도구 없는 바닐라 HTML/CSS/JS(ES 모듈)로 써요. 외부 라이브러리는 꼭 필요할 때만.
- 녹음·기록은 기기 안(IndexedDB)에만 저장해요. API 키를 앱 코드에 넣지 않아요.

## 콘텐츠 규칙
- 공식 기출(ETS·ACTFL) 문항을 옮기지 않아요. 형식만 따라 새로 써요. 공식 캐릭터·로고·상표 금지.
- 영어 모범답변은 실제로 말하는 길이와 속도에 맞춰요(토익 Q11 60초 ≈ 120~150단어).
- 한국어 해설·팁은 해요체, **humanizer-kr** 스킬로 다듬어요. 번역투·과장 금지.
- 사진은 출처·라이선스를 `content/credits.yaml`에 적고, 상표가 보이는 사진은 쓰지 않아요.
- 쓰고 나면 검증기 오류 0을 확인하고 `status: ready`로 바꿔요.
  `python3 tools/validate_content.py --all`
