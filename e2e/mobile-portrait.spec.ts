import { devices, expect, test } from '@playwright/test';
import { dbg, expectInViewport, expectNoHorizontalScroll } from './mobile.helpers';

/** 手機直向（Pixel 7 模擬）：提示橫向、視角補償、版面不超出畫面 */
test.use({ ...devices['Pixel 7'] });

test('直向手機：提示橫向遊玩、選角與 HUD 不超出、場地視角加寬', async ({ page }) => {
  await page.goto('./?seed=22');
  await expect(page.locator('.rotate-hint')).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/32-portrait-title.png' });
  await page.tap('#title');
  await expect(page.locator('#select')).toBeVisible();
  await expectInViewport(page, '.card');
  await expectNoHorizontalScroll(page);
  // 第一張是預設選取，點它會直接決定；這裡點第三張走「選取 → 決定」流程
  const card = page.locator('.card').nth(2);
  await card.tap();
  await card.tap();
  await page.locator('#banner .bn', { hasText: 'ゴー' }).waitFor({ timeout: 15_000 });
  await page.touchscreen.tap(200, 300);
  await page.waitForFunction(() => (window as any).__game.debug().state === 'battle', null, { timeout: 10_000 });
  await expectInViewport(page, '.panel');
  await expectInViewport(page, '#touch .special-btn');
  // 全景鏡頭時 FOV 應被加大（16:9 設計值 50°）
  await page.waitForFunction(() => (window as any).__game.debug().director.mode === 'overview');
  await page.waitForTimeout(1500);
  expect((await dbg(page)).fov).toBeGreaterThan(70);
  await page.screenshot({ path: 'e2e/screenshots/33-portrait-battle.png' });
});
