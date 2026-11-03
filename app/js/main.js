// 라우터: #/welcome 등록·동의 · #/ 홈 · #/start/<세트> · #/resume/<응시> · #/result/<응시> · #/settings
// 현재 동의서에 동의한 기록이 없으면 어느 주소로 와도 #/welcome으로 보내요.
import { home, prepareExam, result, stopCurrent, esc } from './views.js';
import { consentValid, settings, welcome } from './onboarding.js';
import { getAttempt, getProfile } from './store.js';
import { opicResume, opicStart } from './opic_views.js';

let data, opic, consent, levels;
async function load(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}

async function route() {
  stopCurrent();
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
