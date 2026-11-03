// 학생 쪽 왕복 확인 ① 응시 → "선생님께 보내기" zip 받기, ② feedback.json 불러오기 → 결과 화면에 표시.
// 사용: node tests/e2e_submit.js submit <출력폴더>          → <출력폴더>/submission.zip, state.json(브라우저 저장소)
//       node tests/e2e_submit.js import <출력폴더> <feedback.json>
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), assert = require('assert');
const { onboard } = require('./onboard');
const [mode, OUT, FB] = process.argv.slice(2);
const BASE = (process.env.BASE || 'http://localhost:8765') + '/index.html?fast=30&notts&sb=off';
const ARGS = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ARGS });
  const statePath = path.join(OUT, 'state.json');
  const ctx = await browser.newContext({ permissions: ['microphone'], acceptDownloads: true, viewport: { width: 900, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  if (mode === 'submit') {
    await page.goto(BASE + '#/');
    await onboard(page);
    await page.selectOption('#target', 'lv7');
    await page.click('#sets .btn >> nth=0');
    await page.click('#mic'); await page.waitForSelector('#go:not([disabled])'); await page.click('#go');
    await page.waitForFunction(() => location.hash.startsWith('#/result/'), null, { timeout: 120000 });
    await page.waitForSelector('#submit');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#submit')]);
    const zip = path.join(OUT, 'submission.zip');
    await dl.saveAs(zip);
    await page.waitForFunction(() => document.querySelector('#submitmsg').textContent.includes('내려받았어요'));
    console.log('ZIP', dl.suggestedFilename(), fs.statSync(zip).size, 'bytes');
    console.log('MSG', await page.textContent('#submitmsg'));
    // 브라우저 저장소(IndexedDB)를 다음 단계로 넘기려고 내보내요
    const dump = await page.evaluate(async () => {
      const db = await new Promise((r) => { const q = indexedDB.open('speaking-lab'); q.onsuccess = () => r(q.result); });
      const all = (s) => new Promise((r) => { const g = db.transaction(s).objectStore(s).getAll(); g.onsuccess = () => r(g.result); });
      return { attempts: await all('attempts'), profile: await all('profile'), ls: { ...localStorage } };
    });
    fs.writeFileSync(statePath, JSON.stringify(dump));
    await page.goto(BASE + '#/');
    await page.waitForSelector('#recent .li');
    assert.ok((await page.textContent('#recent')).includes('보냄'));
  } else {
    const dump = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    await page.goto(BASE + '#/welcome');
    await page.evaluate(async (d) => {
      await new Promise((res) => { const q = indexedDB.open('speaking-lab', 2); q.onupgradeneeded = () => { const db = q.result;
        db.createObjectStore('attempts', { keyPath: 'id' }); db.createObjectStore('recordings'); db.createObjectStore('profile', { keyPath: 'id' }); };
        q.onsuccess = () => { const t = q.result.transaction(['attempts', 'profile'], 'readwrite');
          d.attempts.forEach((a) => t.objectStore('attempts').put(a)); d.profile.forEach((p) => t.objectStore('profile').put(p));
          t.oncomplete = res; }; });
      Object.entries(d.ls).forEach(([k, v]) => localStorage.setItem(k, v));
    }, dump);
    await page.goto(BASE + '#/'); await page.reload();
    await page.waitForSelector('#fbfile', { state: 'attached' });
    // 잘못된 파일 먼저
    const bad = path.join(OUT, 'bad.json'); fs.writeFileSync(bad, '{"type":"x"}');
    await page.setInputFiles('#fbfile', bad);
    await page.waitForFunction(() => document.querySelector('#fberr').textContent.length > 0);
    console.log('BAD_FILE', await page.textContent('#fberr'));
    await page.setInputFiles('#fbfile', FB);
    await page.waitForSelector('.fb.overall');
    const r = await page.evaluate(() => ({
      overall: document.querySelector('.fb.overall .lvline')?.textContent.trim(),
      itemFb: document.querySelectorAll('.card .fb').length,
      fixes: document.querySelectorAll('.card .fix').length,
    }));
    console.log('FEEDBACK', JSON.stringify(r));
    await page.screenshot({ path: path.join(OUT, 'fb_top.png') });
    await page.locator('.card[data-num="11"]').screenshot({ path: path.join(OUT, 'fb_q11.png') });
    await page.goto(BASE + '#/'); await page.waitForSelector('#recent .li');
    assert.ok((await page.textContent('#recent')).includes('피드백 도착'));
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(BASE + `#/result/${dump.attempts[0].id}`); await page.waitForSelector('.fb.overall');
    console.log('HSCROLL', await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  }
  console.log('ERRORS', JSON.stringify(errors));
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
