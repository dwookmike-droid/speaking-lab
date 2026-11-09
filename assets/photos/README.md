# 사진 창고

문항에 쓸 실사진을 미리 모아 두는 곳이에요. 앱(`app/`)에는 올라가지 않아요.

- 파트별 폴더: `toeic_q3q4/` (토익 Q3–4 사진 묘사). 파트 안에서 장면별 폴더(`office/`, `street/` …)로 나눠요.
- 검색어·라이선스·출처: `queries.yaml`. 지금은 CC0·퍼블릭 도메인만, StockSnap에서만 받아요.
- 사진 정보: `<파트>/index.yaml` — 출처, 작가, 라이선스, 원본 주소, 상태.

## 상태
| status | 뜻 |
|---|---|
| candidate | 받기만 했어요. 아직 검수 전 |
| approved | 상표·로고·읽히는 간판이 없고, 사람 2명 이상·동작이 분명해서 문항에 쓸 수 있어요 |
| rejected | 못 써요. 파일은 지우고 기록은 남겨서 다시 받지 않아요 (`note`에 이유) |
| used | 문항에 썼어요 (`used_in`에 세트·문항) |

## 쓰는 법
```bash
python3 tools/collect_photos.py collect --part toeic_q3q4 --budget 60   # 장면을 돌아가며 새 사진 받기 (하루 200회 한도)
python3 tools/collect_photos.py sheet --part toeic_q3q4                 # test-shots/photo-sheets/에 검수용 모아보기
python3 tools/collect_photos.py mark --part toeic_q3q4 <id> --status approved
python3 tools/collect_photos.py summary                                 # 파트·장면·상태별 장수
```
문항에 쓸 때는 approved 사진을 `app/img/toeic/setNN_qN.webp`로 복사하고, `content/credits.yaml`에 등록한 뒤 `mark ... --status used --used-in "set05 Q3"`로 바꿔요.
