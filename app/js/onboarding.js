// 처음 들어올 때: 안내 → 학생 정보 → 개인정보 동의(14세 미만이면 보호자 동의) → 저장
// 설정: 내 정보·동의 내역 보기, 정보 고치기, 동의 기록 내려받기, 동의 철회
import { clearAll, getProfile, putProfile, setSetting } from './store.js';
import { cloud } from './cloud.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $app = () => document.getElementById('app');
const EXAM_KO = { toeic: '토익스피킹', opic: 'OPIc' };
const GUARDIAN_METHOD_KO = { sms: '문자로 확인', signature: '종이 동의서에 서명' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^01[016789]-?\d{3,4}-?\d{4}$/;

// 동의가 유효한지: 현재 동의서 버전에 필수·국외 이전(14세 미만이면 보호자까지) 동의가 있어야 해요.
export function consentValid(profile, consent) {
  const c = profile?.consent;
  return !!(c && c.version === consent.consent_version && c.required && c.overseas && (!profile.under14 || c.guardian));
}

// 동의서 본문. interactive면 체크박스를 넣고, 인쇄용이면 빈칸 ☐ 로 그려요.
export function consentHTML(consent, { under14 = true, interactive = false, checks = {}, guardian = {} } = {}) {
  const parts = [];
  if (consent.status === 'draft') parts.push(`<p class="notice">검토 전 초안이에요. 내용이 바뀌면 다시 동의를 받아요.</p>`);
  parts.push(`<p>${esc(consent.intro)}</p>`);
  for (const s of consent.sections) {
    if (s.only_if === 'under14' && !under14) continue;
    let h = `<section class="csec" data-sec="${esc(s.id)}"><h3>${esc(s.title)}</h3>`;
    for (const p of s.paragraphs || []) h += `<p>${esc(p)}</p>`;
    if (s.table) {
      h += `<div class="tablewrap"><table class="ctable"><thead><tr>${s.table.head.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${
        s.table.rows.map((r) => `<tr>${r.map((c, k) => `<td data-label="${esc(s.table.head[k])}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    if (s.bullets?.length) h += `<ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`;
    if (s.id === 'guardian') h += interactive ? guardianFields(guardian) : `<div class="blanks">${(s.fields || []).map((f) => `<p>${esc(f)}: ____________________</p>`).join('')}</div>`;
    if (s.check) {
      const tag = s.check.required ? '<b class="req">필수</b>' : '<span class="opt">선택</span>';
      h += interactive
        ? `<label class="ccheck"><input type="checkbox" name="c_${esc(s.check.key)}" ${checks[s.check.key] ? 'checked' : ''}> ${tag} ${esc(s.check.label)}</label>`
        : `<p class="ccheck">☐ ${esc(s.check.label)}</p>`;
    }
    parts.push(h + '</section>');
  }
  return parts.join('');
}

function guardianFields(g) {
  return `<div class="grid2">
    <label>보호자 이름<input name="g_name" value="${esc(g.name)}" autocomplete="off"></label>
    <label>학생과의 관계<input name="g_relation" value="${esc(g.relation)}" placeholder="예: 어머니"></label>
    <label>보호자 연락처<input name="g_phone" type="tel" inputmode="tel" value="${esc(g.phone)}" placeholder="010-0000-0000"></label>
    <label>보호자 확인 방법<select name="g_method">
      ${Object.entries(GUARDIAN_METHOD_KO).map(([k, v]) => `<option value="${k}" ${g.method === k ? 'selected' : ''}>${v}</option>`).join('')}
    </select></label></div>
    <p class="muted">문자로 확인하면 선생님이 보호자 연락처로 한 번 더 확인해요. 서명으로 하려면 <a href="consent.html" target="_blank" rel="noopener">인쇄용 동의서</a>를 출력해 수업 때 가져와 주세요.</p>`;
}

// 로그인한 이메일(Cloudflare Access)이 있으면 가져와요. 로컬에서는 없어요.
async function accessEmail() {
  if (['localhost', '127.0.0.1', ''].includes(location.hostname)) return '';   // Access 뒤가 아니면 주소가 없어요
  try {
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 2000);
    const r = await fetch('/cdn-cgi/access/get-identity', { signal: ctl.signal, credentials: 'include' });
    if (!r.ok) return '';
    const j = await r.json();
    return typeof j.email === 'string' ? j.email : '';
  } catch { return ''; }
}

function levelOptions(levels, exam, cur) {
  const L = levels[exam];
  return L.levels.map((lv) => `<option value="${lv}" ${cur === lv ? 'selected' : ''}>${esc(L.labels[lv].name)}${L.labels[lv].score ? ` (${esc(L.labels[lv].score)})` : ''}</option>`).join('');
}

// ── 처음 들어올 때 ───────────────────────────────────
export async function welcome({ consent, levels, onDone }) {
  const prev = await getProfile();
  const reconsent = prev?.consent && prev.consent.version !== consent.consent_version;
  const st = {
    info: {
      name: prev?.name || '', email: prev?.email || '', phone: prev?.phone || '',
      under14: prev?.under14 ?? null, exams: prev?.exams || ['toeic'],
      targets: { toeic: 'lv6', opic: 'im2', ...(prev?.targets || {}) },
      optional: { exam_date: '', current: '', grade_or_job: '', ...(prev?.optional || {}) },
    },
    checks: { required: false, optional: false, overseas: false, guardian: false },
    guardian: { name: '', relation: '', phone: '', method: 'sms', ...(prev?.guardian || {}) },
  };
  if (!st.info.email && !cloud.enabled) st.info.email = await accessEmail();

  const intro = () => {
    $app().innerHTML = `
      <section class="panel onboard">
        <p class="step">1 / 3</p>
        <h1>${reconsent ? '동의서가 바뀌었어요' : '시작하기 전에'}</h1>
        ${reconsent ? `<p>개인정보 동의서가 v${esc(prev.consent.version)}에서 v${esc(consent.consent_version)}로 바뀌었어요. 내용을 확인하고 다시 동의해 주세요. 응시 기록은 그대로 있어요.</p>` : ''}
        <p>Speaking Lab은 과외 수업 학생만 쓰는 토익스피킹·OPIc 말하기 연습 앱이에요.</p>
        <ul class="facts">
          <li>실제 시험처럼 시간에 맞춰 답하고, 답변은 녹음돼요.</li>
          <li>녹음은 <b>이 기기에만</b> 저장돼요. 선생님께 보낼 때만 내가 직접 파일을 보내요.</li>
          <li>선생님은 녹음을 글로 받아 적은 뒤, <b>이름을 뺀 글만</b> AI(Claude)에 넣어 피드백 초안을 만들어요. 녹음 파일은 AI에 보내지 않아요.</li>
          <li>시작하려면 학생 정보와 개인정보 동의가 필요해요. 동의는 설정에서 언제든 철회할 수 있어요.</li>
        </ul>
        <div class="btns"><button class="btn primary" id="next">다음</button></div>
      </section>`;
    $app().querySelector('#next').onclick = form;
  };

  const form = () => {
    const i = st.info;
    $app().innerHTML = `
      <form class="panel onboard" id="f" novalidate>
        <p class="step">2 / 3</p>
        <h1>학생 정보</h1>
        <fieldset><legend>필수</legend>
          <label>이름<input name="name" value="${esc(i.name)}" autocomplete="name" required></label>
          ${cloud.enabled ? `<p class="muted">로그인 아이디: <b>${esc(cloud.loginId)}</b></p>` : `<label>이메일 <span class="muted">(로그인한 주소)</span><input name="email" type="email" value="${esc(i.email)}" autocomplete="email" required></label>`}
          <label>휴대폰 번호<input name="phone" type="tel" inputmode="tel" value="${esc(i.phone)}" placeholder="010-0000-0000" autocomplete="tel" required></label>
          <div class="field"><span>만 14세 미만인가요?</span>
            <label class="inline"><input type="radio" name="under14" value="no" ${i.under14 === false ? 'checked' : ''}> 아니요</label>
            <label class="inline"><input type="radio" name="under14" value="yes" ${i.under14 === true ? 'checked' : ''}> 네 (보호자 동의가 필요해요)</label>
          </div>
          <div class="field"><span>준비하는 시험</span>
            ${Object.entries(EXAM_KO).map(([k, v]) => `<label class="inline"><input type="checkbox" name="exam" value="${k}" ${i.exams.includes(k) ? 'checked' : ''}> ${v}</label>`).join('')}
          </div>
          <div class="grid2">
            <label data-exam="toeic">토익스피킹 목표 레벨<select name="t_toeic">${levelOptions(levels, 'toeic', i.targets.toeic)}</select></label>
            <label data-exam="opic">OPIc 목표 등급<select name="t_opic">${levelOptions(levels, 'opic', i.targets.opic)}</select></label>
          </div>
        </fieldset>
        <fieldset><legend>선택 <span class="muted">— 다음 화면에서 선택 항목에 동의할 때만 저장해요</span></legend>
          <label>시험 예정일<input name="exam_date" type="date" value="${esc(i.optional.exam_date)}"></label>
          <label>현재 점수·등급<input name="current" value="${esc(i.optional.current)}" placeholder="예: 토익스피킹 130, OPIc IM1"></label>
          <label>학년 또는 직업<input name="grade_or_job" value="${esc(i.optional.grade_or_job)}" placeholder="예: 대학교 3학년"></label>
        </fieldset>
        <p class="err" id="err" role="alert"></p>
        <div class="btns"><button type="button" class="btn ghost" id="back">이전</button><button class="btn primary">다음</button></div>
      </form>`;
    const f = $app().querySelector('#f');
    const syncExam = () => f.querySelectorAll('[data-exam]').forEach((el) => {
      el.hidden = !f.querySelector(`input[name=exam][value=${el.dataset.exam}]`).checked;
    });
    f.addEventListener('change', syncExam); syncExam();
    f.querySelector('#back').onclick = intro;
    f.onsubmit = (e) => {
      e.preventDefault();
      const v = (n) => (f.elements[n]?.value || '').trim();
      const exams = [...f.querySelectorAll('input[name=exam]:checked')].map((x) => x.value);
      const u = f.querySelector('input[name=under14]:checked')?.value;
      const errs = [];
      if (!v('name')) errs.push('이름을 써 주세요.');
      if (!cloud.enabled && !EMAIL_RE.test(v('email'))) errs.push('이메일 주소를 확인해 주세요.');
      if (!PHONE_RE.test(v('phone'))) errs.push('휴대폰 번호를 010-0000-0000 형식으로 써 주세요.');
      if (!u) errs.push('만 14세 미만인지 골라 주세요.');
      if (!exams.length) errs.push('준비하는 시험을 하나 이상 골라 주세요.');
      st.info = {
        name: v('name'), email: cloud.enabled ? '' : v('email'), phone: v('phone'), under14: u ? u === 'yes' : null, exams,
        targets: { toeic: f.elements.t_toeic.value, opic: f.elements.t_opic.value },
        optional: { exam_date: v('exam_date'), current: v('current'), grade_or_job: v('grade_or_job') },
      };
      if (errs.length) { f.querySelector('#err').textContent = errs.join(' '); return; }
      agree();
    };
  };

  const agree = () => {
    const under14 = st.info.under14;
    $app().innerHTML = `
      <form class="panel onboard" id="f" novalidate>
        <p class="step">3 / 3</p>
        <h1>${esc(consent.title)} <small class="muted">v${esc(consent.consent_version)}</small></h1>
        <label class="ccheck all"><input type="checkbox" id="all"> 아래 내용에 모두 동의해요 <span class="muted">(선택 항목 포함)</span></label>
        <div class="consent">${consentHTML(consent, { under14, interactive: true, checks: st.checks, guardian: st.guardian })}</div>
        <p class="err" id="err" role="alert"></p>
        <div class="btns"><button type="button" class="btn ghost" id="back">이전</button><button class="btn primary" id="ok" disabled>동의하고 시작</button></div>
        <p class="muted">인쇄해서 보관하려면 <a href="consent.html" target="_blank" rel="noopener">인쇄용 동의서</a>를 열어요.</p>
      </form>`;
    const f = $app().querySelector('#f');
    const boxes = [...f.querySelectorAll('input[name^=c_]')];
    const need = consent.sections.filter((s) => s.check?.required && (s.only_if !== 'under14' || under14)).map((s) => s.check.key);
    const read = () => {
      boxes.forEach((b) => { st.checks[b.name.slice(2)] = b.checked; });
      if (under14) st.guardian = { name: f.elements.g_name.value.trim(), relation: f.elements.g_relation.value.trim(), phone: f.elements.g_phone.value.trim(), method: f.elements.g_method.value };
      f.querySelector('#ok').disabled = !need.every((k) => st.checks[k]);
    };
    const all = f.querySelector('#all');
    // '모두 동의'를 누르면 항목을 모두 바꾸고, 항목을 누르면 '모두 동의' 표시를 맞춰요.
    // (체크박스는 input 이벤트가 change보다 먼저 와요. '모두 동의' 자신의 이벤트로 그 값을 덮어쓰지 않게 나눠요.)
    f.addEventListener('change', (e) => {
      if (e.target === all) boxes.forEach((b) => { b.checked = all.checked; });
      else all.checked = boxes.every((b) => b.checked);
      read();
    });
    f.addEventListener('input', (e) => { if (e.target.type !== 'checkbox') read(); });
    all.checked = boxes.every((b) => b.checked); read();
    f.querySelector('#back').onclick = () => { read(); form(); };
    f.onsubmit = async (e) => {
      e.preventDefault(); read();
      const errs = [];
      if (!need.every((k) => st.checks[k])) errs.push('필수 항목에 동의해야 시작할 수 있어요.');
      if (under14) {
        const g = st.guardian;
        if (!g.name || !g.relation) errs.push('보호자 이름과 관계를 써 주세요.');
        if (!PHONE_RE.test(g.phone)) errs.push('보호자 연락처를 010-0000-0000 형식으로 써 주세요.');
      }
      if (errs.length) { f.querySelector('#err').textContent = errs.join(' '); return; }
      const now = new Date().toISOString();
      const record = {
        version: consent.consent_version, status: consent.status, at: now,
        required: true, overseas: true, optional: !!st.checks.optional,
        guardian: under14 ? true : null, guardian_method: under14 ? st.guardian.method : null,
      };
      const profile = {
        ...(prev || {}),
        name: st.info.name, email: st.info.email, phone: st.info.phone, under14,
        exams: st.info.exams, targets: st.info.targets,
        optional: st.checks.optional ? st.info.optional : null,        // 선택 동의를 안 하면 저장하지 않아요
        guardian: under14 ? st.guardian : null,
        consent: record,
        consent_history: [...(prev?.consent_history || []), record],
        createdAt: prev?.createdAt || now, updatedAt: now,
      };
      delete profile.withdrawn;
      if (cloud.enabled) {                                   // 서버가 기준이에요. 서버에 먼저 저장하고 기기에 옮겨요.
        const { name, phone, under14: u14, exams, targets, optional, guardian } = profile;
        const okBtn = f.querySelector('#ok'); okBtn.disabled = true;
        try { await cloud.saveProfile({ profile: { name, phone, under14: u14, exams, targets, optional, guardian }, consent: record, consent_history: profile.consent_history }); }
        catch (ex) { f.querySelector('#err').textContent = `저장하지 못했어요: ${ex.message}`; okBtn.disabled = false; return; }
      }
      await putProfile(profile);
      setSetting('target.toeic', st.info.targets.toeic);
      setSetting('target.opic', st.info.targets.opic);
      onDone();
    };
  };

  (prev?.name && !reconsent ? form : intro)();   // 서버에서 막 만든 계정은 정보가 비어 있어서 안내부터
}

// ── 설정 ───────────────────────────────────────────
function download(name, obj) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  a.download = name; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const fmt = (iso) => { try { return new Date(iso).toLocaleString('ko-KR'); } catch { return iso; } };

export async function settings({ consent, levels }) {
  const p = await getProfile();
  if (!p) { location.hash = '#/welcome'; return; }
  const c = p.consent || {};
  const lvName = (ex) => levels[ex].labels[p.targets?.[ex]]?.name || p.targets?.[ex] || '-';
  $app().innerHTML = `
    <section class="panel">
      <h1>설정</h1>
      <h2>내 정보</h2>
      <dl class="kv">
        <dt>이름</dt><dd>${esc(p.name)}</dd>
        ${p.login_id ? `<dt>아이디</dt><dd>${esc(p.login_id)} <span class="muted">· 학생 번호 ${esc(p.code || '-')}</span></dd>` : `<dt>이메일</dt><dd>${esc(p.email)}</dd>`}
        <dt>휴대폰</dt><dd>${esc(p.phone)}</dd>
        <dt>시험 · 목표</dt><dd>${p.exams.map((ex) => `${EXAM_KO[ex]} ${esc(lvName(ex))}`).join(' · ')}</dd>
        ${p.optional ? `<dt>선택 항목</dt><dd>${esc([p.optional.exam_date && `시험일 ${p.optional.exam_date}`, p.optional.current, p.optional.grade_or_job].filter(Boolean).join(' · ') || '-')}</dd>` : ''}
        ${p.under14 ? `<dt>보호자</dt><dd>${esc(p.guardian?.name)} (${esc(p.guardian?.relation)}) · ${esc(GUARDIAN_METHOD_KO[p.guardian?.method] || '')}</dd>` : ''}
      </dl>
      <div class="btns"><a class="btn" href="#/welcome">정보 고치기</a>${cloud.enabled ? '<button class="btn ghost" id="logout">로그아웃</button>' : ''}</div>
    </section>
    <section class="panel">
      <h2>동의 내역</h2>
      <p>동의서 v${esc(c.version)} · ${esc(fmt(c.at))}</p>
      <ul>
        <li>필수 항목 수집·이용: ${c.required ? '동의' : '-'}</li>
        <li>선택 항목 수집·이용: ${c.optional ? '동의' : '동의 안 함'}</li>
        <li>국외 이전: ${c.overseas ? '동의' : '-'}</li>
        ${p.under14 ? `<li>법정대리인 동의: ${c.guardian ? '동의' : '-'}</li>` : ''}
      </ul>
      <div class="btns">
        <a class="btn" href="consent.html" target="_blank" rel="noopener">동의서 다시 보기</a>
        <button class="btn" id="dl">동의 기록 내려받기</button>
      </div>
    </section>
    <section class="panel danger">
      <h2>동의 철회</h2>
      <p>${cloud.enabled
        ? '철회하면 서버와 이 기기에 있는 내 학생 정보, 응시 기록, 녹음, 피드백이 바로 지워지고 앱을 쓸 수 없어요. 선생님께 자동으로 알려지고, 선생님 컴퓨터에 있는 자료도 지워요.'
        : '철회하면 이 기기에 저장된 학생 정보, 응시 기록, 녹음이 모두 지워지고 앱을 쓸 수 없어요. 선생님께 보낼 철회 확인 파일이 내려받아져요. 선생님 컴퓨터에 있는 자료도 지워 달라고 그 파일과 함께 알려 주세요.'}</p>
      <p class="err" id="werr" role="alert"></p>
      <label class="ccheck"><input type="checkbox" id="sure"> 위 내용을 확인했어요</label>
      <div class="btns"><button class="btn warn" id="withdraw" disabled>동의 철회하고 모두 지우기</button></div>
    </section>`;
  // 파일 이름은 영문만: 한글·공백 이름은 일부 브라우저에서 'download'로 바뀌어요. 이름은 파일 안에 있어요.
  const tag = `${(p.login_id || p.email || 'student').split('@')[0].replace(/[^a-z0-9._-]/gi, '') || 'student'}_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;
  const record = () => ({ type: 'consent_record', name: p.name, email: p.email, under14: p.under14, guardian: p.guardian, consent: p.consent, history: p.consent_history, exported_at: new Date().toISOString() });
  $app().querySelector('#dl').onclick = () => download(`speaking-lab_consent_${tag}.json`, record());
  $app().querySelector('#sure').onchange = (e) => { $app().querySelector('#withdraw').disabled = !e.target.checked; };
  $app().querySelector('#logout')?.addEventListener('click', () => { cloud.signOut(); location.hash = '#/'; location.reload(); });
  $app().querySelector('#withdraw').onclick = async (e) => {
    const btn = e.currentTarget;
    if (cloud.enabled) {
      btn.disabled = true;
      try { await cloud.withdraw(); }
      catch (ex) { $app().querySelector('#werr').textContent = `철회하지 못했어요: ${ex.message} 인터넷 연결을 확인하고 다시 눌러 주세요.`; btn.disabled = false; return; }
      cloud.signOut();
      await clearAll();
      $app().innerHTML = `<section class="panel"><h1>동의를 철회했어요</h1><p>서버와 이 기기의 자료를 모두 지웠어요. 선생님께도 자동으로 알려졌어요.</p></section>`;
      return;
    }
    download(`speaking-lab_withdrawal_${tag}.json`, { ...record(), type: 'consent_withdrawal', withdrawn_at: new Date().toISOString() });
    await clearAll();
    $app().innerHTML = `<section class="panel"><h1>동의를 철회했어요</h1><p>이 기기의 자료를 모두 지웠어요. 내려받은 철회 확인 파일을 선생님께 보내 주세요.</p><div class="btns"><a class="btn" href="#/welcome">처음으로</a></div></section>`;
  };
}
