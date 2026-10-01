import { devices, expect, test } from '@playwright/test';
import { dbg, expectInViewport, expectNoHorizontalScroll, swipe } from './mobile.helpers';
import { pickTops } from './team.helpers';

/** 手機直向（Pixel 7 模擬）：提示橫向、視角補償、版面不超出畫面 */
test.use({ ...devices['Pixel 7'] });

test('直向手機：提示橫向遊玩、組隊與 HUD 不超出、場地視角加寬', async ({ page }) => {
  await page.goto('./?seed=22');
  await expect(page.locator('.rotate-hint')).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/32-portrait-title.png' });
  await page.tap('#title');
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
  // 全景鏡頭時 FOV 應被加大（16:9 設計值 50°）
  await page.waitForFunction(() => (window as any).__game.debug().director.mode === 'overview');
  await page.waitForTimeout(1500);
  expect((await dbg(page)).fov).toBeGreaterThan(70);
  await page.screenshot({ path: 'e2e/screenshots/33-portrait-battle.png' });
});
