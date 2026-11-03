#!/usr/bin/env bash
# 제출 → 받기 → 전사(테스트용) → 피드백(예시) → 검증 → 포장 → 학생 앱에서 불러오기, 한 번에 확인해요.
# 실제 학생 자료가 남지 않게 임시 폴더를 SPEAKING_LAB_ROOT로 써요. 앱 서버가 8765에서 돌아야 해요.
#   python3 -m http.server 8765 -d app &   →   bash tests/roundtrip.sh
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=$(mktemp -d)
export SPEAKING_LAB_ROOT="$OUT/teacher"
mkdir -p "$SPEAKING_LAB_ROOT"; ln -s "$PWD/schema" "$SPEAKING_LAB_ROOT/schema"; ln -s "$PWD/content" "$SPEAKING_LAB_ROOT/content"

node tests/e2e_submit.js submit "$OUT"
python3 tools/intake.py "$OUT/submission.zip"
DIR=$(ls -d "$SPEAKING_LAB_ROOT"/submissions/S001/*); ATT=$(basename "$DIR")
python3 tests/make_transcript.py tests/fixtures/student_set01.yaml "$DIR"
sed "s/__ATTEMPT__/$ATT/" tests/fixtures/feedback_set01.yaml > "$DIR/feedback.yaml"
python3 tools/validate_feedback.py "$DIR"
python3 tools/pack_feedback.py "$DIR"
node tests/e2e_submit.js import "$OUT" "$DIR/speaking-lab_feedback_$ATT.json"
echo "왕복 확인 끝: $OUT"
