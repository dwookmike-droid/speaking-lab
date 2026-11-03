# Supabase 설정 (R&R archive)

Speaking Lab은 rw-english와 같은 Supabase 프로젝트 **R&R archive**(`abaakjkidxsnfigqfcbx`)를 같이 써요.
새 이름은 모두 `speaking_`으로 시작하고, 기존 rw-english 표는 건드리지 않아요.

## 1. 한 번만: 표·버킷·규칙 만들기
1. Supabase 대시보드 → R&R archive → **SQL Editor**
2. `supabase/001_speaking.sql`을 통째로 붙여넣고 **Run** (여러 번 돌려도 돼요)
3. **Storage**에 `speaking-audio` 버킷이 생겼는지, **Public이 꺼져 있는지** 확인해요.

이 SQL은 `public.teachers`, `public.is_teacher()`(rw-english `schema.sql`)를 그대로 써요. 선생님 계정은 rw-english와 같아요.

로컬 Postgres에서 접근 규칙을 확인하는 테스트: `python3 -m unittest tests/test_supabase_rls.py`
(학생 A·B, 등록 안 한 rw 학생, 선생님 네 계정으로 남의 자료를 못 보는지, 쓴 등록 코드를 다시 못 쓰는지 등을 확인해요)

## 2. 확인할 설정 (rw-english와 같아요)
- Authentication → Sign In / Providers → **Confirm email 꺼짐** — 학생 계정은 `<아이디>@speaking.local`이라 받을 메일함이 없어요.
- 가입은 열려 있어도 괜찮아요. 등록 코드로 `speaking_claim()`을 거친 계정만 Speaking Lab 자료에 닿아요.

## 3. 선생님 도구
선생님 계정 이메일·비밀번호를 환경변수로 줘요(파일에 적지 않아요).
```bash
export SL_TEACHER_EMAIL='선생님 계정 이메일'
export SL_TEACHER_PASSWORD='비밀번호'
```
```bash
python3 tools/cloud_sync.py invite --note "화요일 7시반"   # 새 학생: 학생 번호 + 등록 코드(8자리, 14일, 1회용)
python3 tools/cloud_sync.py pull                           # 새 제출 받기 → submissions/S00N/<응시ID>/ + students/roster.yaml
python3 tools/transcribe.py submissions/S001/<응시ID>
# Claude Code: "speaking-feedback 스킬로 submissions/S001/<응시ID> 피드백 써줘"
python3 tools/cloud_sync.py push submissions/S001/<응시ID> # 검증·포장 후 올리기 → 학생 앱에 '피드백 도착'
python3 tools/cloud_sync.py delete S001                    # 보유 기간 끝·철회: 서버의 녹음·응시·학생 정보 삭제
```
`pull`은 동의를 철회한 학생도 알려 줘요. 그때는 `purge.py --student S00N --now --apply`와 `cloud_sync.py delete S00N`을 같이 돌려요.

## 4. 학생
1. 선생님께 등록 코드를 받아요.
2. 앱 → **처음 왔어요** → 아이디(영문 소문자·숫자)·PIN(숫자 4~8자리)·등록 코드
3. 안내 → 학생 정보 → 동의 → 시험. 제출하면 녹음이 바로 선생님께 가요.
4. 다른 기기에서도 같은 아이디·PIN으로 로그인하면 이어서 써요. 녹음은 응시한 기기에만 있고, 제출한 것은 서버에 있어요.

PIN을 잊으면: Supabase 대시보드 → Authentication → 그 학생 계정(`<아이디>@speaking.local`) 비밀번호를 `<새 PIN>-spk`로 바꿔 줘요.

## 무료 요금제에서 조심할 것
- 저장 공간 1GB: 응시 한 번에 녹음 약 2~4MB예요. 보유 기간이 지나면 `cloud_sync.py delete`로 지워요.
- 일주일 동안 아무 요청이 없으면 프로젝트가 일시 정지돼요. rw-english와 같이 쓰니 보통은 괜찮아요.

## 이 환경에서 확인하지 못한 것
작업한 클라우드 환경은 supabase.co 접속이 막혀 있어서 실제 프로젝트에는 붙여 보지 않았어요. 대신
`tests/test_supabase_rls.py`(로컬 Postgres로 규칙 확인)와 `tests/e2e_cloud.js`(가짜 Supabase로 앱·도구 왕복)로 확인했어요.
SQL을 실행한 뒤 학생 계정 하나로 가입 → 제출 → pull → push를 한 번 해 보세요.
