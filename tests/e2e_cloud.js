// 서버 모드 왕복: 가짜 Supabase(tests/mock_supabase.js) + 선생님 도구(tools/cloud_sync.py) + 학생 앱.
// 등록 코드 → 가입·동의 → 응시·제출(업로드) → 선생님 pull → 피드백 push → 학생에게 도착·읽음 → 다른 기기 로그인 → 철회.
// 실행: python3 -m http.server 8765 -d app &  →  node tests/e2e_cloud.js [출력 폴더]
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
const REPO = path.resolve(__dirname, '..');
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'slcloud-'));
const MOCK = 'http://localhost:8766';
const BASE = `${process.env.BASE || 'http://localhost:8765'}/index.html?fast=30&notts&sb=${encodeURIComponent(MOCK)}`;
const TEACHER = { SL_TEACHER_EMAIL: 'teacher@example.com', SL_TEACHER_PASSWORD: 'teacher-pass' };

// 선생님 컴퓨터: 임시 폴더를 ROOT로 (실제 students/·submissions/에 테스트 자료가 남지 않게)
const ROOT = path.join(OUT, 'teacher'); fs.mkdirSync(ROOT, { recursive: true });
for (const d of ['schema', 'content', 'app']) { try { fs.symlinkSync(path.join(REPO, d), path.join(ROOT, d)); } catch {} }
const teacher = (...args) => execFileSync('python3', [path.join(REPO, 'tools/cloud_sync.py'), ...args],
  { env: { ...process.env, ...TEACHER, SL_SUPABASE_URL: MOCK, SPEAKING_LAB_ROOT: ROOT }, encoding: 'utf8' });
const py = (script, ...args) => execFileSync('python3', [path.join(REPO, script), ...args], { env: { ...process.env, SPEAKING_LAB_ROOT: ROOT }, encoding: 'utf8' });
const dump = async () => (await fetch(`${MOCK}/__dump`)).json();

(async () => {
  const mock = spawn('node', [path.join(__dirname, 'mock_supabase.js'), '8766'], { env: { ...process.env, TEACHER_EMAIL: TEACHER.SL_TEACHER_EMAIL, TEACHER_PASSWORD: TEACHER.SL_TEACHER_PASSWORD }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const errors = [];
  const newPage = async () => {
    const ctx = await browser.newContext({ permissions: ['microphone'], viewport: { width: 900, height: 900 } });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/40[0-9]|422/.test(m.text())) errors.push(m.text()); });
    return p;
  };
  try {
    // 1. 선생님: 등록 코드
    const inv = teacher('invite', '--note', '테스트');
    const code = inv.match(/등록 코드 ([A-Z0-9]{8})/)[1];
    console.log('INVITE', inv.split('\n')[0]);

    // 2. 학생: 로그인 화면 → 처음 왔어요
    const page = await newPage();
    await page.goto(BASE + '#/');
    await page.waitForSelector('input[name=id]');
    assert.ok(await page.isHidden('#nav-settings'));
    await page.click('[data-m=signup]');
    await page.fill('input[name=id]', 'minji01'); await page.fill('input[name=pin]', '1234'); await page.fill('input[name=pin2]', '1234');
    await page.fill('input[name=code]', 'WRONG123');
    await page.click('#go');
    await page.waitForSelector('text=등록 코드를 입력해요');                       // 계정은 생겼지만 코드가 틀림 → 코드만 다시
    console.log('BAD_CODE', (await page.textContent('.notice')).trim());
    await page.fill('input[name=code]', code.toLowerCase()); await page.click('#go');
    await page.waitForSelector('.onboard .step');
    assert.ok((await page.textContent('#app')).includes('시작하기 전에'));
    await page.click('#next');
    assert.strictEqual(await page.$('input[name=email]'), null, '서버 모드에서는 이메일을 묻지 않아요');
    await page.fill('input[name=name]', '테스트 학생'); await page.fill('input[name=phone]', '010-1234-5678');
    await page.check('input[name=under14][value=no]');
    await page.click('form .btn.primary'); await page.check('#all'); await page.click('#ok');
    await page.waitForSelector('#sets');
    let d = await dump();
    const st = d.tables.speaking_students[0];
    assert.strictEqual(st.code, 'S001'); assert.strictEqual(st.consent.version, 2); assert.strictEqual(st.profile.name, '테스트 학생');
    console.log('SIGNUP ok', st.code, 'consent v' + st.consent.version);

    // 3. 응시 → 제출(업로드)
    await page.selectOption('#target', 'lv7');
    await page.click('#sets .btn >> nth=0'); await page.click('#mic');
    await page.waitForSelector('#go:not([disabled])'); await page.click('#go');
    await page.waitForFunction(() => location.hash.startsWith('#/result/'), null, { timeout: 120000 });
    await page.click('#submit');
    await page.waitForFunction(() => document.querySelector('#submitmsg').textContent.includes('보냈어요'), null, { timeout: 30000 });
    d = await dump();
    assert.strictEqual(d.objects.length, 11); assert.ok(d.objects.every((k) => k.startsWith(`speaking-audio/${st.id}/`)));
    const att = d.tables.speaking_attempts[0];
    assert.strictEqual(att.target, 'lv7'); assert.strictEqual(att.items.length, 11);
    console.log('SUBMIT ok', att.id, d.objects.length, 'files');

    // 4. 선생님: 받기 → 전사(테스트용) → 피드백 → 올리기
    console.log('PULL', teacher('pull').trim().split('\n').filter((l) => l.startsWith('받았어요')).join(' | ').replace(ROOT, '…'));
    const dir = path.join(ROOT, 'submissions', 'S001', att.id);
    assert.strictEqual(fs.readdirSync(path.join(dir, 'audio')).length, 11);
    const aj = fs.readFileSync(path.join(dir, 'attempt.json'), 'utf8');
    assert.ok(!aj.includes('테스트 학생') && !aj.includes('010-1234') && !aj.includes('minji01'), '제출 폴더에 개인정보 없음');
    assert.ok(fs.readFileSync(path.join(ROOT, 'students', 'roster.yaml'), 'utf8').includes('테스트 학생'));
    assert.ok(teacher('pull').includes('새 제출이 없어요'), '두 번 받지 않아요');
    py('tests/make_transcript.py', path.join(REPO, 'tests/fixtures/student_set01.yaml'), dir);
    fs.writeFileSync(path.join(dir, 'feedback.yaml'), fs.readFileSync(path.join(REPO, 'tests/fixtures/feedback_set01.yaml'), 'utf8').replaceAll('__ATTEMPT__', att.id));
    console.log('PUSH', teacher('push', dir).trim().split('\n').pop());

    // 5. 학생: 홈에 피드백 도착 → 결과 화면 → 읽음
    await page.goto(BASE + '#/'); await page.reload();
    await page.waitForSelector('#recent .li');
    assert.ok((await page.textContent('#recent')).includes('피드백 도착'));
    await page.click('#recent .li >> text=결과');
    await page.waitForSelector('.fb.overall');
    console.log('FEEDBACK', (await page.textContent('.fb.overall .lvline')).trim(), '·', await page.locator('.card .fix').count(), 'fixes');
    await page.waitForTimeout(500);
    d = await dump(); assert.ok(d.tables.speaking_feedback[0].read_at, '읽음 표시');

    // 6. 다른 기기에서 로그인: 정보가 이어지고 다시 등록할 필요 없음 / 틀린 PIN
    const p2 = await newPage();
    await p2.goto(BASE + '#/'); await p2.waitForSelector('input[name=id]');
    await p2.fill('input[name=id]', 'minji01'); await p2.fill('input[name=pin]', '9999'); await p2.click('#go');
    await p2.waitForFunction(() => document.querySelector('#err').textContent.length > 0);
    console.log('WRONG_PIN', await p2.textContent('#err'));
    await p2.fill('input[name=pin]', '1234'); await p2.click('#go');
    await p2.waitForSelector('#sets');
    await p2.click('#nav-settings'); await p2.waitForSelector('.kv');
    assert.ok((await p2.textContent('.kv')).includes('S001'));
    console.log('SECOND_DEVICE ok');

    // 7. 철회 → 서버 자료 삭제 → 선생님 알림 → 서버 정리
    await p2.check('#sure'); await p2.click('#withdraw');
    await p2.waitForSelector('text=동의를 철회했어요');
    d = await dump();
    assert.strictEqual(d.objects.length, 0); assert.strictEqual(d.tables.speaking_attempts.length, 0);
    assert.ok(d.tables.speaking_students[0].withdrawn_at); assert.deepStrictEqual(d.tables.speaking_students[0].profile, {});
    const warn = teacher('pull'); assert.ok(warn.includes('철회'), warn);
    console.log('WITHDRAW ok ·', warn.split('\n')[0].slice(0, 40));
    teacher('delete', 'S001'); d = await dump(); assert.strictEqual(d.tables.speaking_students.length, 0);
    // 철회한 계정으로 다시 로그인 → 막힘
    const p3 = await newPage();
    await p3.goto(BASE + '#/'); await p3.waitForSelector('input[name=id]');
    await p3.fill('input[name=id]', 'minji01'); await p3.fill('input[name=pin]', '1234'); await p3.click('#go');
    await p3.waitForSelector('text=등록 코드를 입력해요');
    console.log('AFTER_DELETE login → 등록 코드 요구');
    console.log('ERRORS', JSON.stringify(errors));
    if (errors.length) process.exitCode = 1;
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; }
  finally { await browser.close(); mock.kill(); }
})();
