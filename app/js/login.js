// 로그인: 아이디 + PIN. 처음 온 학생은 선생님이 준 등록 코드로 계정을 만들어요.
import { cloud, LOGIN_RE, PIN_RE } from './cloud.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $app = () => document.getElementById('app');

// mode: 'login' | 'signup' | 'claim'(로그인은 됐는데 등록 코드를 아직 안 쓴 계정)
export function loginView({ onDone, mode = 'login', notice = '' }) {
  const claimOnly = mode === 'claim';
  $app().innerHTML = `
    <form class="panel onboard" id="f" novalidate>
      <h1>${claimOnly ? '등록 코드를 입력해요' : mode === 'signup' ? '처음 왔어요' : '로그인'}</h1>
      ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}
      ${claimOnly ? `<p>이 계정(<b>${esc(cloud.loginId)}</b>)은 아직 Speaking Lab에 등록되지 않았어요. 선생님께 받은 등록 코드를 넣어 주세요.</p>` : `
      <div class="tabs"><button type="button" class="btn ${mode === 'login' ? 'primary' : 'ghost'}" data-m="login">로그인</button>
        <button type="button" class="btn ${mode === 'signup' ? 'primary' : 'ghost'}" data-m="signup">처음 왔어요</button></div>
      <label>아이디<input name="id" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="영문 소문자·숫자 3~30자"></label>
      <label>PIN <span class="muted">(숫자 4~8자리)</span><input name="pin" type="password" inputmode="numeric" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"></label>
      ${mode === 'signup' ? '<label>PIN 한 번 더<input name="pin2" type="password" inputmode="numeric" autocomplete="new-password"></label>' : ''}`}
      ${mode !== 'login' ? '<label>등록 코드 <span class="muted">(선생님께 받은 8자리)</span><input name="code" autocapitalize="characters" spellcheck="false" maxlength="8"></label>' : ''}
      <p class="err" id="err" role="alert"></p>
      <div class="btns"><button class="btn primary" id="go">${mode === 'login' ? '로그인' : '시작하기'}</button>
        ${claimOnly ? '<button type="button" class="btn ghost" id="out">다른 아이디로 로그인</button>' : ''}</div>
      ${mode === 'login' ? '<p class="muted">PIN을 잊어버렸으면 선생님께 말씀해 주세요.</p>' : ''}
    </form>`;
  const f = $app().querySelector('#f');
  const err = (m) => { f.querySelector('#err').textContent = m; };
  f.querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => loginView({ onDone, mode: b.dataset.m }); });
  f.querySelector('#out')?.addEventListener('click', () => { cloud.signOut(); loginView({ onDone }); });
  f.onsubmit = async (e) => {
    e.preventDefault();
    const v = (n) => (f.elements[n]?.value || '').trim();
    const id = v('id').toLowerCase(), pin = v('pin'), code = v('code').toUpperCase();
    if (!claimOnly) {
      if (!LOGIN_RE.test(id)) return err('아이디는 영문 소문자·숫자·점·밑줄로 3~30자예요.');
      if (!PIN_RE.test(pin)) return err('PIN은 숫자 4~8자리예요.');
      if (mode === 'signup' && pin !== v('pin2')) return err('PIN이 서로 달라요.');
    }
    if (mode !== 'login' && !/^[A-Z0-9]{8}$/.test(code)) return err('등록 코드는 영문·숫자 8자리예요.');
    const btn = f.querySelector('#go'); btn.disabled = true; err('');
    try {
      if (mode === 'login') await cloud.signIn(id, pin);
      if (mode === 'signup') await cloud.signUp(id, pin);
      if (mode !== 'login') await cloud.claim(code, cloud.loginId);
      onDone();
    } catch (ex) {
      err(ex.message);
      if (mode === 'signup' && cloud.session()) loginView({ onDone, mode: 'claim', notice: `계정은 만들었어요. ${ex.message}` });
    } finally { btn.disabled = false; }
  };
}
