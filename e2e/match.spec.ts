import { expect, test } from '@playwright/test';

/**
 * 3 對 3 賽制：
 * 1. 展示模式打完整一場：至少三戰分出勝負、總分等於各戰得分加總、結果畫面列出每一戰。
 * 2. 延長賽畫面：總分平手時從自己的隊伍挑一顆出戰（用除錯鉤子直接進入平手狀態）。
 */

type MatchDbg = {
  state: string;
  score: [number, number];
  match: { phase: string; battle: number | null; overtime: boolean; results: number; winner: number | null; player: string[]; cpu: string[]; points: [number, number][] } | null;
};
const dbg = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as { __game: { debug(): MatchDbg } }).__game.debug());

test('展示模式：3 對 3 打完整一場，結果畫面列出每一戰', async ({ page }) => {
  test.setTimeout(900_000);
  await page.goto('./?demo=1&seed=31');
  // 結果畫面一出現就暫停（展示模式 4 秒後會自動開新局）
  await page.waitForFunction(
    () => {
      const g = (window as any).__game;
      if (!g || g.debug().state !== 'result') return false;
      g.paused = true;
      return true;
    },
    null,
    { timeout: 840_000, polling: 250 },
  );
  const d = await dbg(page);
  const m = d.match!;
  expect(m.phase).toBe('done');
  expect(m.results).toBeGreaterThanOrEqual(3);
  expect(new Set(m.player).size).toBe(3);
  expect(new Set(m.cpu).size).toBe(3);
  const sum = m.points.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]);
  expect(d.score).toEqual(sum);
  expect(m.winner === 0 ? d.score[0] >= d.score[1] : d.score[1] >= d.score[0]).toBe(true);
  await expect(page.locator('#result .breakdown li')).toHaveCount(m.results);
  await page.screenshot({ path: 'e2e/screenshots/40-match-result.png' });
});

test('延長賽：總分平手時從自己的隊伍挑一顆出戰', async ({ page }) => {
  await page.goto('./?seed=33');
  await page.locator('#title').click();
  await expect(page.locator('#select')).toBeVisible();
  for (const id of ['wolf', 'blaze', 'turtle']) await page.locator(`#select .card[data-id="${id}"]`).click();
  await page.locator('#select .go').click();
  await page.waitForFunction(() => (window as any).__game.debug().state === 'launch');

  await page.evaluate(() => (window as any).__game.debugForceOvertime());
  await expect(page.locator('#overtime')).toBeVisible();
  await expect(page.locator('#overtime .card')).toHaveCount(3);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'e2e/screenshots/41-overtime-pick.png' });

  // 挑第二顆（隊伍順序 [星河狼, 烈焰龍, 鐵壁龜] 的烈焰龍）
  await page.locator('#overtime .card').nth(1).click();
  await page.waitForFunction(() => (window as any).__game.debug().state === 'launch');
  const d = await dbg(page);
  expect(d.match!.overtime).toBe(true);
  expect(d.match!.phase).toBe('overtime');
  await expect(page.locator('#hud .info')).toHaveText('延長賽・練習場');
  await expect(page.locator('.panel[data-side="0"] .name')).toContainText('ブレイズ・ドラゴン');
});
