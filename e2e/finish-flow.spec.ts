import { expect, test, type Page } from '@playwright/test';

/**
 * 終結之後畫面照常推進（回歸測試）：在練習場、標準戰鬥盤、雙層戰鬥盤用展示模式開打，
 * 把 CPU 的爆裂值灌滿 → 終結 → 影格數持續增加、終結大字收起、進入下一戰的倒數。
 * （試驗模式曾在標準戰鬥盤終結後停在終結大字，用這個測試找原因與防止再發生。）
 */

type FlowDbg = { state: string; frames: number; round: number; arena: string };
const dbg = (page: Page) => page.evaluate(() => (window as unknown as { __game: { debug(): FlowDbg } }).__game.debug());

for (const arena of ['practice', 'stadium', 'double']) {
  test(`終結之後照常進下一戰：${arena}`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => {
      errors.push(String(e));
      console.log('pageerror', e.stack ?? String(e));
    });
    await page.goto(`./?demo=1&seed=81&arena=${arena}&p=blaze&c=gale`);
    await page.waitForFunction(() => (window as any).__game?.debug().state === 'battle', null, { timeout: 60_000 });
    expect((await dbg(page)).arena).toBe(arena);
    const round = (await dbg(page)).round;
    await page.evaluate(() => ((window as any).__game.sim.tops[1].burst = 1));
    await page.waitForFunction(() => (window as any).__game.debug().state === 'roundEnd', null, { timeout: 10_000 });
    // 終結後每秒記一次影格數：畫面要一直在推進
    const samples: number[] = [];
    for (let i = 0; i < 6; i++) {
      samples.push((await dbg(page)).frames);
      await page.waitForTimeout(1000);
    }
    console.log(`${arena} 終結後的影格數：${samples.join(', ')}`);
    expect(samples[samples.length - 1]).toBeGreaterThan(samples[0]);
    // 進下一戰（展示模式自動）：回合數增加、回到倒數
    await expect.poll(async () => (await dbg(page)).round, { timeout: 60_000 }).toBeGreaterThan(round);
    expect(errors).toEqual([]);
  });
}
