// 선생님 모드: 제출함 · 학생 목록 · 등록 코드 · 응시 상세(녹음 듣기, 피드백 상태)
// 전사와 피드백 쓰기는 Mac에서 해요(학생 녹음을 브라우저에서 외부 AI로 보내지 않아요): cloud_sync.py pull → transcribe → 스킬 → push
import { teacherCloud as tc } from './cloud.js';
import { esc, fmtDate, TYPE_KO } from './views.js';
import { findQuestion } from './opic_plan.js';

const $app = () => document.getElementById('app');
const EXAM_KO = { toeic: '토익스피킹', opic: 'OPIc' };

export function teacherLogin({ onDone, notice = '' }) {
  $app().innerHTML = `
    <form class="panel onboard" id="f" novalidate>
      <h1>선생님 입장</h1>
      ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}
      <p class="muted">R&R archive 선생님 계정(rw-english와 같은 계정)으로 로그인해요. 학생 기기나 학원 공용 기기에서는 쓰지 말고, 다 쓰면 로그아웃해 주세요.</p>
      <label>이메일<input name="email" type="email" autocomplete="username"></label>
      <label>비밀번호<input name="pw" type="password" autocomplete="current-password"></label>
      <p class="err" id="err" role="alert"></p>
      <div class="btns"><button class="btn primary" id="go">로그인</button><a class="btn ghost" href="#/">학생 화면으로</a></div>
    </form>`;
  const f = $app().querySelector('#f');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector('#go'); btn.disabled = true; f.querySelector('#err').textContent = '';
    try { await tc.signIn(f.elements.email.value, f.elements.pw.value); onDone(); }
    catch (ex) { f.querySelector('#err').textContent = ex.message; }
    finally { btn.disabled = false; }
  };
}

function statusOf(a, fb) {
  if (fb?.read_at) return ['읽음', 'ok'];
  if (fb) return ['피드백 보냄', 'sent'];
  if (a.pulled_at) return ['받음 · 피드백 쓰는 중', 'pulled'];
  return ['새 제출', 'new'];
}
const nameOf = (s) => s?.profile?.name || '(정보 입력 전)';

async function loadAll() {
  const [students, attempts, feedback, invites] = await Promise.all([tc.students(), tc.attempts(), tc.feedback(), tc.invites()]);
  const byId = new Map(students.map((s) => [s.id, s]));
  const fbBy = new Map(feedback.map((f) => [f.attempt_id, f]));
  return { students, attempts: attempts.reverse(), byId, fbBy, invites };
}

export async function teacherHome({ consent }) {
  $app().innerHTML = '<p class="muted">불러오는 중…</p>';
  let d;
  try { d = await loadAll(); } catch (ex) {
    if (ex.status === 401) { tc.signOut(); return teacherLogin({ onDone: () => teacherHome({ consent }), notice: '다시 로그인해 주세요.' }); }
    $app().innerHTML = `<p class="panel err">불러오지 못했어요: ${esc(ex.message)}</p>`; return;
  }
  const { students, attempts, byId, fbBy, invites } = d;
  const inbox = attempts.filter((a) => !a.pulled_at);
  const waiting = attempts.filter((a) => a.pulled_at && !fbBy.has(a.id));
  const row = (a) => {
    const s = byId.get(a.student_id); const [st, cls] = statusOf(a, fbBy.get(a.id));
    return `<a class="li tli" href="#/teacher/attempt/${encodeURIComponent(a.id)}">
      <div><b>${esc(s?.code || '?')}</b> ${esc(nameOf(s))} <span class="muted">· ${esc(EXAM_KO[a.exam])} ${esc(a.exam === 'opic' ? '' : a.set_id.replace('toeic-', ''))} · 목표 ${esc(a.target || '-')}</span>
        <div class="muted">${esc(fmtDate(a.submitted_at))} 제출 · 녹음 ${a.items?.length || 0}개</div></div>
      <span class="chip st-${cls}">${st}</span></a>`;
  };
  const counts = new Map(); attempts.forEach((a) => counts.set(a.student_id, (counts.get(a.student_id) || 0) + 1));
  const last = new Map(); attempts.forEach((a) => { if (!last.has(a.student_id)) last.set(a.student_id, a.submitted_at); });
  const open = invites.filter((i) => !i.used_at);
  $app().innerHTML = `
    <section class="panel">
      <div class="row between"><h1>선생님 모드</h1><div class="btns">
        <a class="btn ghost" href="index.html?sb=off#/" target="_blank" rel="noopener">학생 화면 미리 보기</a>
        <button class="btn ghost" id="out">로그아웃</button></div></div>
      <p class="muted">새 제출 ${inbox.length} · 피드백 대기 ${waiting.length} · 학생 ${students.filter((s) => !s.withdrawn_at).length}명</p>
      <p class="muted">피드백은 Mac에서: <code>python3 tools/cloud_sync.py pull</code> → <code>transcribe.py</code> → speaking-feedback 스킬 → <code>cloud_sync.py push</code></p>
    </section>
    <section class="panel"><h2>새 제출</h2><div class="list">${inbox.map(row).join('') || '<p class="muted">없어요.</p>'}</div></section>
    <section class="panel"><h2>최근 응시</h2><div class="list">${attempts.slice(0, 30).map(row).join('') || '<p class="muted">아직 없어요.</p>'}</div></section>
    <section class="panel"><h2>학생</h2>
      <div class="tablewrap"><table class="ctable tstudents"><thead><tr><th>번호</th><th>이름</th><th>아이디</th><th>시험 · 목표</th><th>동의</th><th>응시</th><th>마지막 제출</th></tr></thead><tbody>
      ${students.map((s) => {
        const p = s.profile || {}; const cv = s.consent?.version;
        return `<tr class="${s.withdrawn_at ? 'withdrawn' : ''}"><td data-label="번호">${esc(s.code)}</td><td data-label="이름">${esc(nameOf(s))}</td><td data-label="아이디">${esc(s.login_id)}</td>
          <td data-label="시험 · 목표">${esc((p.exams || []).map((x) => `${EXAM_KO[x]} ${p.targets?.[x] || ''}`).join(', ') || '-')}</td>
          <td data-label="동의">${s.withdrawn_at ? `<b class="err">철회 ${esc(fmtDate(s.withdrawn_at))}</b>` : cv ? (cv === consent.consent_version ? `v${cv}` : `<b class="err">v${cv} (다시 동의 필요)</b>`) : '<span class="muted">전</span>'}</td>
          <td data-label="응시">${counts.get(s.id) || 0}</td><td data-label="마지막 제출">${last.has(s.id) ? esc(fmtDate(last.get(s.id))) : '-'}</td></tr>`;
      }).join('') || '<tr><td colspan="7" class="muted">아직 없어요.</td></tr>'}
      </tbody></table></div>
      ${students.some((s) => s.withdrawn_at) ? '<p class="muted">철회한 학생은 Mac에서 <code>purge.py --student S00N --now --apply</code>와 <code>cloud_sync.py delete S00N</code>으로 정리해요.</p>' : ''}
    </section>
    <section class="panel" id="invites"><h2>등록 코드</h2>
      <form class="row" id="newinv"><input name="note" placeholder="메모 (예: 화요일 7시반) — 이름은 적지 않아요" maxlength="40"><button class="btn primary">새 등록 코드</button></form>
      <div id="made"></div>
      <div class="list">${open.map((i) => `<div class="li"><div><b class="code">${esc(i.code)}</b> → ${esc(i.student_code)} ${i.note ? `<span class="muted">· ${esc(i.note)}</span>` : ''}
        <div class="muted">${new Date(i.expires_at) < Date.now() ? '<b class="err">만료됨</b>' : `${esc(fmtDate(i.expires_at))}까지`}</div></div>
        <button class="btn sm ghost" data-del="${esc(i.code)}">지우기</button></div>`).join('') || '<p class="muted">쓰지 않은 코드가 없어요.</p>'}</div>
    </section>`;
  $app().querySelector('#out').onclick = () => { tc.signOut(); location.hash = '#/teacher'; teacherLogin({ onDone: () => teacherHome({ consent }) }); };
  $app().querySelector('#newinv').onsubmit = async (e) => {
    e.preventDefault();
    const note = e.target.elements.note.value.trim(), made = $app().querySelector('#made');
    try {
      const { code, student_code } = await tc.createInvite(note);
      const url = location.href.split('#')[0].replace(/\?.*$/, '');
      const msg = `Speaking Lab 주소: ${url}\n1) '처음 왔어요' → 아이디(영문 소문자·숫자)와 PIN(숫자 4~8자리)을 정하고, 등록 코드 ${code} 를 넣어요.\n2) 안내 → 내 정보 → 동의를 마치면 시작해요.\n(등록 코드는 14일 동안 한 번만 쓸 수 있어요)`;
      made.innerHTML = `<div class="notice"><p>학생 번호 <b>${esc(student_code)}</b> · 등록 코드 <b class="code big">${esc(code)}</b></p>
        <textarea readonly rows="4" id="invmsg">${esc(msg)}</textarea>
        <div class="btns"><button class="btn sm" id="copy">안내문 복사</button><button class="btn sm ghost" id="reload">목록 새로고침</button></div></div>`;
      made.querySelector('#copy').onclick = async () => { try { await navigator.clipboard.writeText(msg); made.querySelector('#copy').textContent = '복사했어요'; } catch { made.querySelector('#invmsg').select(); } };
      made.querySelector('#reload').onclick = () => teacherHome({ consent });
    } catch (ex) { made.innerHTML = `<p class="err">만들지 못했어요: ${esc(ex.message)}</p>`; }
  };
  $app().querySelector('#invites').addEventListener('click', async (e) => {
    const code = e.target.closest('[data-del]')?.dataset.del; if (!code) return;
    if (!confirm(`등록 코드 ${code}를 지울까요? 이 코드로는 더 이상 가입할 수 없어요.`)) return;
    try { await tc.deleteInvite(code); teacherHome({ consent }); } catch (ex) { alert(ex.message); }
  });
}

export async function teacherAttempt({ id, toeic, opic, levels }) {
  $app().innerHTML = '<p class="muted">불러오는 중…</p>';
  let d;
  try { d = await loadAll(); } catch (ex) { $app().innerHTML = `<p class="panel err">불러오지 못했어요: ${esc(ex.message)}</p>`; return; }
  const a = d.attempts.find((x) => x.id === id);
  if (!a) { $app().innerHTML = '<p class="panel">응시 기록을 찾지 못했어요. <a href="#/teacher">돌아가기</a></p>'; return; }
  const s = d.byId.get(a.student_id), fbRow = d.fbBy.get(a.id), fb = fbRow?.feedback;
  const L = levels[a.exam]; const lv = (x) => (x ? L.labels[x]?.name || x : '-');
  const set = a.exam === 'toeic' ? toeic.sets.find((x) => x.id === a.set_id) : null;
  const qOf = (it) => (a.exam === 'opic' ? findQuestion(opic, it.qid) : set?.items.find((x) => x.num === it.num)) || {};
  const [st] = statusOf(a, fbRow);
  const m = a.meta || {};
  $app().innerHTML = `
    <section class="panel">
      <p><a href="#/teacher">← 선생님 모드</a></p>
      <h1>${esc(s?.code || '?')} ${esc(nameOf(s))} <small class="muted">${esc(EXAM_KO[a.exam])} ${esc(set?.title_ko || '')}</small></h1>
      <p class="muted">목표 ${esc(lv(a.target))} · ${esc(fmtDate(a.submitted_at))} 제출 · ${esc(st)}${a.pulled_at ? ` · Mac에서 받음 ${esc(fmtDate(a.pulled_at))}` : ''}
        ${a.exam === 'opic' ? ` · 자가평가 ${esc(m.self_assessment ?? '-')} · 재조정 ${esc(m.readjust ?? '-')}` : ''}${m.no_mic ? ' · <b class="err">마이크 없이 응시</b>' : ''}</p>
      ${a.pulled_at ? '' : '<p class="notice">아직 Mac으로 받지 않았어요. <code>python3 tools/cloud_sync.py pull</code></p>'}
      ${fb ? `<div class="fb overall"><h2>보낸 피드백 <small class="muted">${esc(fmtDate(fbRow.created_at))}${fbRow.read_at ? ` · 학생이 ${esc(fmtDate(fbRow.read_at))}에 읽음` : ' · 아직 안 읽음'}</small></h2>
        <p class="lvline">예상 ${esc(lv(fb.overall?.est_level))} · 목표 ${esc(lv(fb.target))}</p><p>${esc(fb.overall?.summary_ko || '')}</p></div>` : ''}
    </section>
    <div id="items">${(a.items || []).map((it) => {
      const q = qOf(it); const f = fb?.items?.find((x) => x.num === it.num);
      return `<article class="card"><header><b>Q${it.num}</b> <span class="muted">${esc(TYPE_KO[q.type || it.type] || '')}${q.topic?.title_ko ? ` · ${esc(q.topic.title_ko)}` : ''}</span></header>
        ${q.question ? `<p class="question sm">${esc(q.question)}</p>` : q.text ? `<p class="readtext sm">${esc(q.text)}</p>` : q.image ? `<img class="photo sm" src="${esc(q.image)}" alt="">` : ''}
        <div class="aud" data-path="${esc(`${a.student_id}/${a.id}/${it.file.slice(6)}`)}"><span class="muted">녹음 불러오는 중… (${Math.round((it.ms || 0) / 1000)}초)</span></div>
        ${f ? `<p class="muted">피드백: ${f.est_level ? esc(lv(f.est_level)) + ' · ' : ''}고칠 문장 ${(f.fixes || []).length}개${f.teacher_note_ko ? ' · 선생님 메모 있음' : f.pronunciation === 'check' ? ' · <b>발음 확인 필요</b>' : ''}</p>` : ''}
      </article>`;
    }).join('')}</div>`;
  const urls = [];
  await Promise.all([...$app().querySelectorAll('.aud')].map(async (el) => {
    try { const u = URL.createObjectURL(await tc.audio(el.dataset.path)); urls.push(u); el.innerHTML = `<audio controls preload="metadata" src="${u}"></audio>`; }
    catch (ex) { el.innerHTML = `<p class="err">${esc(ex.message)}</p>`; }
  }));
  window.addEventListener('hashchange', () => urls.forEach((u) => URL.revokeObjectURL(u)), { once: true });
}
