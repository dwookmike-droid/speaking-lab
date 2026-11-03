// OPIc 화면: 설문 → 자가평가 → 마이크 확인 → 시험(질문 듣기 → 5초 다시 듣기 → 답변 → 다음 문제) → 7번 뒤 난이도 재조정
import { getAttempt, putAttempt } from './store.js';
import { hasMic, meter, openMic } from './media.js';
import { Aborted, Runner } from './runner.js';
import { planExam, planFirst, runOpic } from './opic.js';
import { esc, setCurrent, stopCurrent, target, TYPE_KO } from './views.js';

const $app = () => document.getElementById('app');
const PHASE_KO = { listen: '질문을 들어요', replay_window: '다시 들으려면 5초 안에 누르세요', speak: '답변하세요', readjust: '난이도 다시 고르기' };
const mmss = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ── 설문 ─────────────────────────────────────────
export function opicStart(data) {
  const sv = data.survey;
  const st = { answers: {} };
  const surveyStep = () => {
    $app().innerHTML = `
      <form class="panel onboard" id="f">
        <p class="step">1 / 3 · 배경 설문</p>
        <h1>나에 대해 알려 주세요</h1>
        <p class="muted">고른 주제에서 문항이 나와요. 여가·취미·운동·여행에서 모두 합쳐 주제 ${data.format.survey_min_topics}개 이상 골라요(사는 곳 포함).</p>
        ${sv.parts.map((p) => `<fieldset><legend>${esc(p.title_ko)}</legend>
          ${p.options.map((o) => `<label class="inline"><input type="${p.type === 'single' ? 'radio' : 'checkbox'}" name="${esc(p.id)}" value="${esc(o.key)}"
            ${(st.answers[p.id] || []).includes(o.key) ? 'checked' : ''}> ${esc(o.ko)}</label>`).join('')}
        </fieldset>`).join('')}
        <p class="muted" id="count"></p>
        <p class="err" id="err" role="alert"></p>
        <div class="btns"><a class="btn ghost" href="#/">취소</a><button class="btn primary">다음</button></div>
      </form>`;
    const f = $app().querySelector('#f');
    const topicsOf = () => {
      const keys = new Set([...f.querySelectorAll('input:checked')].map((x) => x.value));
      st.answers = Object.fromEntries(sv.parts.map((p) => [p.id, p.options.filter((o) => keys.has(o.key)).map((o) => o.key)]));
      return [...new Set(sv.parts.flatMap((p) => p.options).filter((o) => keys.has(o.key) && o.topic).map((o) => o.topic))];
    };
    const upd = () => { $app().querySelector('#count').textContent = `고른 주제 ${topicsOf().length}개`; };
    f.addEventListener('change', upd); upd();
    f.onsubmit = (e) => {
      e.preventDefault();
      const topics = topicsOf();
      const errs = [];
      for (const p of sv.parts.filter((x) => x.type === 'single')) if (!st.answers[p.id]?.length) errs.push(`${p.title_ko}을(를) 골라 주세요.`);
      if (topics.length < data.format.survey_min_topics) errs.push(`주제를 ${data.format.survey_min_topics}개 이상 골라 주세요.`);
      if (errs.length) { $app().querySelector('#err').textContent = errs.join(' '); return; }
      st.topics = topics;
      saStep();
    };
  };
  const saStep = () => {
    $app().innerHTML = `
      <form class="panel onboard" id="f">
        <p class="step">2 / 3 · 자가평가</p>
        <h1>지금 내 말하기 수준은?</h1>
        <p class="muted">고른 단계에 따라 문항 수(12~15)와 난이도가 달라져요. 목표 등급보다 한 단계 낮거나 비슷하게 고르는 게 보통이에요.</p>
        ${sv.self_assessment.map((x) => `<label class="sa"><input type="radio" name="sa" value="${x.level}" ${st.sa === x.level ? 'checked' : ''}>
          <b>${x.level}단계</b> ${esc(x.ko)}</label>`).join('')}
        <p class="err" id="err" role="alert"></p>
        <div class="btns"><button type="button" class="btn ghost" id="back">이전</button><button class="btn primary">다음</button></div>
      </form>`;
    const f = $app().querySelector('#f');
    f.querySelector('#back').onclick = surveyStep;
    f.onsubmit = (e) => {
      e.preventDefault();
      const v = f.querySelector('input[name=sa]:checked')?.value;
      if (!v) { f.querySelector('#err').textContent = '단계를 하나 골라 주세요.'; return; }
      st.sa = Number(v);
      micStep();
    };
  };
  const micStep = () => mic(async () => {
    const plan = planExam(data, { surveyTopics: st.topics, sa: st.sa });
    const first = planFirst(data, plan);
    const attempt = {
      id: `a${Date.now().toString(36)}`, exam: 'opic', setId: 'opic', target: target(data),
      startedAt: new Date().toISOString(), next: 1, answered: [], finishedAt: null, checks: {}, noMic: !hasMic(),
      survey: st.answers, plan, d: null, questions: first.map((q, i) => ({ ...q, num: i + 1 })),
    };
    await putAttempt(attempt);
    exam(data, attempt);
  });
  surveyStep();
}

export async function opicResume(data, attemptId) {
  const attempt = await getAttempt(attemptId);
  if (!attempt || attempt.exam !== 'opic') { $app().innerHTML = '<p class="panel">기록을 찾지 못했어요.</p>'; return; }
  if (attempt.deadline && new Date(attempt.deadline) < Date.now()) {
    attempt.finishedAt = new Date().toISOString(); attempt.timedOut = true; await putAttempt(attempt);
    location.hash = `#/result/${attempt.id}`; return;
  }
  mic(() => exam(data, attempt), `Q${attempt.next}부터 이어해요. 시험 시간은 처음 시작한 때부터 계속 흘러요.`);
}

function mic(onStart, note = '') {
  $app().innerHTML = `
    <section class="panel">
      <p class="step">3 / 3 · 마이크 확인</p>
      <h1>시작하기 전에</h1>
      ${note ? `<p>${esc(note)}</p>` : ''}
      <p>질문은 소리로만 나와요. 질문이 끝나고 5초 안에 한 번 다시 들을 수 있어요. 답을 다 하면 '다음 문제'를 눌러요.</p>
      <div class="mic"><button class="btn" id="mic">마이크 켜기</button><div class="meter"><i id="lvl"></i></div><span id="micmsg" class="muted"></span></div>
      <div class="btns"><button class="btn primary" id="go" disabled>시작</button><button class="btn ghost" id="nomic">녹음 없이 진행</button></div>
    </section>`;
  let stopMeter = () => {};
  const go = $app().querySelector('#go'), msg = $app().querySelector('#micmsg');
  const enable = async () => {
    try {
      await openMic();
      msg.textContent = '말해 보세요. 막대가 움직이면 돼요.';
      stopMeter = meter((v) => { const el = document.getElementById('lvl'); if (el) el.style.width = `${Math.min(100, v * 250)}%`; });
      go.disabled = false;
    } catch { msg.textContent = '마이크를 쓸 수 없어요. 브라우저 주소창의 마이크 권한을 확인해 주세요.'; }
  };
  $app().querySelector('#mic').onclick = enable;
  if (hasMic()) enable();
  const start = () => { stopMeter(); onStart(); };
  go.onclick = start; $app().querySelector('#nomic').onclick = start;
}

// ── 시험 ─────────────────────────────────────────
async function exam(data, attempt) {
  const runner = new Runner();
  setCurrent(runner);
  $app().innerHTML = `
    <section class="exam">
      <div class="exam-top"><b id="qno"></b><span class="muted">남은 시간 <b id="clock"></b></span></div>
      <div class="exam-body" id="body"></div>
      <div class="exam-bar">
        <div class="ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" class="bg"/><circle cx="50" cy="50" r="44" class="fg" id="arc"/></svg><span id="sec"></span></div>
        <div><div id="phase" class="phase"></div><div id="rec" class="rec" hidden>● 녹음 중</div></div>
        <div class="btns right"><button class="btn" id="replay" hidden>다시 듣기</button><button class="btn primary" id="skip">다음</button><button class="btn ghost" id="quit">그만두기</button></div>
      </div>
    </section>`;
  const q = (s) => $app().querySelector(s);
  const C = 2 * Math.PI * 44; const arc = q('#arc'); arc.style.strokeDasharray = C;
  let replayFn = null;
  q('#replay').onclick = () => replayFn?.();
  q('#skip').onclick = () => runner.skip();
  q('#quit').onclick = () => { stopCurrent(); location.hash = '#/'; };
  const ui = {
    question(n, total, qq, { showText }) {
      q('#qno').textContent = `Question ${n} of ${total}`;
      q('#body').innerHTML = `<p class="muted">${esc(TYPE_KO[qq.type] || '')}${qq.topic?.kind === 'roleplay' ? ' · 롤플레이' : ''}</p>
        ${showText ? `<p class="question">${esc(qq.question)}</p>` : '<div class="listen-only">🔊 질문은 소리로만 나와요</div>'}`;
    },
    phase(kind, sec) {
      q('#phase').textContent = PHASE_KO[kind] || kind; q('#phase').dataset.kind = kind;
      q('#skip').textContent = kind === 'speak' ? '다음 문제' : '건너뛰기';
      if (!sec) { q('#sec').textContent = ''; arc.style.strokeDashoffset = 0; }
    },
    tick(left, tot) {
      const kind = q('#phase').dataset.kind;
      q('#sec').textContent = kind === 'speak' ? mmss(tot - left) : Math.ceil(left);   // 답변은 지난 시간, 나머지는 남은 시간
      arc.style.strokeDashoffset = C * (1 - left / tot);
    },
    clock(left) { q('#clock').textContent = Number.isFinite(left) ? mmss(left) : ''; },
    recording(on) { q('#rec').hidden = !on; },
    replay(on, fn) { q('#replay').hidden = !on; if (fn) replayFn = fn; },
    readjust() {
      return new Promise((res) => {
        q('#qno').textContent = '난이도 다시 고르기';
        q('#body').innerHTML = `<h2>남은 문항의 난이도를 골라 주세요</h2>
          <p class="muted">지금까지와 비교해서 고르면 돼요. 고른 난이도에 따라 마지막 문항(비교·사회 이슈 등)이 달라져요.</p>
          <div class="btns" id="ra"><button class="btn" data-v="easier">더 쉽게</button><button class="btn primary" data-v="same">비슷하게</button><button class="btn" data-v="harder">더 어렵게</button></div>`;
        q('#ra').onclick = (e) => { const v = e.target.closest('button')?.dataset.v; if (v) res(v); };
      });
    },
  };
  try {
    await runOpic({ data, attempt, ui, runner });
    setCurrent(null);
    location.hash = `#/result/${attempt.id}`;
  } catch (e) {
    if (!(e instanceof Aborted)) {
      console.error(e);
      q('#body').innerHTML = `<p class="err">진행 중 문제가 생겼어요: ${esc(e.message)}. 홈에서 이어하기로 다시 시작할 수 있어요.</p>`;
    }
  }
}
