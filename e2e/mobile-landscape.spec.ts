import { devices, expect, test } from '@playwright/test';
import { dbg, expectInViewport, expectNoHorizontalScroll } from './mobile.helpers';

/**
 * 手機橫向（Pixel 7 模擬、觸控）：點選流程、虛擬搖桿、必殺按鈕、版面不超出畫面。
 * 搖桿用 CDP 送真實觸控事件（touchStart → touchMove），走瀏覽器原生的 touch → pointer 路徑。
 */
test.use({ ...devices['Pixel 7 landscape'] });

test('橫向手機：觸控組隊、點擊發射、搖桿推移、必殺按鈕', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('./?seed=21');
  await page.tap('#title');
  await expect(page.locator('#select')).toBeVisible();
  expect((await dbg(page)).touchMode).toBe(true);
  await expect(page.locator('#select .tc')).toBeVisible();
  await expectInViewport(page, '.card');
  await expectInViewport(page, '.cpu-team');
  await expectInViewport(page, '#select .go');
  await expectNoHorizontalScroll(page);

  // 觸控組隊：點三張卡（點選順序 = 出場順序），再按出陣
  for (const i of [1, 2, 0]) await page.locator('.card').nth(i).tap();
  await expect(page.locator('.card .badge')).toHaveText(['3', '1', '2', '']);
  await page.screenshot({ path: 'e2e/screenshots/30-mobile-select.png' });
  await page.locator('#select .go').tap();
  await expect(page.locator('#select')).toBeHidden();
  await expect(page.locator('#touch')).toBeVisible();

  // 在「ゴー」出現時點畫面發射
  await page.locator('#banner .bn', { hasText: 'ゴー' }).waitFor({ timeout: 45_000 });
  await page.touchscreen.tap(430, 120);
  await page.waitForFunction(() => (window as any).__game.debug().state === 'battle', null, { timeout: 10_000 });
  await expectInViewport(page, '.panel');
  await expectInViewport(page, '#touch .stick');
  await expectInViewport(page, '#touch .special-btn');

  // 必殺按鈕：量表灌滿 → 按鈕亮起 → 點擊發動
  await page.evaluate(() => ((window as any).__game.sim.tops[0].special = 1));
  await expect(page.locator('#touch .special-btn')).toHaveClass(/ready/);
  // 按鈕就緒時有脈動動畫，locator.tap() 會一直等它「靜止」，改用 force 直接點
  await page.locator('#touch .special-btn').tap({ force: true });
  await expect.poll(async () => (await dbg(page)).counters.specials).toBeGreaterThan(0);
  await expect(page.locator('#touch .special-btn')).toHaveClass(/used/);
  // 搖桿：按住中心往上推 → 搖桿向量往前，玩家陀螺收到推移
  const stick = await page.locator('#touch .stick').boundingBox();
  const cx = stick!.x + stick!.width / 2;
  const cy = stick!.y + stick!.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - 55, id: 1 }] });
  await page.waitForTimeout(250);
  const held = await dbg(page);
  expect(held.stick.y).toBeGreaterThan(0.6);
  const c = held.tops[0].control;
  expect(Math.hypot(c.x, c.z)).toBeGreaterThan(0.5);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(200);
  expect((await dbg(page)).stick).toEqual({ x: 0, y: 0 });
  await page.screenshot({ path: 'e2e/screenshots/31-mobile-battle.png' });

  expect(errors).toEqual([]);
});
