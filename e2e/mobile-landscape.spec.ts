import { devices, expect, test } from '@playwright/test';
import { dbg, expectInViewport, expectNoHorizontalScroll, swipe } from './mobile.helpers';
import { arrangeOrder } from './team.helpers';

/**
 * 手機橫向（Pixel 7 模擬、觸控）：點選流程、滑動拉發射台、三指觸控必殺（三指放下時陀螺不會被推動）、
 * 必殺集滿時的必殺按鈕（點一下發動、不會帶動推移）、滑動推移、快甩衝刺、版面不超出畫面。
 * 觸控用 CDP 送真實觸控事件（touchStart → touchMove → touchEnd），走瀏覽器原生的 touch → pointer 路徑。
 */
test.use({ ...devices['Pixel 7 landscape'] });

test('橫向手機：觸控組隊、拉條發射、三指必殺、滑動推移、快甩衝刺', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('./?seed=21');
  await page.tap('#title');
  await expect(page.locator('#select')).toBeVisible();
  expect((await dbg(page)).touchMode).toBe(true);
  await expect(page.locator('#select .tc')).toBeVisible();
  // 名鑑 20 格在可捲動的格狀區內：區塊本身、詳細資料、場地與出陣按鈕都要在畫面內
  await expectInViewport(page, '#select .cards');
  await expectInViewport(page, '#select .detail');
  await expectInViewport(page, '#select .arena');
  await expectInViewport(page, '.cpu-team');
  await expectInViewport(page, '#select .go');
  await expectNoHorizontalScroll(page);

  // 觸控組隊：點三格（點選順序 = 出場順序），再按出陣
  for (const id of ['turtle', 'gale', 'blaze']) await page.locator(`#select .card[data-id="${id}"]`).tap();
  await expect(page.locator('#select .card .badge')).toHaveText(['3', '1', '2', ...Array(17).fill('')]);
  await page.screenshot({ path: 'e2e/screenshots/30-mobile-select.png' });
  await page.locator('#select .go').tap();
  await expect(page.locator('#select')).toBeHidden();
  // 第 2 步：版面在畫面內；點 ▲ 把烈焰龍（第 3 戰）往前一戰，再出陣
  await expect(page.locator('#arrange')).toBeVisible();
  for (const sel of ['#arrange .ar-slots', '#arrange .ar-ready', '#arrange .detail']) await expectInViewport(page, sel);
  await expectNoHorizontalScroll(page);
  await page.locator('#arrange .ar-slot[data-id="blaze"] .ar-up').tap();
  expect(await arrangeOrder(page)).toEqual(['turtle', 'blaze', 'gale']);
  await page.screenshot({ path: 'e2e/screenshots/30b-mobile-arrange.png' });
  await page.locator('#arrange .ar-ready').tap();
  await expect(page.locator('#arrange')).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { __game: { debug(): { match: { player: string[] } } } }).__game.debug().match.player)).toEqual(['turtle', 'blaze', 'gale']);
  // 發射階段不啟用滑動操作（手指要拉發射台）
  await expect(page.locator('#launch')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('#touch-hint')).toBeHidden();

  // 倒數到「2」時手指往下滑（拉條），放手後等到「ゴー」發射。
  // headless 的 CDP 觸控很慢（機器忙時一個觸控事件要將近 1 秒），步數少、提早開始，才不會被「ゴー」後 0.6 秒的自動放手截斷
  await page.locator('#banner .bn', { hasText: /^2$/ }).waitFor({ timeout: 45_000 });
  await swipe(page, { x: 430, y: 90 }, { x: 430, y: 330 }, 2);
  await page.waitForFunction(() => (window as any).__game.debug().state === 'battle', null, { timeout: 10_000 });
  const launched = await page.evaluate(() => (window as any).__game.debug().launch);
  expect(launched.pull.length).toBeGreaterThan(0.9);
  // 拉速受 CDP 事件間隔影響（headless 很慢），只確認有量到
  expect(launched.pull.speed).toBeGreaterThan(0);
  // 對戰中：畫面下方顯示觸控提示，不再有搖桿與必殺按鈕
  await expect(page.locator('#touch-hint')).toBeVisible();
  await expect(page.locator('#touch')).toHaveCount(0);
  await expectInViewport(page, '.panel');
  await expectInViewport(page, '#touch-hint');

  // 必殺集滿前沒有必殺按鈕
  await expect(page.locator('#special-btn')).toBeHidden();
  // 三指觸控必殺（放在剛開打時，避免回合先結束）：量表灌滿 → 提示變成 READY、右下角出現必殺按鈕 →
  // 三根手指陸續按下（第一指先滑一點）：發動必殺，而且陀螺沒有被先落下的手指推動
  await page.evaluate(() => ((window as any).__game.sim.tops[0].special = 1));
  await expect(page.locator('#touch-hint')).toHaveClass(/ready/);
  await expect(page.locator('#special-btn')).toBeVisible();
  await expectInViewport(page, '#special-btn');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 200, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 340, y: 205, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: 340, y: 205, id: 1 },
      { x: 450, y: 220, id: 2 },
      { x: 600, y: 200, id: 3 },
    ],
  });
  await expect.poll(async () => (await dbg(page)).counters.specials).toBeGreaterThan(0);
  // 三指按著時不推移（推移向量、玩家陀螺的推移都是 0），浮動原點的圓圈也收起
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: 380, y: 160, id: 1 },
      { x: 450, y: 220, id: 2 },
      { x: 600, y: 200, id: 3 },
    ],
  });
  const held3 = await dbg(page);
  expect(held3.swipe).toEqual({ x: 0, y: 0 });
  expect(held3.tops[0].control).toEqual({ x: 0, z: 0 });
  await expect(page.locator('#swipe')).toBeHidden();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('#touch-hint')).not.toHaveClass(/ready/);
  await expect(page.locator('#special-btn')).toBeHidden();

  // 必殺按鈕：再把量表灌滿（除錯，模擬下一戰）→ 點右下角的按鈕發動；按鈕不會帶動推移
  const specials = (await dbg(page)).counters.specials;
  await page.evaluate(() => {
    const t = (window as any).__game.sim.tops[0];
    t.special = 1;
    t.specialUsed = false;
  });
  await expect(page.locator('#special-btn')).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/31a-mobile-special-button.png' });
  await page.locator('#special-btn').tap();
  await expect.poll(async () => (await dbg(page)).counters.specials).toBe(specials + 1);
  await expect(page.locator('#special-btn')).toBeHidden();
  expect((await dbg(page)).swipe).toEqual({ x: 0, y: 0 });
  await expect(page.locator('#swipe')).toBeHidden();

  // 單指按住往上拖：推移向量往前，玩家陀螺收到推移；放開後歸零
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 220, id: 4 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300, y: 150, id: 4 }] });
  await page.waitForTimeout(250);
  const held = await dbg(page);
  expect(held.swipe.y).toBeGreaterThan(0.6);
  const c = held.tops[0].control;
  expect(Math.hypot(c.x, c.z)).toBeGreaterThan(0.5);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(200);
  expect((await dbg(page)).swipe).toEqual({ x: 0, y: 0 });

  // 快甩：快速往右甩一下 → 衝刺。
  // CDP 觸控在 headless 一個事件要將近 1 秒，做不出真的「快甩」；改在頁面內連續送出觸控類型的 pointer 事件，
  // 走的是同一組監聽器（快甩的時間判定另有單元測試）。原生 touch → pointer 路徑由上面的三指與拖曳驗過。
  const dashes = (await dbg(page)).counters.dashes;
  await page.evaluate(() => {
    const fire = (type: string, x: number) =>
      window.dispatchEvent(new PointerEvent(type, { pointerId: 99, pointerType: 'touch', clientX: x, clientY: 260, bubbles: true }));
    fire('pointerdown', 350);
    fire('pointermove', 480);
    fire('pointermove', 610);
    fire('pointerup', 610);
  });
  await expect.poll(async () => (await dbg(page)).counters.dashes).toBeGreaterThan(dashes);
  await page.screenshot({ path: 'e2e/screenshots/31-mobile-battle.png' });

  expect(errors).toEqual([]);
});
