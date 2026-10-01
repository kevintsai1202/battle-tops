import { expect, type Page } from '@playwright/test';

/**
 * 組隊（兩步）的共用操作：
 * - 第 1 步（#select）：點三顆小格（點選順序是預設的出場順序）後按「下一步」。
 * - 第 2 步（#arrange）：調整出場順序與零件，按「出陣！」（CPU）或「準備完成」（線上）。
 * tap 為 true 時用觸控點（手機測試）。
 */

/** 點一下：手機用觸控、電腦用滑鼠 */
async function press(page: Page, selector: string, tap: boolean): Promise<void> {
  if (tap) await page.locator(selector).tap();
  else await page.locator(selector).click();
}

/** 第 1 步：選三顆後按「下一步」 */
export async function pickTops(page: Page, ids: string[], tap = false): Promise<void> {
  await expect(page.locator('#select')).toBeVisible();
  for (const id of ids) await press(page, `#select .card[data-id="${id}"]`, tap);
  await press(page, '#select .go', tap);
}

/** 第 2 步：等畫面出現後按確定（CPU：出陣！；線上：準備完成） */
export async function confirmArrange(page: Page, tap = false): Promise<void> {
  await expect(page.locator('#arrange')).toBeVisible();
  await press(page, '#arrange .ar-ready', tap);
}

/** CPU 模式組隊：第 1 步選三顆 → 第 2 步不調整直接出陣 */
export async function pickTeam(page: Page, ids: string[], tap = false): Promise<void> {
  await pickTops(page, ids, tap);
  await confirmArrange(page, tap);
}

/**
 * 第 2 步換零件：按那一顆欄位上的「盤」或「軸」按鈕，在展開的零件清單裡點一件（part 為空字串 = 換回原廠），清單收起。
 */
export async function choosePart(page: Page, top: string, slot: 'disk' | 'driver', part: string, tap = false): Promise<void> {
  await press(page, `#arrange .ar-slot[data-id="${top}"] .part-btn[data-slot="${slot}"]`, tap);
  await expect(page.locator('#part-menu')).toBeVisible();
  await press(page, `#part-menu .pm-opt[data-part="${part}"]`, tap);
  await expect(page.locator('#part-menu')).toHaveCount(0);
}

/** 第 2 步目前的出場順序（欄位上的陀螺代號） */
export async function arrangeOrder(page: Page): Promise<string[]> {
  return page.locator('#arrange .ar-slot').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id ?? ''));
}
