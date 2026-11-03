// 라우터: #/welcome 등록·동의 · #/ 홈 · #/start/<세트> · #/resume/<응시> · #/result/<응시> · #/settings
// 현재 동의서에 동의한 기록이 없으면 어느 주소로 와도 #/welcome으로 보내요.
import { home, prepareExam, result, stopCurrent, esc } from './views.js';
import { consentValid, settings, welcome } from './onboarding.js';
import { clearAll, getAttempt, getProfile, putProfile } from './store.js';
import { cloud } from './cloud.js';
import { loginView } from './login.js';
import { opicResume, opicStart } from './opic_views.js';

let data, opic, consent, levels;
async function load(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}

// 서버 모드: 로그인 → 서버의 학생 정보를 기기로 가져와요(서버가 기준). 오프라인이면 기기 정보로 계속해요.
let synced = false;
async function cloudGate() {
  if (!cloud.enabled) return true;
  const again = () => { synced = false; route(); };
  if (!cloud.session()) { loginView({ onDone: again }); return false; }
  if (synced) return true;
  let me;
  try { me = await cloud.me(); } catch (e) {
    if (e.status === 401) { cloud.signOut(); loginView({ onDone: again, notice: '다시 로그인해 주세요.' }); return false; }
    synced = true; return true;
  }
  if (!me) { loginView({ onDone: again, mode: 'claim' }); return false; }
  if (me.withdrawn_at) {
    cloud.signOut(); await clearAll();
    loginView({ onDone: again, notice: '동의를 철회한 계정이에요. 다시 쓰려면 선생님께 새 등록 코드를 받아 주세요.' });
    return false;
  }
  const local = await getProfile();
  if (local?.login_id && local.login_id !== me.login_id) await clearAll();      // 다른 학생이 쓰던 기기: 그 학생 기록을 지워요
  await putProfile({ ...(me.profile || {}), consent: me.consent || null, consent_history: me.consent_history || [], code: me.code, login_id: me.login_id });
  synced = true;
  return true;
}

async function route() {
  stopCurrent();
  document.getElementById('nav-settings').hidden = true;
  if (!(await cloudGate())) return;
  const [, view, arg, arg2] = (location.hash || '#/').slice(1).split('/');
  const id = arg ? decodeURIComponent(arg) : '';
  window.scrollTo(0, 0);
  const profile = await getProfile();
  const ok = consentValid(profile, consent);
  document.getElementById('nav-settings').hidden = !ok;
  if (view === 'welcome') return welcome({ consent, levels, onDone: () => { if (location.hash === '#/') route(); else location.hash = '#/'; } });
  if (!ok) { location.hash = '#/welcome'; return; }
  if (view === 'settings') return settings({ consent, levels });
  if (view === 'start') return prepareExam(data, { setId: id });
  if (view === 'resume') return prepareExam(data, { attemptId: id });
  if (view === 'result') {
    const a = await getAttempt(id).catch(() => null);
    return result(a?.exam === 'opic' ? opic : data, id);
  }
  if (view === 'opic' && arg === 'start') return opicStart(opic);
  if (view === 'opic' && arg === 'resume') return opicResume(opic, decodeURIComponent(arg2 || ''));
  return home(data, profile, opic);
}

(async () => {
  try {
    [data, opic, consent, levels] = await Promise.all([load('data/toeic.json'), load('data/opic.json'), load('data/consent.json'), load('data/levels.json')]);
  } catch (e) {
    document.getElementById('app').innerHTML = `<p class="panel err">데이터를 불러오지 못했어요 (${esc(e.message)}).</p>`;
    return;
  }
  window.addEventListener('hashchange', route);
  route();
})();
