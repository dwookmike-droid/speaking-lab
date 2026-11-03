// OPIc 모의고사 끝까지 응시 확인: 설문 → 자가평가 → 15문항(다시 듣기, 7번 뒤 재조정) → 결과 → 제출 zip.
// 실행: python3 -m http.server 8765 -d app  →  node tests/e2e_opic.js [출력 폴더]
const { chromium } = require('playwright');
const assert = require('assert'), fs = require('fs'), path = require('path');
const OUT = process.argv[2] || 'test-shots/opic'; fs.mkdirSync(OUT, { recursive: true });
const BASE = (process.env.BASE || 'http://localhost:8765') + '/index.html?fast=30&notts&sb=off';

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ permissions: ['microphone'], acceptDownloads: true, viewport: { width: 900, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // 등록: OPIc만 준비
  await page.goto(BASE + '#/');
  await page.waitForSelector('.onboard'); await page.click('#next');
  await page.fill('input[name=name]', '테스트 학생'); await page.fill('input[name=email]', 'student@example.com'); await page.fill('input[name=phone]', '010-1234-5678');
  await page.check('input[name=under14][value=no]');
  await page.uncheck('input[name=exam][value=toeic]'); await page.check('input[name=exam][value=opic]');
  await page.selectOption('select[name=t_opic]', 'ih');
  await page.click('form .btn.primary'); await page.check('#all'); await page.click('#ok');
  await page.waitForSelector('#opic-panel');
  assert.strictEqual(await page.$('#sets'), null, '토익을 안 고르면 토익 영역이 없어요');
  await page.screenshot({ path: `${OUT}/1_home.png` });

  // 설문: 3개만 고르면 막혀요
  await page.click('#opic-panel .btn.primary');
  await page.waitForSelector('input[name=residence]');
  await page.check('input[value=work_student]'); await page.check('input[value=live_family]');
  await page.check('input[value=movies]'); await page.check('input[value=music]');
  await page.click('form .btn.primary');
  assert.ok((await page.textContent('#err')).includes('4개'));
  await page.check('input[value=park]');
  await page.screenshot({ path: `${OUT}/2_survey.png`, fullPage: true });
  await page.click('form .btn.primary');
  // 자가평가
  await page.waitForSelector('input[name=sa]');
  await page.check('input[name=sa][value="5"]');
  await page.screenshot({ path: `${OUT}/3_sa.png`, fullPage: true });
  await page.click('form .btn.primary');
  await page.click('#mic'); await page.waitForSelector('#go:not([disabled])'); await page.click('#go');

  // 진행: 답변 중이면 '다음 문제', 2번에서는 다시 듣기 한 번
  let replayTested = false, readjusted = false, seen = new Set();
  for (let guard = 0; guard < 2000; guard++) {
    if (page.url().includes('#/result/')) break;
    const st = await page.evaluate(() => ({
      q: document.querySelector('#qno')?.textContent || '', phase: document.querySelector('#phase')?.dataset.kind,
      rec: !document.querySelector('#rec')?.hidden, replay: !document.querySelector('#replay')?.hidden, ra: !!document.querySelector('#ra'),
    })).catch(() => ({}));
    if (st.ra && !readjusted) {
      assert.ok(seen.has('Question 7 of 15'), '재조정은 7번 뒤에 나와요');
      await page.screenshot({ path: `${OUT}/5_readjust.png` });
      await page.click('#ra [data-v=harder]'); readjusted = true; continue;
    }
    if (st.q) seen.add(st.q);
    if (st.q.startsWith('Question 2 ') && st.phase === 'replay_window' && st.replay && !replayTested) {
      await page.click('#replay'); replayTested = true;
      await page.waitForFunction(() => document.querySelector('#replay').hidden);
      continue;
    }
    if (st.phase === 'speak' && st.rec) assert.ok(!(await page.isVisible('#replay')), '답변 중에는 다시 듣기 버튼이 안 보여요');
    if (st.q.startsWith('Question 8 ') && st.phase === 'speak' && st.rec) await page.screenshot({ path: `${OUT}/4_exam.png` });
    if (st.phase === 'speak' && st.rec) { await page.waitForTimeout(400); await page.click('#skip').catch(() => {}); await page.waitForTimeout(100); continue; }
    await page.waitForTimeout(80);
  }
  assert.ok(replayTested, '다시 듣기를 눌러 봤어요'); assert.ok(readjusted, '난이도 재조정');
  await page.waitForSelector('.card');
  const r = await page.evaluate(() => ({
    cards: document.querySelectorAll('.card').length, audios: document.querySelectorAll('.card audio').length,
    types: [...document.querySelectorAll('.card header .muted')].map((x) => x.textContent),
    model: document.querySelector('.card .model-head b')?.textContent,
  }));
  console.log('RESULT', JSON.stringify({ ...r, types: r.types.slice(-3) }));
  assert.strictEqual(r.cards, 15); assert.strictEqual(r.audios, 15);
  assert.ok(r.types[13].startsWith('비교') && r.types[14].startsWith('사회 이슈'), '어렵게 고르면 마지막은 비교 + 이슈');
  assert.strictEqual(r.model, 'IH');
  await page.screenshot({ path: `${OUT}/6_result.png` });
  // 제출
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#submit')]);
  const zip = path.join(OUT, 'opic_submission.zip'); await dl.saveAs(zip);
  console.log('ZIP', dl.suggestedFilename());
  await page.setViewportSize({ width: 375, height: 800 });
  console.log('HSCROLL', await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  console.log('ERRORS', JSON.stringify(errors));
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
