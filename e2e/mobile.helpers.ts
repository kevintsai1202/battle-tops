import { expect, type Page } from '@playwright/test';

/** 遊戲除錯快照（手機測試用到的欄位） */
export type MobileDbg = {
  state: string;
  touchMode: boolean;
  fov: number;
  director: { mode: string };
  counters: { specials: number };
  stick: { x: number; y: number };
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

/** 頁面沒有水平捲動 */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw).toBeLessThanOrEqual(iw);
}
