// 학생 등록·동의 흐름 확인: 접근 막기, 필수 확인, 14세 미만 보호자, 선택 항목 미저장, 재동의, 철회.
// 실행: python3 -m http.server 8765 -d app  →  node tests/e2e_onboarding.js [스크린샷 폴더]
const { chromium } = require('playwright');
const assert = require('assert');
const OUT = process.argv[2] || 'test-shots'; require('fs').mkdirSync(OUT + '/onb', { recursive: true });
const BASE = (process.env.BASE || 'http://localhost:8765') + '/index.html';
const profile = (page) => page.evaluate(() => new Promise((res) => {
  const q = indexedDB.open('speaking-lab'); q.onsuccess = () => { const g = q.result.transaction('profile').objectStore('profile').get('me'); g.onsuccess = () => res(g.result || null); };
}));
const shot = (page, n) => page.screenshot({ path: `${OUT}/onb/${n}.png`, fullPage: true });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // 1. 동의 없이 시험 주소로 오면 등록 화면으로
  await page.goto(BASE + '#/start/toeic-set01');
  await page.waitForSelector('.onboard');
  assert.strictEqual(new URL(page.url()).hash, '#/welcome');
  assert.ok(await page.isHidden('#nav-settings'));
  await shot(page, '1_intro');
  await page.click('#next');

  // 2. 빈칸으로 다음 → 오류
  await page.click('form .btn.primary');
  const err = await page.textContent('#err');
  assert.ok(err.includes('이름') && err.includes('휴대폰') && err.includes('14세'), err);
  // 잘못된 번호
  await page.fill('input[name=name]', '테스트 학생');
  await page.fill('input[name=email]', 'student@example.com');
  await page.fill('input[name=phone]', '1234');
  await page.check('input[name=under14][value=yes]');
  await page.fill('input[name=current]', 'OPIc IM1');           // 선택 항목을 쓰지만 동의는 안 할 거예요
  await page.check('input[name=exam][value=opic]');
  await page.click('form .btn.primary');
  assert.ok((await page.textContent('#err')).includes('휴대폰'));
  await page.fill('input[name=phone]', '010-1234-5678');
  await shot(page, '2_form');
  await page.click('form .btn.primary');

  // 3. 동의: 14세 미만이라 보호자 동의 칸이 있어야 하고, 필수만으로는 시작 불가
  await page.waitForSelector('input[name=c_guardian]');
  assert.ok(await page.isDisabled('#ok'));
  await page.check('input[name=c_required]'); await page.check('input[name=c_overseas]');
  assert.ok(await page.isDisabled('#ok'), '보호자 동의 없이 시작 버튼이 켜졌어요');
  await page.check('input[name=c_guardian]');
  assert.ok(await page.isEnabled('#ok'));
  await page.click('#ok');                                      // 보호자 정보 빈칸 → 오류
  assert.ok((await page.textContent('#err')).includes('보호자'));
  await page.fill('input[name=g_name]', '테스트 보호자'); await page.fill('input[name=g_relation]', '어머니');
  await page.fill('input[name=g_phone]', '010-9876-5432'); await page.selectOption('select[name=g_method]', 'signature');
  // 전체 동의 체크박스 확인 후 선택 항목만 다시 끔
  await page.check('#all');
  assert.ok(await page.isChecked('input[name=c_optional]'));
  await page.uncheck('input[name=c_optional]');
  assert.ok(!(await page.isChecked('#all')));
  await shot(page, '3_consent');
  await page.setViewportSize({ width: 375, height: 800 });
  const hs = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  await page.screenshot({ path: `${OUT}/onb/3_consent_mobile.png` });
  await page.setViewportSize({ width: 900, height: 900 });
  await page.click('#ok');
  await page.waitForSelector('#sets');
  let p = await profile(page);
  assert.strictEqual(p.optional, null, '선택 동의를 안 했는데 선택 항목이 저장됐어요');
  assert.strictEqual(p.consent.version, 1); assert.strictEqual(p.consent.guardian, true);
  assert.strictEqual(p.guardian.method, 'signature');
  assert.deepStrictEqual(p.exams.sort(), ['opic', 'toeic']);
  assert.ok(await page.isVisible('#nav-settings'));
  console.log('ONBOARD ok · mobile hscroll', hs);

  // 4. 설정 화면
  await page.click('#nav-settings');
  await page.waitForSelector('.kv');
  const st = await page.textContent('#app');
  assert.ok(st.includes('동의서 v1') && st.includes('테스트 보호자') && st.includes('동의 안 함'));
  await shot(page, '4_settings');
  const [dl1] = await Promise.all([page.waitForEvent('download'), page.click('#dl')]);
  console.log('CONSENT_RECORD', dl1.suggestedFilename());

  // 5. 동의서 버전이 바뀌면 다시 동의
  await page.evaluate(() => new Promise((res) => {
    const q = indexedDB.open('speaking-lab'); q.onsuccess = () => {
      const s = q.result.transaction('profile', 'readwrite').objectStore('profile');
      const g = s.get('me'); g.onsuccess = () => { const v = g.result; v.consent.version = 0; s.put(v).onsuccess = res; };
    };
  }));
  await page.goto(BASE + '#/'); await page.reload();
  await page.waitForSelector('.onboard');
  assert.ok((await page.textContent('h1')).includes('동의서가 바뀌었어요'));
  await page.click('#next');
  assert.strictEqual(await page.inputValue('input[name=name]'), '테스트 학생');   // 정보는 그대로
  assert.strictEqual(await page.inputValue('input[name=current]'), '');            // 동의 안 한 선택 항목은 남아 있지 않아요
  await page.fill('input[name=current]', 'OPIc IM1');
  await page.click('form .btn.primary');
  await page.check('#all');
  await page.click('#ok');
  await page.waitForSelector('#sets');
  p = await profile(page);
  assert.strictEqual(p.consent.version, 1); assert.strictEqual(p.consent_history.length, 2);
  assert.strictEqual(p.optional.current, 'OPIc IM1', '선택 동의 후 선택 항목이 저장돼야 해요');
  console.log('RECONSENT ok');

  // 6. 인쇄용 동의서
  const pr = await ctx.newPage();
  await pr.goto((process.env.BASE || 'http://localhost:8765') + '/consent.html');
  await pr.waitForSelector('.csec');
  const secs = await pr.locator('.csec').count();
  assert.strictEqual(secs, 6);
  await pr.screenshot({ path: `${OUT}/onb/6_print.png`, fullPage: true });
  console.log('PRINT sections', secs);

  // 7. 동의 철회 → 모두 지움
  await page.goto(BASE + '#/settings');
  await page.waitForSelector('#withdraw');
  assert.ok(await page.isDisabled('#withdraw'));
  await page.check('#sure');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#withdraw')]);
  await page.waitForSelector('text=동의를 철회했어요');
  assert.strictEqual(await profile(page), null);
  await page.goto(BASE + '#/'); await page.waitForSelector('.onboard');
  console.log('WITHDRAW ok', dl2.suggestedFilename());
  console.log('ERRORS', JSON.stringify(errors));
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
