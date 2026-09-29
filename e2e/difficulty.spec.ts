import { expect, test } from '@playwright/test';

/**
 * 難度：組隊畫面切換、瀏覽器記住選擇、實際影響 CPU 發射力道；
 * 另外檢查滑鼠點過卡片後再按 Space 只會觸發一次（按鈕焦點不會造成重複觸發）。
 */
type Dbg = { state: string; difficulty: string; launch: { ratio: number; cpu: number } };
const dbg = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as { __game: { debug(): Dbg } }).__game.debug());

test('難度：預設普通、切到簡單後生效並記住', async ({ page }) => {
  await page.goto('./?seed=41');
  await page.evaluate(() => localStorage.removeItem('battle-tops.difficulty'));
  await page.reload();
  await page.locator('#title').click();
  await expect(page.locator('.difficulty button.on')).toHaveAttribute('data-id', 'normal');

  // 鍵盤 3 → 困難，再用滑鼠點簡單
  await page.keyboard.press('3');
  await expect(page.locator('.difficulty button.on')).toHaveAttribute('data-id', 'hard');
  await page.locator('.difficulty button[data-id="easy"]').click();
  await expect(page.locator('.difficulty button.on')).toHaveAttribute('data-id', 'easy');
  expect((await dbg(page)).difficulty).toBe('easy');

  // 點卡片後按 Enter／Space：只切換一次（按鈕焦點不會讓它觸發兩次而互相抵消）
  const badge = page.locator('.card .badge').first();
  await page.locator('.card').first().click();
  await expect(badge).toHaveText('1');
  await page.keyboard.press('Enter');
  await expect(badge).toHaveText('');
  await page.keyboard.press('Space');
  await expect(badge).toHaveText('1');

  for (const i of [1, 2]) await page.locator('.card').nth(i).click();
  await page.locator('#select .go').click();
  await page.locator('#banner .bn', { hasText: 'ゴー' }).waitFor({ timeout: 45_000 });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => (window as any).__game.debug().state === 'battle', null, { timeout: 15_000 });
  const d = await dbg(page);
  // 簡單：CPU 發射力道 0.6～0.8、玩家最低力道 0.8
  expect(d.launch.cpu).toBeGreaterThanOrEqual(0.6);
  expect(d.launch.cpu).toBeLessThanOrEqual(0.8);
  expect(d.launch.ratio).toBeGreaterThanOrEqual(0.8);

  // 重新整理後仍是簡單
  await page.reload();
  await page.locator('#title').click();
  await expect(page.locator('.difficulty button.on')).toHaveAttribute('data-id', 'easy');
});
