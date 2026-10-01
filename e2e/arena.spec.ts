import { expect, test, type Page } from '@playwright/test';

/**
 * 場地與名鑑：
 * 1. 組隊畫面有 20 格陀螺、詳細資料（雷達圖）；切換場地會換掉場館外觀，重新整理後仍記得。
 * 2. 五個特殊場地各跑一段展示對戰並截圖；火山的熔岩會噴發（場地機關事件）；
 *    雙層戰鬥盤把模擬時間撥到中央降下的時段，確認凹槽出現（升降狀態 level = 1）再截圖。
 */

type ArenaDbg = { state: string; arena: string; arenaChoice: string; counters: { hazards: number; clashes: number }; lift: { level: number; warn: number } };
const dbg = (page: Page) => page.evaluate(() => (window as unknown as { __game: { debug(): ArenaDbg } }).__game.debug());

test('組隊畫面：20 顆名鑑、雷達圖、切換場地並記住', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('./?seed=61');
  await page.locator('#title .to-cpu').click();
  await expect(page.locator('#select .card')).toHaveCount(20);
  await expect(page.locator('#select .arena button')).toHaveCount(7);
  await expect(page.locator('#select .arena button.on')).toHaveAttribute('data-id', 'practice');

  // 滑到某一格：詳細資料換成那一顆（左旋標示、原型說明）
  await page.locator('#select .card[data-id="ldrago"]').hover();
  await expect(page.locator('#select .detail .d-zh')).toHaveText('雷皇龍');
  await expect(page.locator('#select .detail .d-meta')).toContainText('左旋');
  await expect(page.locator('#select .detail .d-meta')).toContainText('L-Drago');
  await expect(page.locator('#select .detail .radar .val')).toBeVisible();

  // 點火山：場館換成火山並顯示說明；鍵盤 E 切到下一個（冰川）
  await page.locator('#select .arena button[data-id="volcano"]').click();
  expect((await dbg(page)).arena).toBe('volcano');
  await expect(page.locator('#select .arena-desc')).toContainText('熔岩');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'e2e/screenshots/60-select-volcano.png' });
  await page.keyboard.press('e');
  expect((await dbg(page)).arena).toBe('glacier');

  await page.reload();
  await page.locator('#title .to-cpu').click();
  await expect(page.locator('#select .arena button.on')).toHaveAttribute('data-id', 'glacier');
  expect(errors).toEqual([]);
});

/** 截圖檔名：61 標準戰鬥盤、61b 雙層戰鬥盤、62 火山、63 冰川、64 積水 */
const SHOT: Record<string, string> = { stadium: '61', double: '61b', volcano: '62', glacier: '63', flooded: '64' };

for (const arena of ['stadium', 'double', 'volcano', 'glacier', 'flooded']) {
  test(`展示對戰：${arena}`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`./?demo=1&seed=71&arena=${arena}&p=pegasus&c=draciel`);
    await page.waitForFunction(() => (window as any).__game?.debug().state === 'battle', null, { timeout: 60_000 });
    expect((await dbg(page)).arena).toBe(arena);
    // 火山：熔岩每 5.5 秒噴發一次，對戰中一定看得到
    if (arena === 'volcano') {
      await page.waitForFunction(() => (window as any).__game.debug().counters.hazards > 0, null, { timeout: 60_000 });
    } else if (arena === 'double') {
      // 開場是升起的（等發射的大字消失後先拍一張）；再把模擬時間撥到降下的時段（升起 7 秒＋下降 0.8 秒之後），中央變成凹槽
      expect((await dbg(page)).lift.level).toBe(0);
      await page.waitForTimeout(2500);
      await page.screenshot({ path: 'e2e/screenshots/61c-arena-double-raised.png' });
      await page.evaluate(() => ((window as any).__game.sim.time = 9));
      await page.waitForFunction(() => (window as any).__game.debug().lift.level === 1, null, { timeout: 10_000 });
      await page.waitForTimeout(1000);
    } else {
      await page.waitForTimeout(3000);
    }
    // 等到全景鏡頭再截圖（撞擊特寫的閃光會蓋住場地）
    await page.waitForFunction(() => (window as any).__game.debug().director.mode === 'overview', null, { timeout: 30_000 });
    await page.screenshot({ path: `e2e/screenshots/${SHOT[arena]}-arena-${arena}.png` });
    expect(errors).toEqual([]);
  });
}
