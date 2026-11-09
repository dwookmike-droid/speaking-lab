// 화면: 홈 · 마이크 확인 · 시험 진행 · 결과
import { getAttempt, getProfile, getRecording, getSetting, listAttempts, putAttempt, putProfile, setSetting } from './store.js';
import { hasMic, recIndicator, REC_HTML, stopSpeaking } from './media.js';
import { SOUNDCHECK_HTML, wireSoundCheck } from './soundcheck.js';
import { Aborted, DEV, Runner } from './runner.js';
import { runToeic } from './toeic.js';
import { findQuestion } from './opic_plan.js';
import { buildSubmission, cloudSubmit, importFeedback, markSubmitted, shareOrDownload, syncFeedback } from './submit.js';
import { cloud } from './cloud.js';

const $app = () => document.getElementById('app');
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const TYPE_KO = { read_aloud: '지문 읽기', describe_photo: '사진 묘사', respond_q: '듣고 답하기', info_based: '자료 보고 답하기', opinion: '의견 말하기',
  self_intro: '자기소개', description: '묘사', routine: '습관·일상', past_experience: '과거 경험', comparison: '비교', issue: '사회 이슈',
  roleplay_ask: '롤플레이 · 질문하기', roleplay_solve: '롤플레이 · 문제 해결', roleplay_experience: '롤플레이 · 관련 경험' };
// 시험 화면은 실제 시험처럼 영어로만 보여 줘요.
const PHASE_EN = { directions: 'Directions', listen: 'Listen', read: 'READING TIME', prep_cue: 'Begin preparing now.', prep: 'PREPARATION TIME', beep: 'Begin speaking now.', speak: 'RESPONSE TIME' };
export const hms = (sec) => { const t = Math.max(0, Math.ceil(sec)); return `00:${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

let current = null;   // 진행 중인 Runner
export function setCurrent(r) { stopCurrent(); current = r; }
export function stopCurrent() { if (current) { current.abort(); current = null; stopSpeaking(); } }

export const target = (data) => {
  const t = getSetting(`target.${data.exam}`, data.exam === 'opic' ? 'im2' : 'lv6');
  return data.levels.levels.includes(t) ? t : data.levels.levels[0];
};
export const levelLabel = (data, lv) => {
  const l = data.levels.labels[lv] || {};
  return `${l.name || lv}${l.score ? ` (${l.score})` : ''}`;
};
export function levelSelect(data, onChange) {
  const sel = document.createElement('select');
  sel.id = data.exam === 'opic' ? 'target-opic' : 'target';
  sel.innerHTML = data.levels.levels.map((lv) => `<option value="${lv}">${esc(levelLabel(data, lv))}</option>`).join('');
  sel.value = target(data);
  sel.onchange = async () => {
    setSetting(`target.${data.exam}`, sel.value);
    const p = await getProfile();                       // 학생 정보의 목표 레벨도 같이 바꿔요(제출 꾸러미에 들어가요)
    if (p) { p.targets = { ...(p.targets || {}), [data.exam]: sel.value }; await putProfile(p); }
    onChange?.(sel.value);
  };
  return sel;
}
export const fmtDate = (iso) => { try { return new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return iso; } };

// ── 홈 ──────────────────────────────────────────────
export async function home(data, profile, opicData) {
  const app = $app();
  const exams = profile?.exams?.length ? profile.exams : ['toeic'];
  app.innerHTML = `
    ${profile?.name ? `<p class="muted">${esc(profile.name)} 님, 안녕하세요.</p>` : ''}
    ${exams.includes('toeic') ? `<section class="panel">
      <h1>토익스피킹 모의테스트</h1>
      <label class="row">목표 레벨 <span id="lvslot"></span></label>
      <p class="muted">결과 화면에서 이 레벨의 모범답변이 먼저 나와요. 언제든 바꿀 수 있어요.</p>
      <h2>세트</h2><div class="list" id="sets"></div>
    </section>` : ''}
    ${exams.includes('opic') && opicData ? `<section class="panel" id="opic-panel">
      <h1>OPIc 모의고사</h1>
      <label class="row">목표 등급 <span id="lvslot-opic"></span></label>
      <p class="muted">설문과 자가평가로 매번 다른 문항이 조합돼요. 약 40분, 문항마다 답하고 '다음 문제'를 눌러요.</p>
      <div class="btns"><a class="btn primary" href="#/opic/start">응시 시작</a></div>
    </section>` : ''}
    <section class="panel"><h2>최근 응시</h2><div class="list" id="recent"><p class="muted">아직 없어요.</p></div></section>
    <section class="panel"><h2>피드백 불러오기</h2>
      <p class="muted">선생님이 보낸 피드백 파일(.json)을 고르면 그 응시의 결과 화면에 붙어요.</p>
      <label class="btn" for="fbfile">파일 고르기</label><input type="file" id="fbfile" accept=".json,application/json" hidden>
      <p class="err" id="fberr" role="alert"></p></section>`;
  app.querySelector('#lvslot')?.append(levelSelect(data));
  if (opicData) app.querySelector('#lvslot-opic')?.append(levelSelect(opicData));
  if (app.querySelector('#sets')) app.querySelector('#sets').innerHTML = data.sets.map((s) => `
    <div class="li"><div><b>${esc(s.title_ko || s.id)}</b>${s.status === 'draft' ? ' <span class="tag">초안</span>' : ''}
    <div class="muted">${s.items.length}문항 · 약 20분</div></div>
    <a class="btn primary" href="#/start/${encodeURIComponent(s.id)}">응시 시작</a></div>`).join('');
  app.querySelector('#fbfile').onchange = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try { location.hash = `#/result/${await importFeedback(f)}`; }
    catch (err) { app.querySelector('#fberr').textContent = err.message; }
    e.target.value = '';
  };
  if (cloud.enabled) { try { await syncFeedback(); } catch { /* 오프라인이면 다음에 */ } }
  let attempts = [];
  try { attempts = await listAttempts(); } catch { /* 저장소를 못 열면 기록 없이 */ }
  if (attempts.length) {
    const title = (id) => (id === 'opic' ? 'OPIc 모의고사' : data.sets.find((s) => s.id === id)?.title_ko || id);
    app.querySelector('#recent').innerHTML = attempts.slice(0, 10).map((a) => `
      <div class="li"><div><b>${esc(title(a.setId))}</b> <span class="muted">${esc(fmtDate(a.startedAt))}</span>
      <div class="muted">${a.finishedAt ? '완료' : `진행 중 · Q${a.next}부터`}${a.submittedAt ? ' · 보냄' : ''}${a.feedback ? ' · <b class="fbtag">피드백 도착</b>' : ''}</div></div>
      <div class="btns">${a.finishedAt ? '' : `<a class="btn" href="#/${a.exam === 'opic' ? 'opic/resume' : 'resume'}/${a.id}">이어하기</a>`}
      <a class="btn" href="#/result/${a.id}">결과</a></div></div>`).join('');
  }
}

// ── 마이크 확인 → 시험 ──────────────────────────────
export async function prepareExam(data, { setId, attemptId }) {
  let attempt = attemptId ? await getAttempt(attemptId) : null;
  const set = data.sets.find((s) => s.id === (attempt?.setId || setId));
  if (!set) { $app().innerHTML = `<p class="panel">세트를 찾지 못했어요.</p>`; return; }
  const app = $app();
  app.innerHTML = `
    <section class="panel">
      <h1>${esc(set.title_ko)} ${attempt ? `<small>· Q${attempt.next}부터 이어하기</small>` : ''}</h1>
      <p>실제 시험과 똑같이 진행해요. 시작하면 안내·질문이 영어로만 나오고, 시간이 되면 자동으로 넘어가요. 중간에 건너뛸 수 없어요.</p>
      ${SOUNDCHECK_HTML}
      <div class="btns">
        <button class="btn primary" id="go" disabled>시작</button>
        <button class="btn ghost" id="nomic">녹음 없이 진행</button>
      </div>
    </section>`;
  const go = app.querySelector('#go');
  const stopMeter = wireSoundCheck(app, () => { go.disabled = false; });
  const start = async () => {
    stopMeter();
    if (!attempt) {
      attempt = { id: `a${Date.now().toString(36)}`, exam: 'toeic', setId: set.id, target: target(data),
        startedAt: new Date().toISOString(), next: 1, answered: [], finishedAt: null, checks: {}, noMic: !hasMic() };
      await putAttempt(attempt);
    }
    exam(data, set, attempt);
  };
  go.onclick = start;
  app.querySelector('#nomic').onclick = start;
}

function examUI(app, data, set) {
  const total = data.format.total_items;
  app.innerHTML = `
    <section class="exam">
      <div class="exam-top"><b id="qno"></b></div>
      <div class="exam-body" id="body"></div>
      <div class="exam-bar">
        <div class="timer"><div id="phase" class="phase"></div><div id="sec" class="tval"></div></div>
        <div>${REC_HTML}</div>
        <div class="btns right"><button class="btn" id="skip" ${DEV ? '' : 'hidden'}>건너뛰기</button><button class="btn ghost" id="quit">Exit</button></div>
      </div>
    </section>`;
  const q = (s) => app.querySelector(s);
  const ui = {
    part(part, dir) {
      q('#qno').textContent = dir.title || part.type;
      q('#body').innerHTML = `<div class="directions"><p class="en">${esc(dir.en)}</p></div>`;
    },
    item(item, { part, context, info, showQuestion }) {
      q('#qno').textContent = `Question ${item.num} of ${total}`;
      let html = '';
      if (context) html += `<p class="context">${esc(context)}</p>`;
      if (info) html += infoTable(info);
      if (item.type === 'read_aloud') html += `<p class="readtext">${esc(item.text)}</p>`;
      if (item.type === 'describe_photo') html += `<img class="photo" src="${esc(item.image)}" alt="Question ${item.num} picture">`;
      if (showQuestion && item.question) html += `<p class="question">${esc(item.question)}</p>`;
      q('#body').innerHTML = html;
    },
    phase(kind, sec) {
      q('#phase').textContent = PHASE_EN[kind] || kind;
      q('#phase').dataset.kind = kind;
      q('#sec').textContent = sec ? hms(sec) : '';
    },
    tick(left) { q('#sec').textContent = hms(left); },
    recording: recIndicator(q('#rec')),
  };
  return ui;
}

export function infoTable(info) {
  return `<div class="info"><h3>${esc(info.title)}</h3>${info.subtitle ? `<p class="muted">${esc(info.subtitle)}</p>` : ''}
    <table>${(info.rows || []).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div>`;
}

async function exam(data, set, attempt) {
  stopCurrent();
  const runner = new Runner();
  current = runner;
  const app = $app();
  const ui = examUI(app, data, set);
  app.querySelector('#skip').onclick = () => runner.skip();
  app.querySelector('#quit').onclick = () => { stopCurrent(); location.hash = '#/'; };
  try {
    await runToeic({ data, set, attempt, ui, runner });
    current = null;
    location.hash = `#/result/${attempt.id}`;
  } catch (e) {
    if (!(e instanceof Aborted)) {
      console.error(e);
      app.querySelector('#body').innerHTML = `<p class="err">진행 중 문제가 생겼어요: ${esc(e.message)}. 홈에서 이어하기로 다시 시작할 수 있어요.</p>`;
    }
  }
}

// ── 결과 ──────────────────────────────────────────────
function highlight(text, phrases) {
  const raw = String(text || '');
  const ranges = [];
  for (const p of phrases || []) {
    if (!p || p.includes('~')) continue;
    const re = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    for (const m of raw.matchAll(re)) ranges.push([m.index, m.index + m[0].length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let out = '', pos = 0;
  for (const [s, e] of ranges) {
    if (s < pos) continue;
    out += esc(raw.slice(pos, s)) + `<mark>${esc(raw.slice(s, e))}</mark>`;
    pos = e;
  }
  return out + esc(raw.slice(pos));
}
export function renderMarks(marks) {
  return esc(marks).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/ \/\/ ?/g, ' <span class="p2">//</span> ').replace(/ \/ /g, ' <span class="p1">/</span> ');
}

function modelBlock(data, item, lv) {
  const levels = data.levels.levels;
  const answers = (item.model || {})[lv] || [];
  const label = levelLabel(data, lv);
  if (!answers.length) return `<div class="model"><div class="muted">${esc(label)} 답변은 아직 준비 중이에요.</div></div>`;
  return `<div class="model" data-lv="${lv}" data-i="0">
    <div class="model-head"><b>${esc(label)}</b>
      ${answers.length > 1 ? `<span class="pager"><button class="btn sm" data-act="prev">‹</button> <span class="pi">1</span>/${answers.length} <button class="btn sm" data-act="next">›</button></span>` : ''}
    </div>
    ${answers.map((a, i) => {
      const t = typeof a === 'string' ? { text: a } : a;
      return `<div class="answer" ${i ? 'hidden' : ''}><p>${highlight(t.text, t.phrases)}</p>
        ${t.phrases?.length ? `<div class="chips">${t.phrases.map((p) => `<span class="chip">${esc(p)}</span>`).join('')}</div>` : ''}
        <button class="btn sm" data-act="say" data-text="${esc(t.text)}">▶ 들어 보기</button></div>`;
    }).join('')}
    ${levels.indexOf(lv) < levels.length - 1 ? `<button class="btn sm ghost" data-act="up" data-next="${levels[levels.indexOf(lv) + 1]}">한 단계 위 답변 보기</button><div class="up"></div>` : ''}
  </div>`;
}

export async function result(data, attemptId) {
  const app = $app();
  const attempt = await getAttempt(attemptId);
  if (!attempt) { app.innerHTML = `<p class="panel">기록을 찾지 못했어요.</p>`; return; }
  // 토익은 세트 문항, OPIc는 응시 때 조합한 문항 목록이에요
  const set = data.exam === 'opic'
    ? { id: 'opic', title_ko: 'OPIc 모의고사', items: (attempt.questions || []).filter((it) => it.num < attempt.next || attempt.finishedAt)
        .map((it) => ({ ...findQuestion(data, it.qid), num: it.num, qid: it.qid })) }
    : data.sets.find((s) => s.id === attempt.setId);
  const lv = target(data);
  const urls = [];
  app.innerHTML = `
    <section class="panel">
      <h1>${esc(set?.title_ko || attempt.setId)} 결과 <small class="muted">${esc(fmtDate(attempt.startedAt))}</small></h1>
      <label class="row">목표 레벨 <span id="lvslot"></span></label>
      ${attempt.finishedAt ? (attempt.timedOut ? '<p class="muted">시험 시간이 끝나서 남은 문항 없이 마쳤어요.</p>' : '') : `<p>아직 다 끝내지 않았어요. <a href="#/${attempt.exam === 'opic' ? 'opic/resume' : 'resume'}/${attempt.id}">Q${attempt.next}부터 이어하기</a></p>`}
      <p class="muted" id="sum"></p>
      <div class="btns"><button class="btn primary" id="submit">${attempt.submittedAt ? '선생님께 다시 보내기' : '선생님께 보내기'}</button></div>
      <p class="muted" id="submitmsg">${attempt.submittedAt ? `${esc(fmtDate(attempt.submittedAt))}에 보냈어요.` : cloud.enabled ? '녹음을 선생님께 바로 올려요. 피드백이 오면 홈에 "피드백 도착"이 떠요.' : '녹음 파일을 묶어서 카톡 등으로 보내요. 휴대폰이 아니면 파일로 내려받아져요.'}</p>
    </section>
    ${attempt.feedback ? overallFeedback(data, attempt.feedback) : ''}
    <div id="cards"></div>`;
  app.querySelector('#lvslot').append(levelSelect(data, () => result(data, attemptId)));
  if (attempt.feedback?.cloud && !attempt.feedback.read_at) {          // 선생님이 학생이 피드백을 봤는지 알 수 있게
    cloud.markRead(attempt.id).then(() => { attempt.feedback.read_at = new Date().toISOString(); return putAttempt(attempt); }).catch(() => {});
  }
  const cards = app.querySelector('#cards');
  let checked = 0, totalChecks = 0;
  const recs = await Promise.all(set.items.map((it) => getRecording(attempt.id, it.num).catch(() => null)));
  const frag = document.createDocumentFragment();
  for (const [idx, item] of set.items.entries()) {
    const rec = recs[idx];
    let audio = '<p class="muted">녹음 없음</p>';
    if (rec?.blob?.size) { const u = URL.createObjectURL(rec.blob); urls.push(u); audio = `<audio controls preload="metadata" src="${u}"></audio>`; }
    const list = data.checklists[item.type] || [];
    const mine = attempt.checks?.[item.num] || [];
    checked += mine.length; totalChecks += list.length;
    const prompt = data.exam === 'opic'
      ? `${item.topic?.situation_ko ? `<p class="context sm">${esc(item.topic.situation_ko)}</p>` : ''}<p class="question">${esc(item.question)}</p>`
      : item.type === 'read_aloud' ? `<p class="readtext sm">${esc(item.text)}</p>`
      : item.type === 'describe_photo' ? `<img class="photo sm" src="${esc(item.image)}" alt="">`
      : `${item.context ? `<p class="context sm">${esc(item.context)}</p>` : ''}${item.info ? infoTable(item.info) : ''}<p class="question">${esc(item.question)}</p>`;
    const model = item.type === 'read_aloud'
      ? `<div class="model"><div class="model-head"><b>끊어 읽기 · 강세</b></div><p class="marks">${renderMarks(item.marks)}</p>
         <button class="btn sm" data-act="say" data-text="${esc(item.text)}">▶ 들어 보기</button></div>`
      : modelBlock(data, item, lv);
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.num = item.num;
    card.innerHTML = `
      <header><b>Q${item.num}</b> <span class="muted">${esc(TYPE_KO[item.type])}${item.topic?.title_ko && item.topic.title_ko !== TYPE_KO[item.type] ? ` · ${esc(item.topic.title_ko)}` : ''}</span></header>
      ${prompt}
      <h4>내 답변</h4>${audio}
      ${itemFeedback(data, attempt.feedback, item)}
      <h4>모범답변</h4>${model}
      ${item.tip_ko ? `<p class="tip">${esc(item.tip_ko)}</p>` : ''}
      <h4>스스로 점검</h4>
      <ul class="checks">${list.map((c, i) => `<li><label><input type="checkbox" data-num="${item.num}" data-i="${i}" ${mine.includes(i) ? 'checked' : ''}> ${esc(c)}</label></li>`).join('')}</ul>`;
    frag.append(card);
  }
  cards.append(frag);
  const sum = () => { app.querySelector('#sum').textContent = `스스로 점검 ${checked}/${totalChecks}개`; };
  sum();
  app.querySelector('#submit').onclick = async (e) => {
    const btn = e.currentTarget, msg = app.querySelector('#submitmsg');
    if (!attempt.finishedAt && !confirm('아직 다 끝내지 않은 응시예요. 지금까지 녹음한 문항만 보낼까요?')) return;
    btn.disabled = true;
    if (cloud.enabled) {
      try {
        const { count } = await cloudSubmit(attempt.id, set, (i, n) => { msg.textContent = `올리는 중이에요… ${i}/${n}`; });
        attempt.submittedAt = new Date().toISOString();
        msg.textContent = `녹음 ${count}개를 선생님께 보냈어요. 피드백이 오면 홈에 알려 드려요.`;
      } catch (err) { msg.textContent = `보내지 못했어요: ${err.message}`; }
      finally { btn.disabled = false; }
      return;
    }
    msg.textContent = '파일을 묶는 중이에요…';
    try {
      const { blob, name, count, attempt: a } = await buildSubmission(attempt.id, set);
      const how = await shareOrDownload(blob, name);
      if (how === 'canceled') { msg.textContent = '보내기를 취소했어요.'; return; }
      await markSubmitted(a); attempt.submittedAt = a.submittedAt;
      msg.textContent = how === 'shared' ? `녹음 ${count}개를 보냈어요.` : `녹음 ${count}개를 ${name} 파일로 내려받았어요. 이 파일을 선생님께 보내 주세요.`;
    } catch (err) { msg.textContent = err.message; }
    finally { btn.disabled = false; }
  };
  cards.addEventListener('change', async (e) => {
    const el = e.target; if (!el.matches('input[type=checkbox]')) return;
    const n = el.dataset.num, i = Number(el.dataset.i);
    const cur = new Set(attempt.checks?.[n] || []);
    if (el.checked) { cur.add(i); checked++; } else { cur.delete(i); checked--; }
    attempt.checks = { ...(attempt.checks || {}), [n]: [...cur].sort() };
    sum();
    await putAttempt(attempt);
  });
  cards.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const box = b.closest('.model');
    if (b.dataset.act === 'say') { sayOnce(b.dataset.text); return; }
    if (b.dataset.act === 'up') {
      const item = set.items.find((it) => it.num === Number(b.closest('.card').dataset.num));
      const up = box.querySelector('.up');
      up.innerHTML = up.innerHTML ? '' : modelBlock(data, item, b.dataset.next);
      b.textContent = up.innerHTML ? '한 단계 위 답변 닫기' : '한 단계 위 답변 보기';
      return;
    }
    const answers = [...box.querySelectorAll(':scope > .answer')];
    let i = Number(box.dataset.i);
    i = (i + (b.dataset.act === 'next' ? 1 : -1) + answers.length) % answers.length;
    box.dataset.i = i;
    answers.forEach((a, k) => { a.hidden = k !== i; });
    box.querySelector('.pi').textContent = i + 1;
  });
  window.addEventListener('hashchange', () => urls.forEach((u) => URL.revokeObjectURL(u)), { once: true });
}

// ── 선생님 피드백 ──────────────────────────────────
function overallFeedback(data, fb) {
  const o = fb.overall || {};
  return `<section class="panel fb overall">
    <h2>선생님 피드백 <small class="muted">${esc(fmtDate(fb.created_at))}</small></h2>
    ${o.est_level ? `<p class="lvline">지금 예상 레벨 <b>${esc(levelLabel(data, o.est_level))}</b>${fb.target ? ` · 목표 ${esc(levelLabel(data, fb.target))}` : ''}</p>` : ''}
    ${o.summary_ko ? `<p>${esc(o.summary_ko)}</p>` : ''}
    ${o.strengths_ko?.length ? `<h4>잘하고 있는 점</h4><ul>${o.strengths_ko.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${o.priorities_ko?.length ? `<h4>다음에 연습할 것</h4><ol>${o.priorities_ko.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
  </section>`;
}
function itemFeedback(data, fb, item) {
  const f = fb?.items?.find((x) => x.num === item.num);
  if (!f) return '';
  const pron = f.teacher_note_ko ? `<p class="tnote">선생님 메모: ${esc(f.teacher_note_ko)}</p>`
    : f.pronunciation === 'check' ? '<p class="muted">발음은 글로 판단하기 어려워서 선생님이 녹음을 듣고 따로 알려 줘요.</p>' : '';
  return `<div class="fb">
    <h4>선생님 피드백${f.est_level ? ` <span class="lvchip">${esc(levelLabel(data, f.est_level))}</span>` : ''}</h4>
    ${f.good_ko?.length ? `<ul class="good">${f.good_ko.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${(f.fixes || []).map((x) => `<div class="fix">
      <p class="said">${esc(x.said)}</p>
      <p class="better">→ ${esc(x.better)} <button class="btn sm" data-act="say" data-text="${esc(x.better)}">▶</button></p>
      ${x.why_ko ? `<p class="why">${esc(x.why_ko)}</p>` : ''}</div>`).join('')}
    ${f.next_ko ? `<p class="next">다음 연습: ${esc(f.next_ko)}</p>` : ''}
    ${pron}
  </div>`;
}

function sayOnce(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = 0.95;
  speechSynthesis.speak(u);
}
