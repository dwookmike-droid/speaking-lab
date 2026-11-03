# 배포 (P6b)

학생이 쓰는 주소: **https://dwookmike-droid.github.io/speaking-lab/** (GitHub Pages, HTTPS라 마이크가 돼요)

`main`에 병합하면 `.github/workflows/pages.yml`이 검증(콘텐츠·빌드 일치·선생님 도구 테스트) 뒤에 `app/` 폴더를 배포해요.
앱 화면과 문항은 공개 주소로 열리지만, 학생 정보·녹음·피드백은 로그인과 Supabase 접근 규칙이 지켜요.

## 처음 한 번 (선생님)
1. **Supabase SQL** — `supabase/SETUP.md` 1절: R&R archive SQL Editor에서 `supabase/001_speaking.sql` 실행.
   이걸 안 하면 학생이 로그인한 뒤 "서버 오류"가 나요.
2. **Pages 켜기** — 리포 Settings → Pages → Build and deployment → Source: **GitHub Actions**.
   - 비공개 리포에서 Pages를 쓰려면 GitHub Pro가 필요해요. 무료 계정이면 리포를 공개로 바꿔요(Settings → General → Danger Zone → Change visibility).
     공개해도 되는 이유: 앱 코드와 문항은 어차피 배포 주소에서 보이고, `app/config.js`의 키는 공개용(publishable) 키예요. 학생 자료(`students/`, `submissions/`)는 git에 올리지 않아요.
3. **병합** — PR을 1 → 6 → 배포 PR 순서로 `main`에 병합하면 Actions가 돌고 1~2분 뒤 주소가 열려요.
4. **동의서 처리자 정보** — `content/legal/consent_v2.yaml`의 `operator`(이름·연락처)와 `status`를 고치고 `python3 tools/build.py` → 커밋.
   빈칸(`[선생님 이름]`) 그대로 학생에게 보이면 안 돼요.

## 첫 학생 전에 확인 (휴대폰)
| 확인 | 아이폰 사파리 | 안드로이드 크롬 |
|---|---|---|
| 마이크 권한 창이 뜨고 막대가 움직여요 | ☐ | ☐ |
| 토익 모의고사 1번~2번까지 녹음되고 결과에서 다시 들려요 | ☐ | ☐ |
| OPIc 질문 소리가 나와요(무음 모드 해제) | ☐ | ☐ |
| '선생님께 보내기' → `cloud_sync.py pull`로 받아져요 | ☐ | ☐ |
| `transcribe.py`가 그 녹음을 받아 적어요(아이폰은 mp4) | ☐ | ☐ |
| `push` 뒤 앱 홈에 '피드백 도착' | ☐ | ☐ |
| 홈 화면에 추가해도 로그인이 유지돼요 | ☐ | ☐ |

## 학생에게 보낼 안내 (예시)
> Speaking Lab 주소: https://dwookmike-droid.github.io/speaking-lab/
> 1) '처음 왔어요' → 아이디(영문 소문자·숫자)와 PIN(숫자 4~8자리)을 정하고, 등록 코드 ○○○○○○○○ 를 넣어요.
> 2) 안내 → 내 정보 → 동의를 마치면 시작해요. 조용한 곳에서 이어폰을 끼고 해 주세요.
> 3) 다 끝나면 결과 화면에서 '선생님께 보내기'를 눌러요. 피드백이 오면 홈에 '피드백 도착'이 떠요.

## 문제가 생기면
- 배포가 안 되면: 리포 Actions 탭에서 실패한 단계를 봐요. "app/data 를 커밋해 주세요"면 `python3 tools/build.py` 결과를 커밋하지 않은 거예요.
- 학생 화면이 예전 그대로면: GitHub Pages 캐시(최대 10분)예요. 잠시 뒤 새로고침해요.
- 서버 없이 확인하려면 주소 뒤에 `?sb=off`를 붙여요(기기 안에서만, 제출은 zip).
