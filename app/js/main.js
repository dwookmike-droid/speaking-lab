// 라우터: #/ 홈 · #/start/<세트> · #/resume/<응시> · #/result/<응시>
import { home, prepareExam, result, stopCurrent, esc } from './views.js';

let data;
async function load() {
  const r = await fetch('data/toeic.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error(`data/toeic.json ${r.status}`);
  return r.json();
}

async function route() {
  stopCurrent();
  const [, view, arg] = (location.hash || '#/').slice(1).split('/');
  const id = arg ? decodeURIComponent(arg) : '';
  window.scrollTo(0, 0);
  if (view === 'start') return prepareExam(data, { setId: id });
  if (view === 'resume') return prepareExam(data, { attemptId: id });
  if (view === 'result') return result(data, id);
  return home(data);
}

(async () => {
  try {
    data = await load();
  } catch (e) {
    document.getElementById('app').innerHTML = `<p class="panel err">문항 데이터를 불러오지 못했어요 (${esc(e.message)}).</p>`;
    return;
  }
  window.addEventListener('hashchange', route);
  route();
})();
