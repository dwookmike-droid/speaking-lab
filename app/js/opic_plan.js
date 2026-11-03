// OPIc 문항 조합(순수 함수). 브라우저 없이 Node로 테스트할 수 있어요: node tests/test_opic_plan.mjs
// ── 문항 조합 (순수 함수: 브라우저 없이 테스트할 수 있어요) ──────────────
export function bandOf(format, sa) {
  return Object.entries(format.blueprint).find(([, b]) => b.levels.includes(sa))?.[0] || 'mid';
}

function pick(topic, type, d, rng) {
  const qs = (topic?.questions || []).filter((q) => q.type === type);
  const fit = qs.filter((q) => q.level.includes(d));
  const pool = fit.length ? fit : qs;
  return pool.length ? pool[Math.floor(rng() * pool.length)] : null;
}
const shuffle = (xs, rng) => xs.map((x) => [rng(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x);

// 설문에서 고른 주제(surveyTopics)와 자가평가(sa)로 시험 전체 계획을 세워요.
// 8번부터는 재조정 난이도(d)에 따라 마지막 묶음이 달라져서, 그 부분은 planRest()로 따로 정해요.
export function planExam(data, { surveyTopics, sa, rng = Math.random }) {
  const T = data.topics;
  const band = bandOf(data.format, sa);
  const chosen = shuffle(surveyTopics.filter((id) => T[id]?.kind === 'survey'), rng);
  if (chosen.length < 2) throw new Error('설문 주제가 두 개 이상 필요해요.');
  const unexpected = shuffle(Object.values(T).filter((t) => t.kind === 'unexpected').map((t) => t.id), rng)[0];
  const roleplay = shuffle(Object.values(T).filter((t) => t.kind === 'roleplay').map((t) => t.id), rng)[0];
  const selfIntro = Object.values(T).find((t) => t.kind === 'self_intro')?.id;
  return { band, sa, survey_topics: chosen, unexpected, roleplay, self_intro: selfIntro };
}

const COMBO = ['description', 'routine', 'past_experience'];
const RP = ['roleplay_ask', 'roleplay_solve', 'roleplay_experience'];

// 1~7번(재조정 전) 문항
export function planFirst(data, plan, rng = Math.random) {
  const T = data.topics, d = plan.sa, out = [];
  const add = (topicId, type) => { const q = pick(T[topicId], type, d, rng); if (q) out.push({ topic: topicId, qid: q.id, type: q.type }); };
  add(plan.self_intro, 'self_intro');
  for (const t of plan.survey_topics.slice(0, 2)) COMBO.forEach((ty) => add(t, ty));
  return out;
}

// 8번부터: d = 재조정한 난이도
export function planRest(data, plan, d, rng = Math.random) {
  const T = data.topics, out = [];
  const add = (topicId, type) => { const q = pick(T[topicId], type, d, rng); if (q) out.push({ topic: topicId, qid: q.id, type: q.type }); };
  const slots = data.format.blueprint[plan.band].slots.slice(3);   // self_intro, survey_combo ×2 다음부터
  for (const slot of slots) {
    if (slot === 'unexpected_combo') COMBO.forEach((ty) => add(plan.unexpected, ty));
    else if (slot === 'unexpected_combo_short') COMBO.slice(0, 2).forEach((ty) => add(plan.unexpected, ty));
    else if (slot === 'roleplay') RP.forEach((ty) => add(plan.roleplay, ty));
    else if (slot === 'roleplay_short') RP.slice(0, 2).forEach((ty) => add(plan.roleplay, ty));
    else if (slot === 'final') {
      if (d >= 4) { add(plan.survey_topics[0], 'comparison'); add(plan.unexpected, 'issue'); }
      else { const t = plan.survey_topics[2] || plan.survey_topics[1]; add(t, 'routine'); add(t, 'past_experience'); }
    }
  }
  return out;
}

export const findQuestion = (data, qid) => {
  for (const t of Object.values(data.topics)) { const q = t.questions.find((x) => x.id === qid); if (q) return { ...q, topic: t }; }
  return null;
};

export function planRestCount(data, plan) {
  const n = { unexpected_combo: 3, unexpected_combo_short: 2, roleplay: 3, roleplay_short: 2, final: 2 };
  return data.format.blueprint[plan.band].slots.slice(3).reduce((s, x) => s + (n[x] || 0), 0);
}
