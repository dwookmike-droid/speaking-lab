# 제출 · 전사 · 피드백 파일 형식 (version 1)

```
[학생 앱] 결과 화면 "선생님께 보내기" → speaking-lab_<아이디>_<세트>_<응시ID>.zip
[선생님]  python3 tools/intake.py <zip>              → submissions/S001/<응시ID>/ (이름 없음) + students/roster.yaml
          python3 tools/transcribe.py <폴더>         → transcript.json (로컬 Whisper)
          Claude Code: "speaking-feedback 스킬로 <폴더> 피드백 써줘" → feedback.yaml
          python3 tools/validate_feedback.py <폴더>  → 오류 0 (개인정보 검사 포함)
          python3 tools/pack_feedback.py <폴더>      → feedback.json (학생에게 보내요)
[학생 앱] 홈 "피드백 불러오기" → 결과 화면에 문항별 피드백
```

## 1. 제출 꾸러미 (zip, 앱이 만들어요)
압축하지 않은 zip이에요(녹음은 이미 압축된 형식이라서요).

- `manifest.json`
  ```json
  {"type": "speaking_submission", "version": 1, "created_at": "...",
   "student": {"name": "...", "email": "...", "phone": "...", "under14": false, "exams": ["toeic"], "targets": {"toeic": "lv7"}},
   "consent": {"version": 1, "at": "...", "required": true, "optional": false, "overseas": true, "guardian": null},
   "consent_history": [...], "guardian": null,
   "attempt": {"id": "a...", "exam": "toeic", "set_id": "toeic-set01", "target": "lv7", "started_at": "...", "finished_at": "...", "no_mic": false},
   "items": [{"num": 1, "file": "audio/q01.webm", "mime": "audio/webm;codecs=opus", "ms": 45012}]}
  ```
- `audio/qNN.<webm|mp4|ogg>` — 문항 녹음

`target`은 학생이 제출할 때 고른 목표 레벨이에요(응시 시작 때 값이 아니라 지금 설정값).

## 2. 제출 폴더 (`tools/intake.py`가 만들어요, git 제외)
`submissions/<학생번호>/<응시ID>/`
- `attempt.json` — manifest에서 **이름·이메일·휴대폰·보호자를 뺀** 것 + `student_id`
- `audio/` — 녹음
- 이름·연락처·동의 기록은 `students/roster.yaml`과 `students/<학생번호>/consent/`에만 둬요.

## 3. 전사본 `transcript.json` (`tools/transcribe.py`)
```json
{"engine": "faster-whisper", "model": "small.en", "created_at": "...",
 "items": [{"num": 3, "file": "audio/q03.webm", "duration_s": 30.0,
            "text": "This is a picture of ...",
            "words": [{"w": "This", "start": 0.82, "end": 1.01}],
            "stats": {"words": 52, "speak_s": 27.4, "wpm": 113.9, "first_word_s": 0.82,
                      "pauses_over_1s": 3, "longest_pause_s": 2.1, "fillers": 4, "filler_words": ["uh", "um"]}}]}
```
- `wpm`은 첫 단어부터 마지막 단어까지 시간 기준이에요.
- 군말(filler): uh, um, er, ah, erm, hmm, mm, uhm.

## 4. 피드백 `feedback.yaml` (Claude Code가 `speaking-feedback` 스킬로 써요)
```yaml
schema_version: 1
student_id: S001                 # 이름은 절대 쓰지 않아요
attempt_id: a...
set_id: toeic-set01
target: lv7                      # attempt.json 값
overall:
  est_level: lv6                 # answer_levels.yaml 레벨 중 하나
  summary_ko: ...                # 2~3문장, 해요체
  strengths_ko: [...]            # 1~3개
  priorities_ko: [...]           # 다음 연습 우선순위 1~3개
items:                           # 녹음이 있는 문항마다 하나
  - num: 3
    est_level: lv6               # 지문 읽기(Q1–2)는 생략 가능
    good_ko: [...]               # 1~2개, 구체적으로
    fixes:                       # 0~3개
      - said: "..."              # 전사본에 실제로 있는 말 그대로
        better: "..."            # 목표 레벨 학생이 말할 법한 고친 문장
        why_ko: "..."            # 왜 고치는지 한 문장
    next_ko: "..."               # 이 문항 다음 연습 한 가지
    pronunciation: check         # check: 녹음을 들어 봐야 함 | ok | note
    teacher_note_ko: ""          # 선생님이 녹음을 듣고 덧붙이는 말(비워 두면 안 보여요)
```

## 5. 학생에게 보내는 `feedback.json` (`tools/pack_feedback.py`)
`{"type": "speaking_feedback", "version": 1, "attempt_id", "set_id", "target", "created_at", "overall", "items"}`
— `student_id`도 빼요. 학생 앱은 `attempt_id`로 응시 기록을 찾아 붙여요.
