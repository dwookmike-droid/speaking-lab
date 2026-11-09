// 토익 모의테스트 끝까지 응시 확인 (가짜 마이크, 30배 빠르게).
// 실행: python3 -m http.server 8765 -d app  →  node tests/e2e_toeic.js [스크린샷 폴더]
const { chromium } = require('playwright');
const { onboard } = require('./onboard');
const SP = process.argv[2] || 'test-shots';
const SET = Number(process.env.SET || 0);   // 응시할 세트 순서(0부터) require('fs').mkdirSync(SP + '/shots', { recursive: true });
(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ permissions: ['microphone'], viewport: { width: 900, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const base = (process.env.BASE || 'http://localhost:8765') + '/index.html?fast=30&notts&sb=off';
  await page.goto(base + '#/');
  await onboard(page);
  await page.waitForSelector('#sets .btn');
  await page.selectOption('#target', 'lv7');
  await page.screenshot({ path: SP + '/shots/1_home.png' });
  await page.click(`#sets .btn >> nth=${SET}`);
  await page.click('#mic');
  await page.waitForSelector('#go:not([disabled])');
  await page.click('#go');
  // Q8 화면 캡처
  await page.waitForFunction(() => document.querySelector('#qno')?.textContent.includes('Question 8'), null, { timeout: 60000 });
  await page.waitForSelector('#rec:not([hidden])', { timeout: 20000 });
  // 녹음 중 레벨 막대가 움직이는지 (가짜 마이크는 삐 소리를 계속 내요)
  await page.waitForFunction(() => parseFloat(document.querySelector('#rec .meter i')?.style.width) > 0, null, { timeout: 5000 });
  await page.screenshot({ path: SP + '/shots/2_q8.png' });
  await page.waitForFunction(() => location.hash.startsWith('#/result/'), null, { timeout: 90000 });
  await page.waitForSelector('.card');
  const r = await page.evaluate(() => ({
    cards: document.querySelectorAll('.card').length,
    audios: [...document.querySelectorAll('.card audio')].length,
    firstModel: document.querySelector('.card[data-num="3"] .model-head b')?.textContent,
  }));
  console.log('RESULT', JSON.stringify(r));
  // 녹음 크기
  const sizes = await page.evaluate(async () => {
    const id = location.hash.split('/')[2];
    const db = await new Promise(r => { const q = indexedDB.open('speaking-lab'); q.onsuccess = () => r(q.result); });
    const out = [];
    for (let n = 1; n <= 11; n++) out.push(await new Promise(r => { const g = db.transaction('recordings').objectStore('recordings').get(`${id}:${n}`); g.onsuccess = () => r(g.result ? [g.result.blob.size, g.result.ms, g.result.blob.type] : null); }));
    return out;
  });
  console.log('REC', JSON.stringify(sizes));
  // 점검표 체크 → 새로고침 후 유지
  await page.check('.card[data-num="11"] input[type=checkbox] >> nth=0');
  await page.click('.card[data-num="11"] [data-act=up]');
  const upHead = await page.textContent('.card[data-num="11"] .up .model-head b');
  console.log('UP', upHead);
  await page.reload(); await page.waitForSelector('.card');
  console.log('CHECK_PERSIST', await page.isChecked('.card[data-num="11"] input[type=checkbox] >> nth=0'), await page.textContent('#sum'));
  await page.screenshot({ path: SP + '/shots/3_result.png', fullPage: false });
  await page.locator('.card[data-num="11"]').screenshot({ path: SP + '/shots/4_q11card.png' });
  // 이어하기: 새 응시를 Q3에서 그만두기
  await page.goto(base + '#/');
  await page.click(`#sets .btn >> nth=${SET}`); await page.click('#mic');
  await page.waitForSelector('#go:not([disabled])'); await page.click('#go');
  await page.waitForFunction(() => document.querySelector('#qno')?.textContent.includes('Question 3'), null, { timeout: 60000 });
  await page.click('#quit');
  await page.waitForSelector('#recent .li');
  const recent = await page.textContent('#recent .li');
  console.log('RECENT', recent.replace(/\s+/g, ' ').trim());
  await page.click('#recent .li >> text=이어하기');
  await page.click('#mic'); await page.waitForSelector('#go:not([disabled])'); await page.click('#go');
  const firstQ = await page.waitForFunction(() => document.querySelector('#qno')?.textContent, null, { timeout: 10000 });
  console.log('RESUME_FIRST', await firstQ.jsonValue());
  await page.waitForFunction(() => location.hash.startsWith('#/result/'), null, { timeout: 90000 });
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 11, null, { timeout: 10000 });
  console.log('RESUME_DONE', await page.evaluate(() => document.querySelectorAll('.card audio').length));
  // 휴대폰 폭
  await page.setViewportSize({ width: 375, height: 800 });
  await page.screenshot({ path: SP + '/shots/5_mobile_result.png' });
  console.log('HSCROLL', await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  console.log('ERRORS', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
