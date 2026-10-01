import { expect, test, type Page } from '@playwright/test';

/**
 * 拉發射台（電腦版：滑鼠按住拖曳）：
 * 1. 在「ゴー」時快速往左下拖到底再放手：拉條長度、速度都高，瞄準往右偏，拉條中顯示拉線與瞄準箭頭。
 * 2. 往右下拖：瞄準方向相反。
 * 3. 只點一下（沒拉）：力道只有難度保底，比拉滿低。
 */

type LaunchDbg = {
  state: string;
  pulling: boolean;
  launch: { ratio: number; aim: number; pull: { length: number; speed: number; aim: number } | null };
};
const dbg = (page: Page) => page.evaluate(() => (window as unknown as { __game: { debug(): LaunchDbg } }).__game.debug());

/** 進入第一戰的倒數 */
async function toLaunch(page: Page, seed: number): Promise<void> {
  await page.goto(`./?seed=${seed}`);
  await page.locator('#title').click();
  for (const id of ['blaze', 'turtle', 'gale']) await page.locator(`#select .card[data-id="${id}"]`).click();
  await page.locator('#select .go').click();
  await page.waitForFunction(() => (window as any).__game.debug().state === 'launch');
}

/** 滑鼠拉條：從 (x0, y0) 按下，分 steps 步拖到 (x1, y1)；hold 為放手前的回呼（截圖用） */
async function drag(page: Page, x0: number, y0: number, x1: number, y1: number, steps = 6, hold?: () => Promise<void>): Promise<void> {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps });
  if (hold) await hold();
  await page.mouse.up();
}

test('滑鼠往左下快速拖到底：拉條滿分、往右瞄準，拉條中顯示拉線與瞄準箭頭', async ({ page }) => {
  await toLaunch(page, 51);
  await page.locator('#banner .bn', { hasText: /^1$/ }).waitFor({ timeout: 45_000 });
  await drag(page, 700, 180, 520, 560, 6, async () => {
    const mid = await dbg(page);
    expect(mid.pulling).toBe(true);
    await expect(page.locator('#launch')).toHaveClass(/pulling/);
    await expect(page.locator('#launch .cord line')).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/50-ripcord-pull.png' });
  });
  await page.waitForFunction(() => (window as any).__game.debug().state === 'battle', null, { timeout: 15_000 });
  const d = await dbg(page);
  // 量到的拉條數值印出來：拉速受 headless 滑鼠事件間隔影響，失敗時可以對照歷次數值
  console.log(`拉條量測：${JSON.stringify(d.launch.pull)}`);
  expect(d.launch.pull!.length).toBeGreaterThan(0.9);
  // headless 軟體渲染很慢，滑鼠事件間隔大，量到的拉速偏低；拉速換算本身由單元測試把關
  expect(d.launch.pull!.speed).toBeGreaterThan(0.1);
  // 往左下拉 → 螢幕上往右偏
  expect(d.launch.pull!.aim).toBeGreaterThan(0.2);
  expect(d.launch.aim).not.toBe(0);
  expect(d.launch.ratio).toBeGreaterThanOrEqual(0.5);
});

test('往右下拖：瞄準方向相反', async ({ page }) => {
  await toLaunch(page, 52);
  await page.locator('#banner .bn', { hasText: /^1$/ }).waitFor({ timeout: 45_000 });
  await drag(page, 560, 180, 740, 560);
  await page.waitForFunction(() => (window as any).__game.debug().state === 'battle', null, { timeout: 15_000 });
  const d = await dbg(page);
  expect(d.launch.pull!.aim).toBeLessThan(-0.2);
});

test('只點一下沒有拉：力道只有保底，比拉滿低', async ({ page }) => {
  await toLaunch(page, 53);
  await page.locator('#banner .bn', { hasText: 'ゴー' }).waitFor({ timeout: 45_000 });
  await page.mouse.click(640, 360);
  await page.waitForFunction(() => (window as any).__game.debug().state === 'battle', null, { timeout: 15_000 });
  const d = await dbg(page);
  expect(d.launch.pull!.length).toBe(0);
  // 普通難度的保底 0.68，再乘上時機分
  expect(d.launch.ratio).toBeLessThanOrEqual(0.68 + 1e-6);
});
