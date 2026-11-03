// 테스트 도우미: 첫 접속 화면(안내 → 학생 정보 → 동의)을 통과해요. 가짜 학생 정보만 써요.
async function onboard(page, { under14 = false, optional = false } = {}) {
  await page.waitForSelector('.onboard');
  if (await page.$('#next')) await page.click('#next');
  await page.fill('input[name=name]', '테스트 학생');
  await page.fill('input[name=email]', 'student@example.com');
  await page.fill('input[name=phone]', '010-1234-5678');
  await page.check(`input[name=under14][value=${under14 ? 'yes' : 'no'}]`);
  if (optional) await page.fill('input[name=current]', '토익스피킹 130');
  await page.click('form .btn.primary');
  await page.waitForSelector('input[name=c_required]');
  await page.check('input[name=c_required]');
  await page.check('input[name=c_overseas]');
  if (optional) await page.check('input[name=c_optional]');
  if (under14) {
    await page.fill('input[name=g_name]', '테스트 보호자');
    await page.fill('input[name=g_relation]', '어머니');
    await page.fill('input[name=g_phone]', '010-9876-5432');
    await page.check('input[name=c_guardian]');
  }
  await page.click('#ok');
  await page.waitForSelector('#sets');
}
module.exports = { onboard };
