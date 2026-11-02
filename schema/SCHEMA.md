# 콘텐츠 스키마 (schema_version: 1)

시간 값은 `exam_formats.yaml`, 글자 수는 `limits.yaml`. 검증: `python3 tools/validate_content.py --all`

## 토익 세트 — `content/toeic/sets/setNN.yaml`
```yaml
schema_version: 1
id: toeic-set01
status: draft                # draft | ready | reviewed
items:                       # 정확히 11개, no 1~11 순서대로
  - no: 1
    type: read_aloud
    text: "..."              # 읽을 지문 (영어)
    model: {l7: "...", l8: null}   # 지문 읽기는 모범답변 대신 끊어 읽기·강세 표시
    marks: "Welcome to / City Museum. // ..."   # / 짧게 쉼, // 길게 쉼, **강세**
    tip_ko: "..."
  - no: 3
    type: describe_photo
    image: img/toeic/set01_q3.webp
    credit: "..."            # 사진 출처 (credits.yaml id)
    model: {l7: "...", l8: "..."}
    tip_ko: "..."
  - no: 5                    # 5~7은 같은 상황(context) 하나를 같이 써요
    type: respond_q
    context: "Imagine that a marketing firm is doing research ... about movies."
    question: "..."
    model: {l7: "...", l8: "..."}
  - no: 8                    # 8~10은 자료(info) 하나를 같이 써요
    type: info_based
    info: {title: "...", rows: [["9:00 a.m.", "Opening remarks"], ...]}
    question: "..."          # 음성으로만 나가는 질문 (화면에는 안 보임)
    model: {l7: "...", l8: "..."}
  - no: 11
    type: opinion
    question: "..."
    model: {l7: "...", l8: "..."}
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
    model: {im2: "...", ih: "..."}
    tip_ko: "..."
```
