import { expect, type Page } from '@playwright/test';

/** 遊戲除錯快照（手機測試用到的欄位） */
export type MobileDbg = {
  state: string;
  touchMode: boolean;
  fov: number;
  director: { mode: string };
  counters: { specials: number; dashes: number };
  /** 觸控滑動的推移向量與快甩次數 */
  swipe: { x: number; y: number };
  flicks: number;
  tops: { control: { x: number; z: number } }[];
};

export const dbg = (page: Page) => page.evaluate(() => (window as unknown as { __game: { debug(): MobileDbg } }).__game.debug());

/** 確認元素整個落在可視範圍內（沒有被裁掉） */
export async function expectInViewport(page: Page, selector: string): Promise<void> {
  const vp = page.viewportSize()!;
  for (const box of await page.locator(selector).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
    expect(box.left, `${selector} 左側超出`).toBeGreaterThanOrEqual(-1);
    expect(box.top, `${selector} 上方超出`).toBeGreaterThanOrEqual(-1);
    expect(box.right, `${selector} 右側超出`).toBeLessThanOrEqual(vp.width + 1);
    expect(box.bottom, `${selector} 下方超出`).toBeLessThanOrEqual(vp.height + 1);
  }
}

/**
 * 用真實觸控事件（CDP）在畫面上滑一下：從 from 滑到 to，分 steps 步、每步間隔 stepMs 毫秒。
 * 用來拉發射台：往下滑 = 拉條。
 */
export async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 6, stepMs = 12): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y, id: 7 }] });
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, id: 7 }] });
    await page.waitForTimeout(stepMs);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** 頁面沒有水平捲動 */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw).toBeLessThanOrEqual(iw);
}
