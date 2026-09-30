import { devices, expect, test, type Page } from '@playwright/test';
import { expectInViewport, expectNoHorizontalScroll } from './mobile.helpers';

/**
 * 組隊畫面：陀螺 3D 縮圖、外觀與絕招示範、可替換零件（盤、軸）與雷達圖即時更新、備用零件每種一件。
 * 桌機跑完整流程；手機橫向與直向只檢查版面與示範有在動，並截圖。
 */

type SelectDbg = {
  state: string;
  showcase: { loops: number; fires: number } | null;
  loadouts: Record<string, { disk: string | null; driver: string | null }>;
  playerStats: Record<string, number>;
};
/** 手機裝置設定（去掉 defaultBrowserType 才能在 describe 裡用 test.use） */
const phone = (name: string) => {
  const { defaultBrowserType: _, ...rest } = devices[name];
  return rest;
};

const dbg = (page: Page) => page.evaluate(() => (window as unknown as { __game: { debug(): SelectDbg } }).__game.debug());

/** 詳細資料的雷達圖目前的多邊形座標 */
const radarPoints = (page: Page) => page.locator('#select .detail .radar .val').getAttribute('points');

test('組隊畫面：縮圖、絕招示範、換零件後雷達圖與數值立刻更新，備用零件同隊不能重複', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('./?seed=31');
  await page.click('#title');
  await expect(page.locator('#select')).toBeVisible();

  // 20 格都換上 3D 縮圖（dataURL）
  await expect(page.locator('#select .card.tile img.thumb:not([hidden])')).toHaveCount(20, { timeout: 30_000 });
  const src = await page.locator('#select .card.tile img.thumb').first().getAttribute('src');
  expect(src?.startsWith('data:image/png')).toBe(true);

  // 絕招示範：舞台窗有畫布，會放出必殺並閃出招式名
  await expect(page.locator('#select .detail .d-canvas')).toBeVisible();
  await expect.poll(async () => (await dbg(page)).showcase?.fires ?? 0, { timeout: 20_000 }).toBeGreaterThan(0);
  await page.screenshot({ path: 'e2e/screenshots/70-select-showcase.png' });

  // 沒選進隊伍的陀螺不能換零件
  await page.locator('#select .card[data-id="pegasus"]').hover();
  await expect(page.locator('#select .detail .d-zh')).toHaveText('暴嵐天駒');
  await expect(page.locator('#select .detail select[data-slot="driver"]')).toBeDisabled();

  // 選進隊伍後可以換軸：雷達圖與數值立刻變，並出現原廠輪廓與增減標示
  await page.locator('#select .card[data-id="pegasus"]').click();
  await page.locator('#select .card[data-id="pegasus"]').hover();
  const driver = page.locator('#select .detail select[data-slot="driver"]');
  await expect(driver).toBeEnabled();
  const before = await radarPoints(page);
  await driver.selectOption('bearing');
  await expect.poll(() => radarPoints(page)).not.toBe(before);
  await expect(page.locator('#select .detail .radar .ghost')).toBeVisible();
  await expect(page.locator('#select .detail .d-stats small.up').first()).toBeVisible();
  await expect(page.locator('#select .detail .d-stats small.down').first()).toBeVisible();
  // 換盤
  await page.locator('#select .detail select[data-slot="disk"]').selectOption('heavy');
  await expect(page.locator('#select .detail .d-stats li', { hasText: '重量' }).locator('small.up')).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/71-select-parts.png' });

  // 備用零件每種一件：隊友的軸承軸選項被停用並標出裝在誰身上
  await page.locator('#select .card[data-id="blaze"]').click();
  await page.locator('#select .card[data-id="blaze"]').hover();
  const taken = page.locator('#select .detail select[data-slot="driver"] option[value="bearing"]');
  await expect(taken).toHaveJSProperty('disabled', true);
  await expect(taken).toContainText('暴嵐天駒');

  // 暴嵐天駒離開隊伍：零件歸還，別顆就能用
  await page.locator('#select .card[data-id="pegasus"]').click();
  await page.locator('#select .card[data-id="blaze"]').hover();
  await expect(page.locator('#select .detail select[data-slot="driver"] option[value="bearing"]')).toHaveJSProperty('disabled', false);
  await page.locator('#select .detail select[data-slot="driver"]').selectOption('bearing');

  // 湊滿三顆出陣：換上的零件帶進對戰
  await page.locator('#select .card[data-id="turtle"]').click();
  await page.locator('#select .card[data-id="gale"]').click();
  await page.locator('#select .go').click();
  await expect(page.locator('#select')).toBeHidden();
  const d = await dbg(page);
  expect(d.loadouts.blaze?.driver).toBe('bearing');
  expect(d.loadouts.pegasus).toBeUndefined();
  // 第一戰是烈焰龍（點選順序），屬性已套用軸承軸（持久比原廠高、機動比原廠低）
  expect(d.playerStats.stamina).toBeGreaterThan(3);
  expect(d.playerStats.dash).toBeLessThan(10);
  expect(d.showcase).toBeNull();
  expect(errors).toEqual([]);
});

test.describe('手機橫向', () => {
  test.use(phone('Pixel 7 landscape'));
  test('組隊畫面版面不超出、絕招示範在動、選進隊伍後可換零件', async ({ page }) => {
    await page.goto('./?seed=32');
    await page.tap('#title');
    await expect(page.locator('#select')).toBeVisible();
    await expectInViewport(page, '#select .cards');
    await expectInViewport(page, '#select .detail');
    await expectInViewport(page, '#select .go');
    await expectNoHorizontalScroll(page);
    await expect.poll(async () => (await dbg(page)).showcase?.fires ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
    await page.locator('#select .card[data-id="orion"]').tap();
    await expect(page.locator('#select .detail select[data-slot="driver"]')).toBeEnabled();
    await page.locator('#select .detail select[data-slot="driver"]').selectOption('rubber');
    await expect(page.locator('#select .detail .radar .ghost')).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/72-mobile-select-parts.png' });
  });
});

test.describe('手機直向', () => {
  test.use(phone('Pixel 7'));
  test('組隊畫面版面不超出、絕招示範在動', async ({ page }) => {
    await page.goto('./?seed=33');
    await page.tap('#title');
    await expect(page.locator('#select')).toBeVisible();
    await expectInViewport(page, '#select .cards');
    await expectInViewport(page, '#select .detail');
    await expectInViewport(page, '#select .go');
    await expectNoHorizontalScroll(page);
    await expect.poll(async () => (await dbg(page)).showcase?.fires ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
    await page.screenshot({ path: 'e2e/screenshots/73-portrait-select.png' });
  });
});
