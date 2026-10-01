import { devices, expect, test } from '@playwright/test';
import { dbg, expectInViewport, expectNoHorizontalScroll, swipe } from './mobile.helpers';
import { pickTops } from './team.helpers';

/** 手機直向（Pixel 7 模擬）：提示橫向、視角補償、版面不超出畫面 */
test.use({ ...devices['Pixel 7'] });

test('直向手機：提示橫向遊玩、組隊與 HUD 不超出、場地視角加寬', async ({ page }) => {
  await page.goto('./?seed=22');
  await expect(page.locator('.rotate-hint')).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/32-portrait-title.png' });
  // 點「點擊開始」的字開始 CPU 對戰：直向畫面中央現在是線上對戰按鈕（標題加了操作教學的入口），點中央會進線上房間
  await page.locator('#title .to-cpu').tap();
  await expect(page.locator('#select')).toBeVisible();
  await expectInViewport(page, '#select .cards');
  await expectInViewport(page, '#select .detail');
  await expectInViewport(page, '#select .go');
  await expectNoHorizontalScroll(page);
  await pickTops(page, ['gale', 'blaze', 'wolf'], true);
  await expect(page.locator('#arrange')).toBeVisible();
  await expectInViewport(page, '#arrange .ar-ready');
  await expectNoHorizontalScroll(page);
  await page.locator('#arrange .ar-ready').tap();
  await page.locator('#banner .bn', { hasText: /^1$/ }).waitFor({ timeout: 45_000 });
  await swipe(page, { x: 200, y: 250 }, { x: 170, y: 650 });
  await page.waitForFunction(() => (window as any).__game.debug().state === 'battle', null, { timeout: 10_000 });
  await expectInViewport(page, '.panel');
  await expectInViewport(page, '#touch-hint');
  // 必殺集滿時右下角的必殺按鈕在畫面內，不蓋到下方的觸控提示
  await page.evaluate(() => ((window as any).__game.sim.tops[0].special = 1));
  await expect(page.locator('#special-btn')).toBeVisible();
  await expectInViewport(page, '#special-btn');
  const btn = (await page.locator('#special-btn').boundingBox())!;
  const tip = (await page.locator('#touch-hint').boundingBox())!;
  expect(btn.y + btn.height <= tip.y || tip.x + tip.width <= btn.x, '必殺按鈕蓋到觸控提示').toBe(true);
  // 全景鏡頭時 FOV 應被加大（16:9 設計值 50°）
  await page.waitForFunction(() => (window as any).__game.debug().director.mode === 'overview');
  await page.waitForTimeout(1500);
  expect((await dbg(page)).fov).toBeGreaterThan(70);
  await page.screenshot({ path: 'e2e/screenshots/33-portrait-battle.png' });
});
