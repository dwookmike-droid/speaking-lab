// OPIc 문항 조합 테스트: node tests/test_opic_plan.mjs  (app/data/opic.json이 빌드돼 있어야 해요)
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { planExam, planFirst, planRest, bandOf, findQuestion } from '../app/js/opic_plan.js';

const data = JSON.parse(readFileSync(new URL('../app/data/opic.json', import.meta.url)));
let seed = 42; const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const survey = Object.values(data.topics).filter((t) => t.kind === 'survey').map((t) => t.id).slice(0, 4);

for (const [sa, delta, wantN] of [[1, 0, 12], [2, 1, 12], [3, 0, 15], [4, -1, 15], [5, 0, 15], [6, 1, 15]]) {
  const plan = planExam(data, { surveyTopics: survey, sa, rng });
  const first = planFirst(data, plan, rng);
  assert.strictEqual(first.length, 7, 'Q1~7');
  assert.deepStrictEqual(first.map((q) => q.type), ['self_intro', 'description', 'routine', 'past_experience', 'description', 'routine', 'past_experience']);
  assert.notStrictEqual(first[1].topic, first[4].topic, '두 콤보는 다른 주제');
  const d = Math.min(6, Math.max(1, sa + delta));
  const rest = planRest(data, plan, d, rng);
  const all = [...first, ...rest];
  assert.strictEqual(all.length, wantN, `sa=${sa} 문항 수`);
  assert.strictEqual(new Set(all.map((q) => q.qid)).size, all.length, '같은 문항이 두 번 나오지 않아요');
  all.forEach((q) => assert.ok(findQuestion(data, q.qid), `문항 ${q.qid}`));
  const last2 = rest.slice(-2).map((q) => q.type).join(',');
  if (bandOf(data.format, sa) !== 'low') assert.strictEqual(last2, d >= 4 ? 'comparison,issue' : 'routine,past_experience', `final d=${d}`);
  console.log(`sa=${sa} d=${d} band=${plan.band} ${all.length}문항: ${all.map((q) => q.type.replace('roleplay_', 'rp_')).join(' ')}`);
}
console.log('OK');
