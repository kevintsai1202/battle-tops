import { expect, test } from '@playwright/test';

/**
 * 網路慢（例如 GitHub Pages 第一次載入）時，語音檔還在下載，
 * 點擊開始後選角畫面仍要立刻出現，不能卡在空白畫面等語音。
 */
test('語音檔下載很慢時，點擊開始後選角畫面立刻出現', async ({ page }) => {
  // 每個語音檔延遲 4 秒回應
  await page.route('**/voice/*.mp3', async (route) => {
    await new Promise((r) => setTimeout(r, 4000));
    await route.continue();
  });
  await page.goto('./?seed=9');
  await page.locator('#title').click();
  await expect(page.locator('#select')).toBeVisible({ timeout: 2000 });
  // 語音最後仍會載入完成
  await page.waitForFunction(() => !!(window as any).__game && (window as any).__game.debug().voice.mode === 'fish-files', null, { timeout: 30_000 });
});
