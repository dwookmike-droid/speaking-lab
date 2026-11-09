// 선생님 모드 확인(가짜 Supabase): 로그인·거절, 앱에서 등록 코드 → 학생 가입·제출 → 제출함·학생 목록 → 응시 상세 녹음 듣기
// → 피드백 보냄/읽음 상태 → 등록 코드 지우기 → 같은 기기에서 학생·선생님 세션 분리.
// 실행: python3 -m http.server 8765 -d app &  →  node tests/e2e_teacher.js [출력 폴더]
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
const REPO = path.resolve(__dirname, '..');
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'slteacher-'));
const MOCK = 'http://localhost:8767';
const BASE = `${process.env.BASE || 'http://localhost:8765'}/index.html?fast=30&notts&sb=${encodeURIComponent(MOCK)}`;
const T = { email: 'teacher@example.com', pw: 'teacher-pass' };
const ROOT = path.join(OUT, 'teacher'); fs.mkdirSync(ROOT, { recursive: true });
for (const d of ['schema', 'content', 'app']) { try { fs.symlinkSync(path.join(REPO, d), path.join(ROOT, d)); } catch {} }
const cli = (...a) => execFileSync('python3', [path.join(REPO, 'tools/cloud_sync.py'), ...a],
  { env: { ...process.env, SL_TEACHER_EMAIL: T.email, SL_TEACHER_PASSWORD: T.pw, SL_SUPABASE_URL: MOCK, SPEAKING_LAB_ROOT: ROOT }, encoding: 'utf8' });
const py = (s, ...a) => execFileSync('python3', [path.join(REPO, s), ...a], { env: { ...process.env, SPEAKING_LAB_ROOT: ROOT }, encoding: 'utf8' });
const dump = async () => (await fetch(`${MOCK}/__dump`)).json();

(async () => {
  const mock = spawn('node', [path.join(__dirname, 'mock_supabase.js'), '8767'], { env: { ...process.env, TEACHER_EMAIL: T.email, TEACHER_PASSWORD: T.pw }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const errors = [];
  const newPage = async () => {
    const ctx = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1000, height: 900 } });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/40[0-9]|422/.test(m.text())) errors.push(m.text()); });
    return p;
  };
  try {
    // 1. 선생님 로그인 (학생 로그인 화면의 링크로)
    const tp = await newPage();
    await tp.goto(BASE + '#/'); await tp.waitForSelector('input[name=id]');
    await tp.click('text=선생님 입장');
    await tp.waitForSelector('input[name=email]');
    await tp.fill('input[name=email]', T.email); await tp.fill('input[name=pw]', 'wrong'); await tp.click('#go');
    await tp.waitForFunction(() => document.querySelector('#err').textContent.length > 0);
    console.log('WRONG_PW', await tp.textContent('#err'));
    await tp.fill('input[name=pw]', T.pw); await tp.click('#go');
    await tp.waitForSelector('#newinv');
    // 2. 앱에서 등록 코드
    await tp.fill('#newinv input[name=note]', '테스트 반'); await tp.click('#newinv button');
    await tp.waitForSelector('#made .code.big');
    const code = (await tp.textContent('#made .code.big')).trim();
    assert.match(code, /^[A-Z0-9]{8}$/); assert.ok((await tp.inputValue('#invmsg')).includes(code));
    console.log('INVITE', code, (await tp.textContent('#made p')).trim());
    await tp.screenshot({ path: path.join(OUT, 't1_home.png'), fullPage: true });

    // 3. 학생: 가입·동의·응시·제출
    const sp = await newPage();
    await sp.goto(BASE + '#/'); await sp.waitForSelector('input[name=id]');
    await sp.click('[data-m=signup]');
    await sp.fill('input[name=id]', 'minji01'); await sp.fill('input[name=pin]', '1234'); await sp.fill('input[name=pin2]', '1234');
    await sp.fill('input[name=code]', code); await sp.click('#go');
    await sp.waitForSelector('#next'); await sp.click('#next');
    await sp.fill('input[name=name]', '테스트 학생'); await sp.fill('input[name=phone]', '010-1234-5678');
    await sp.check('input[name=under14][value=no]'); await sp.click('form .btn.primary'); await sp.check('#all'); await sp.click('#ok');
    await sp.waitForSelector('#sets'); await sp.selectOption('#target', 'lv7');
    await sp.click('#sets .btn >> nth=0'); await sp.click('#mic'); await sp.waitForSelector('#go:not([disabled])'); await sp.click('#go');
    await sp.waitForFunction(() => location.hash.startsWith('#/result/'), null, { timeout: 120000 });
    await sp.click('#submit');
    await sp.waitForFunction(() => document.querySelector('#submitmsg').textContent.includes('보냈어요'), null, { timeout: 30000 });
    const att = (await dump()).tables.speaking_attempts[0];

    // 4. 학생 계정으로 선생님 입장 → 거절 (학생 세션은 그대로)
    await sp.goto(BASE + '#/teacher'); await sp.waitForSelector('input[name=email]');
    await sp.fill('input[name=email]', 'minji01@speaking.local'); await sp.fill('input[name=pw]', '1234-spk'); await sp.click('#go');
    await sp.waitForFunction(() => document.querySelector('#err').textContent.includes('선생님 계정이 아니에요'));
    console.log('STUDENT_AS_TEACHER rejected');
    await sp.goto(BASE + '#/'); await sp.waitForSelector('#sets');

    // 5. 선생님: 제출함·학생 목록
    await tp.reload(); await tp.waitForSelector('#newinv');
    const home = await tp.textContent('#app');
    assert.ok(home.includes('새 제출 1') && home.includes('테스트 학생') && home.includes('S001') && home.includes('v2'), home.slice(0, 300));
    assert.ok(!(await tp.textContent('#invites')).includes(code), '쓴 등록 코드는 목록에서 빠져요');
    assert.ok((await tp.textContent('.tstudents')).includes('토익스피킹 lv7'), '학생이 바꾼 목표 레벨이 보여요');
    console.log('DASHBOARD ok', (await tp.textContent('.panel .muted')).trim());
    // 6. 응시 상세: 녹음 11개
    await tp.click(`a[href="#/teacher/attempt/${att.id}"] >> nth=0`);
    await tp.waitForFunction(() => document.querySelectorAll('.aud audio').length === 11, null, { timeout: 20000 });
    const sizes = await tp.evaluate(async () => Promise.all([...document.querySelectorAll('.aud audio')].map(async (a) => (await (await fetch(a.src)).blob()).size)));
    assert.ok(sizes.every((n) => n > 1000), JSON.stringify(sizes));
    assert.ok((await tp.textContent('#app')).includes('아직 Mac으로 받지 않았어요'));
    console.log('DETAIL ok · audio bytes', sizes.slice(0, 3).join(','), '…');
    await tp.screenshot({ path: path.join(OUT, 't2_detail.png') });
    assert.strictEqual((await dump()).tables.speaking_attempts[0].pulled_at, undefined, '선생님 화면은 pulled_at을 바꾸지 않아요');

    // 7. Mac: pull → 전사(테스트용) → push  →  선생님 화면: 보냄 → 학생이 읽음
    cli('pull');
    const dir = path.join(ROOT, 'submissions', 'S001', att.id);
    py('tests/make_transcript.py', path.join(REPO, 'tests/fixtures/student_set01.yaml'), dir);
    fs.writeFileSync(path.join(dir, 'feedback.yaml'), fs.readFileSync(path.join(REPO, 'tests/fixtures/feedback_set01.yaml'), 'utf8').replaceAll('__ATTEMPT__', att.id));
    cli('push', dir);
    await tp.reload(); await tp.waitForSelector('.fb.overall');
    assert.ok((await tp.textContent('.fb.overall')).includes('아직 안 읽음'));
    await sp.reload(); await sp.waitForSelector('#recent .li'); await sp.click('#recent .li >> text=결과'); await sp.waitForSelector('.fb.overall');
    await sp.waitForTimeout(500);
    await tp.reload(); await tp.waitForSelector('.fb.overall');
    assert.ok((await tp.textContent('.fb.overall')).includes('읽음'));
    await tp.goto(BASE + '#/teacher'); await tp.waitForSelector('#newinv');
    assert.ok((await tp.textContent('section:has(h2:text("최근 응시"))')).includes('읽음'));
    console.log('FEEDBACK status: 보냄 → 읽음');

    // 8. 등록 코드 지우기
    await tp.fill('#newinv input[name=note]', ''); await tp.click('#newinv button'); await tp.waitForSelector('#made .code.big');
    const code2 = (await tp.textContent('#made .code.big')).trim();
    assert.ok((await tp.textContent('#made')).includes('S002'));
    await tp.click('#reload'); await tp.waitForSelector(`[data-del="${code2}"]`);
    tp.once('dialog', (d) => d.accept()); await tp.click(`[data-del="${code2}"]`);
    await tp.waitForFunction((c) => !document.querySelector(`[data-del="${c}"]`), code2);
    assert.strictEqual((await dump()).tables.speaking_invites.filter((i) => i.code === code2).length, 0);
    console.log('INVITE deleted', code2);

    // 9. 같은 기기: 학생 기기에서 선생님 로그인 → 로그아웃해도 학생 세션 유지
    await sp.goto(BASE + '#/teacher'); await sp.waitForSelector('input[name=email]');
    await sp.fill('input[name=email]', T.email); await sp.fill('input[name=pw]', T.pw); await sp.click('#go'); await sp.waitForSelector('#newinv');
    await sp.click('#out'); await sp.waitForSelector('input[name=email]');
    await sp.goto(BASE + '#/'); await sp.waitForSelector('#sets');
    console.log('SESSIONS separated');
    await tp.setViewportSize({ width: 375, height: 800 });
    console.log('HSCROLL', await tp.evaluate(() => document.documentElement.scrollWidth > innerWidth));
    await tp.screenshot({ path: path.join(OUT, 't3_mobile.png'), fullPage: true });
    console.log('ERRORS', JSON.stringify(errors));
    if (errors.length) process.exitCode = 1;
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; }
  finally { await browser.close(); mock.kill(); }
})();
