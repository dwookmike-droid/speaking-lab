// 화면: 홈 · 마이크 확인 · 시험 진행 · 결과
import { getAttempt, getRecording, getSetting, listAttempts, putAttempt, setSetting } from './store.js';
import { hasMic, meter, openMic, stopSpeaking } from './media.js';
import { Aborted, Runner } from './runner.js';
import { runToeic } from './toeic.js';

const $app = () => document.getElementById('app');
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const TYPE_KO = { read_aloud: '지문 읽기', describe_photo: '사진 묘사', respond_q: '듣고 답하기', info_based: '자료 보고 답하기', opinion: '의견 말하기' };
const PHASE_KO = { directions: '안내를 들어요', listen: '질문을 들어요', read: '자료 읽는 시간', prep: '준비 시간', beep: '삐 소리 뒤에 말해요', speak: '답변 시간' };

let current = null;   // 진행 중인 Runner
export function stopCurrent() { if (current) { current.abort(); current = null; stopSpeaking(); } }

export const target = (data) => {
  const t = getSetting('target.toeic', 'lv6');
  return data.levels.levels.includes(t) ? t : data.levels.levels[0];
};
const levelLabel = (data, lv) => {
  const l = data.levels.labels[lv] || {};
  return `${l.name || lv}${l.score ? ` (${l.score})` : ''}`;
};
function levelSelect(data, onChange) {
  const sel = document.createElement('select');
  sel.id = 'target';
  sel.innerHTML = data.levels.levels.map((lv) => `<option value="${lv}">${esc(levelLabel(data, lv))}</option>`).join('');
  sel.value = target(data);
  sel.onchange = () => { setSetting('target.toeic', sel.value); onChange?.(sel.value); };
  return sel;
}
const fmtDate = (iso) => { try { return new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return iso; } };

// ── 홈 ──────────────────────────────────────────────
export async function home(data) {
  const app = $app();
  app.innerHTML = `
    <section class="panel">
      <h1>토익스피킹 모의테스트</h1>
      <label class="row">목표 레벨 <span id="lvslot"></span></label>
      <p class="muted">결과 화면에서 이 레벨의 모범답변이 먼저 나와요. 언제든 바꿀 수 있어요.</p>
    </section>
    <section class="panel"><h2>세트</h2><div class="list" id="sets"></div></section>
    <section class="panel"><h2>최근 응시</h2><div class="list" id="recent"><p class="muted">아직 없어요.</p></div></section>`;
  app.querySelector('#lvslot').append(levelSelect(data));
  app.querySelector('#sets').innerHTML = data.sets.map((s) => `
    <div class="li"><div><b>${esc(s.title_ko || s.id)}</b>${s.status === 'draft' ? ' <span class="tag">초안</span>' : ''}
    <div class="muted">${s.items.length}문항 · 약 20분</div></div>
    <a class="btn primary" href="#/start/${encodeURIComponent(s.id)}">응시 시작</a></div>`).join('');
  let attempts = [];
  try { attempts = await listAttempts(); } catch { /* 저장소를 못 열면 기록 없이 */ }
  if (attempts.length) {
    const title = (id) => data.sets.find((s) => s.id === id)?.title_ko || id;
    app.querySelector('#recent').innerHTML = attempts.slice(0, 10).map((a) => `
      <div class="li"><div><b>${esc(title(a.setId))}</b> <span class="muted">${esc(fmtDate(a.startedAt))}</span>
      <div class="muted">${a.finishedAt ? '완료' : `진행 중 · Q${a.next}부터`}</div></div>
      <div class="btns">${a.finishedAt ? '' : `<a class="btn" href="#/resume/${a.id}">이어하기</a>`}
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
      <p>시작하면 실제 시험처럼 시간에 맞춰 자동으로 넘어가요. 조용한 곳에서 이어폰을 끼고 해 주세요.</p>
      <div class="mic">
        <button class="btn" id="mic">마이크 켜기</button>
        <div class="meter"><i id="lvl"></i></div>
        <span id="micmsg" class="muted"></span>
      </div>
      <div class="btns">
        <button class="btn primary" id="go" disabled>시작</button>
        <button class="btn ghost" id="nomic">녹음 없이 진행</button>
      </div>
    </section>`;
  let stopMeter = () => {};
  const go = app.querySelector('#go'), msg = app.querySelector('#micmsg');
  const enable = async () => {
    try {
      await openMic();
      msg.textContent = '말해 보세요. 막대가 움직이면 돼요.';
      stopMeter = meter((v) => { const el = document.getElementById('lvl'); if (el) el.style.width = `${Math.min(100, v * 250)}%`; });
      go.disabled = false;
    } catch {
      msg.textContent = '마이크를 쓸 수 없어요. 브라우저 주소창의 마이크 권한을 확인해 주세요.';
    }
  };
  app.querySelector('#mic').onclick = enable;
  if (hasMic()) enable();
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
      <div class="exam-top"><b id="qno"></b><span id="ptitle" class="muted"></span></div>
      <div class="exam-body" id="body"></div>
      <div class="exam-bar">
        <div class="ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" class="bg"/><circle cx="50" cy="50" r="44" class="fg" id="arc"/></svg><span id="sec"></span></div>
        <div><div id="phase" class="phase"></div><div id="rec" class="rec" hidden>● 녹음 중</div></div>
        <div class="btns right"><button class="btn" id="skip">건너뛰기</button><button class="btn ghost" id="quit">그만두기</button></div>
      </div>
    </section>`;
  const q = (s) => app.querySelector(s);
  const C = 2 * Math.PI * 44;
  const arc = q('#arc'); arc.style.strokeDasharray = C;
  const ui = {
    part(part, dir) {
      q('#qno').textContent = dir.title || part.type;
      q('#ptitle').textContent = '';
      q('#body').innerHTML = `<div class="directions"><p class="en">${esc(dir.en)}</p><p class="ko muted">${esc(dir.ko)}</p></div>`;
    },
    item(item, { part, context, info, showQuestion }) {
      q('#qno').textContent = `Question ${item.num} of ${total}`;
      q('#ptitle').textContent = TYPE_KO[part.type] || '';
      let html = '';
      if (context) html += `<p class="context">${esc(context)}</p>`;
      if (info) html += infoTable(info);
      if (item.type === 'read_aloud') html += `<p class="readtext">${esc(item.text)}</p>`;
      if (item.type === 'describe_photo') html += `<img class="photo" src="${esc(item.image)}" alt="Question ${item.num} picture">`;
      if (showQuestion && item.question) html += `<p class="question">${esc(item.question)}</p>`;
      if (info && !showQuestion) html += `<p class="muted">질문은 소리로만 나와요.</p>`;
      q('#body').innerHTML = html;
    },
    phase(kind, sec) {
      q('#phase').textContent = PHASE_KO[kind] || kind;
      q('#phase').dataset.kind = kind;
      if (!sec) { q('#sec').textContent = ''; arc.style.strokeDashoffset = 0; }
    },
    tick(left, totalSec) {
      q('#sec').textContent = Math.ceil(left);
      arc.style.strokeDashoffset = C * (1 - left / totalSec);
    },
    recording(on) { q('#rec').hidden = !on; },
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
  const set = data.sets.find((s) => s.id === attempt.setId);
  const lv = target(data);
  const urls = [];
  app.innerHTML = `
    <section class="panel">
      <h1>${esc(set?.title_ko || attempt.setId)} 결과 <small class="muted">${esc(fmtDate(attempt.startedAt))}</small></h1>
      <label class="row">목표 레벨 <span id="lvslot"></span></label>
      ${attempt.finishedAt ? '' : `<p>아직 다 끝내지 않았어요. <a href="#/resume/${attempt.id}">Q${attempt.next}부터 이어하기</a></p>`}
      <p class="muted" id="sum"></p>
    </section>
    <div id="cards"></div>`;
  app.querySelector('#lvslot').append(levelSelect(data, () => result(data, attemptId)));
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
    const prompt = item.type === 'read_aloud' ? `<p class="readtext sm">${esc(item.text)}</p>`
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
      <header><b>Q${item.num}</b> <span class="muted">${esc(TYPE_KO[item.type])}</span></header>
      ${prompt}
      <h4>내 답변</h4>${audio}
      <h4>모범답변</h4>${model}
      ${item.tip_ko ? `<p class="tip">${esc(item.tip_ko)}</p>` : ''}
      <h4>스스로 점검</h4>
      <ul class="checks">${list.map((c, i) => `<li><label><input type="checkbox" data-num="${item.num}" data-i="${i}" ${mine.includes(i) ? 'checked' : ''}> ${esc(c)}</label></li>`).join('')}</ul>`;
    frag.append(card);
  }
  cards.append(frag);
  const sum = () => { app.querySelector('#sum').textContent = `스스로 점검 ${checked}/${totalChecks}개`; };
  sum();
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

function sayOnce(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = 0.95;
  speechSynthesis.speak(u);
}
