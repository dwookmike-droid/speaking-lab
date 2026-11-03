# 콘텐츠 스키마 (schema_version: 1)

파트 지시문은 `content/toeic/directions.yaml`, 결과 화면 점검표는 `content/toeic/checklists.yaml`.
시간 값은 `exam_formats.yaml`, 글자 수는 `limits.yaml`, 목표 레벨별 답변 기준(레벨 목록·단어 수·가짓수)은 `answer_levels.yaml`. 검증: `python3 tools/validate_content.py --all`

## 토익 세트 — `content/toeic/sets/setNN.yaml`
```yaml
schema_version: 1
id: toeic-set01
status: draft                # draft | ready | reviewed
items:                       # 정확히 11개, num 1~11 순서대로
  - num: 1
    type: read_aloud
    text: "..."              # 읽을 지문 (영어)
    marks: "Welcome to / City Museum. // ..."   # / 짧게 쉼, // 길게 쉼, **강세**
    tip_ko: "..."
  - num: 3
    type: describe_photo
    image: img/toeic/set01_q3.webp   # app/ 기준 경로, 파일이 있어야 해요
    credit: "..."            # 사진 출처 (content/credits.yaml id)
    model:                   # 목표 레벨마다 답변 목록 (answer_levels.yaml의 levels 전부, 각 variants_min개 이상)
      lv5:
        - text: "This is a picture of an office. A man is ..."
          frame: [장소, 중심 인물, 주변, 느낌]      # 이 답변이 따른 뼈대 (화면에 표시)
          phrases: ["This is a picture of", "In the background"]   # 이 레벨에서 쓴 핵심 표현
        - text: "..."
      lv6: [...]
      lv7: [...]
      lv8: [...]
    tip_ko: "..."
  - num: 5                    # 5~7 공통 상황(context)은 Q5에만 써요
    type: respond_q
    context: "Imagine that a marketing firm is doing research ... about movies."
    question: "..."
    model: {lv5: [...], lv6: [...], lv7: [...], lv8: [...]}
  - num: 8                    # 8~10 공통 자료(info)와 전화 건 사람 첫마디(caller_intro)는 Q8에만 써요
    type: info_based
    caller_intro: "Hi, I signed up for ..."
    info: {title: "...", subtitle: "날짜 · 장소 · 요금", rows: [["9:00 a.m.", "Opening remarks"], ...]}
    question: "..."          # 음성으로만 나가는 질문 (화면에는 안 보임)
    model: {lv5: [...], lv6: [...], lv7: [...], lv8: [...]}
  - num: 11
    type: opinion
    question: "..."
    model: {lv5: [...], lv6: [...], lv7: [...], lv8: [...]}
    template: opinion_v1     # content/templates/ 참조 (선택)
```

## OPIc 주제 — `content/opic/topics/<topic>.yaml`
```yaml
schema_version: 1
id: home
survey_keys: [live_house, live_apartment]   # survey.yaml 항목과 연결
title_ko: 사는 곳
status: draft
questions:
  - id: home-d1
    type: description         # exam_formats.yaml opic.item_types 중 하나
    level: [3, 4, 5, 6]       # 이 문항이 나올 수 있는 자가평가 난이도
    question: "..."
    model: {il: [...], im1: [...], im2: [...], im3: [...], ih: [...], al: [...]}   # 항목 형식은 토익과 같아요
    tip_ko: "..."
```

## 레벨별 답변 규칙
- 지문 읽기(Q1–2)는 `model` 없이 `marks`만 써요.
- 답변 단어 수는 `answer_levels.yaml`의 `words` 범위 안이어야 해요. 토익은 `유형_답변초`(예: `respond_q_15`), OPIc는 유형 이름이 있으면 그 범위, 없으면 `default`.
- `status: draft`일 때는 레벨·가짓수가 모자라도 경고만 나와요. `ready`로 바꾸려면 모든 레벨이 `variants_min`개 이상이어야 해요.

## 학생 명단 — `students/roster.yaml` (git 제외, 양식: `schema/roster.example.yaml`)

## OPIc 주제 — `content/opic/topics/<id>.yaml`, `content/opic/roleplays/<id>.yaml`
문항은 시험 때마다 설문·난이도에 따라 조합돼요(`exam_formats.yaml`의 `opic.blueprint`). 주제 파일 하나가 문항 묶음 하나예요.
```yaml
schema_version: 1
id: home                       # 파일 이름과 같아요
kind: survey                   # self_intro | survey | unexpected | roleplay
title_ko: 사는 곳
status: draft
questions:                     # kind별로 필요한 유형이 하나씩 있어야 해요 (exam_formats.yaml opic.topic_kinds)
  - id: home-description       # <주제 id>-<유형>
    type: description
    level: [1, 2, 3, 4, 5, 6]  # 이 문항이 나올 수 있는 난이도
    question: >-               # 영어 질문, 시험관이 말하듯 2~4문장 (≤300자). 설문 주제는 "You indicated in the survey that…"처럼 설문을 짚어요
      ...
    model:                     # il, im1, im2, im3, ih, al 레벨마다 답변 2개 이상 (answer_levels.yaml opic)
      il:
        - text: ...
          phrases: [...]       # 이 레벨에서 쓴 핵심 표현 (답변 본문에 그대로 있어야 해요)
      ...
    tip_ko: ...                # 해요체 한두 문장 (≤120자)
```
- 롤플레이(`kind: roleplay`)는 `situation_ko`(상황 한 줄)를 더 써요. `roleplay_ask`는 시험관에게 질문 3~4개를 하는 문항, `roleplay_solve`는 문제가 생겨 상대에게 상황을 설명하고 대안 2~3개를 내는 문항, `roleplay_experience`는 비슷한 문제를 겪은 경험을 말하는 문항이에요.
- 설문 선택지와 주제 연결은 `content/opic/survey/survey.yaml`에 있어요.
