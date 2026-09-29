import { test, type Page } from '@playwright/test';

/**
 * 停轉倒下與出場飛出兩種終結動畫的畫面（爆裂在 battle.spec.ts 已截圖）。
 * 瀏覽器裡的對戰受影格時間影響不完全可重現，所以等到想要的終結方式出現為止（最多 8 回合）。
 */

type Dbg = { counters: { finishes: number }; lastFinish: string | null; round: number };
const dbg = (page: Page) => page.evaluate(() => (window as unknown as { __game: { debug(): Dbg } }).__game.debug());

/**
 * 在展示模式等到指定的終結方式出現（每回合都可能不同，最多等幾回合），
 * 讓終結動畫播一小段後暫停截圖。
 */
async function shootFinish(page: Page, url: string, want: string, file: string): Promise<void> {
  await page.goto(url);
  let seen = 0;
  for (let i = 0; i < 8; i++) {
    await page.waitForFunction((n) => (window as any).__game.debug().counters.finishes > n, seen, { timeout: 150_000, polling: 250 });
    const d = await dbg(page);
    seen = d.counters.finishes;
    console.log(`第 ${d.round} 回合終結：${d.lastFinish}`);
    if (d.lastFinish === want) {
      await page.waitForTimeout(1200);
      await page.evaluate(() => ((window as any).__game.paused = true));
      await page.screenshot({ path: file });
      await page.evaluate(() => ((window as any).__game.paused = false));
      return;
    }
  }
  throw new Error(`等了 8 回合都沒有出現 ${want} 終結`);
}

test('停轉倒下動畫（防禦 vs 持久，幾乎都是停轉）', async ({ page }) => {
  test.setTimeout(600_000);
  await shootFinish(page, './?demo=1&seed=11&p=defense&c=stamina', 'spin', 'e2e/screenshots/21-spin-finish.png');
});

test('出場飛出動畫（攻擊 vs 防禦，約四成出場）', async ({ page }) => {
  test.setTimeout(900_000);
  await shootFinish(page, './?demo=1&seed=12&p=attack&c=defense', 'over', 'e2e/screenshots/22-over-finish.png');
});
