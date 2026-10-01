import { devices, expect, test, type Page } from '@playwright/test';
import { expectInViewport, expectNoHorizontalScroll } from './mobile.helpers';
import { arrangeOrder, pickTops } from './team.helpers';

/**
 * 組隊兩步：
 * - 第 1 步（選場地與三顆）：陀螺 3D 縮圖、外觀與絕招示範；只看介紹，沒有零件選單。
 * - 第 2 步（出場順序與零件）：▲▼ 調換順序、換盤與軸後雷達圖與數值立刻更新、備用零件每種一件；
 *   回上一步換掉陀螺時零件歸還；出陣後順序與零件帶進對戰。
 * 桌機跑完整流程；手機橫向與直向檢查兩步的版面、示範有在動與觸控操作，並截圖。
 */

type SelectDbg = {
  state: string;
  showcase: { loops: number; fires: number } | null;
  loadouts: Record<string, { disk: string | null; driver: string | null }>;
  playerStats: Record<string, number>;
  match: { player: string[] } | null;
};
/** 手機裝置設定（去掉 defaultBrowserType 才能在 describe 裡用 test.use） */
const phone = (name: string) => {
  const { defaultBrowserType: _, ...rest } = devices[name];
  return rest;
};

const dbg = (page: Page) => page.evaluate(() => (window as unknown as { __game: { debug(): SelectDbg } }).__game.debug());

/** 第 2 步詳細資料的雷達圖目前的多邊形座標 */
const radarPoints = (page: Page) => page.locator('#arrange .detail .radar .val').getAttribute('points');

test('組隊兩步：第 1 步縮圖與絕招示範；第 2 步調順序、換零件後雷達圖與數值立刻更新、備用零件同隊不能重複；回上一步換陀螺零件歸還', async ({ page }) => {
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

  // 第 1 步只看介紹：沒有零件選單
  await page.locator('#select .card[data-id="pegasus"]').hover();
  await expect(page.locator('#select .detail .d-zh')).toHaveText('暴嵐天駒');
  await expect(page.locator('#select .detail .d-parts')).toBeHidden();

  // 選三顆（點選順序是預設的出場順序）→ 下一步
  await pickTops(page, ['pegasus', 'blaze', 'turtle']);
  await expect(page.locator('#select')).toBeHidden();
  await expect(page.locator('#arrange')).toBeVisible();
  expect(await arrangeOrder(page)).toEqual(['pegasus', 'blaze', 'turtle']);
  // CPU 的三顆公開、不計時；絕招示範換到第 2 步的舞台
  await expect(page.locator('#arrange .ar-opp .chip')).toHaveCount(3);
  await expect(page.locator('#arrange .ar-timer')).toBeHidden();
  await expect(page.locator('#arrange .detail .d-canvas')).toBeVisible();

  // 第 1 戰的暴嵐天駒換軸：雷達圖與數值立刻變，並出現原廠輪廓與增減標示
  await expect(page.locator('#arrange .detail .d-zh')).toHaveText('暴嵐天駒');
  const driver = page.locator('#arrange .detail select[data-slot="driver"]');
  await expect(driver).toBeEnabled();
  const before = await radarPoints(page);
  await driver.selectOption('bearing');
  await expect.poll(() => radarPoints(page)).not.toBe(before);
  await expect(page.locator('#arrange .detail .radar .ghost')).toBeVisible();
  await expect(page.locator('#arrange .detail .d-stats small.up').first()).toBeVisible();
  await expect(page.locator('#arrange .detail .d-stats small.down').first()).toBeVisible();
  // 換盤
  await page.locator('#arrange .detail select[data-slot="disk"]').selectOption('heavy');
  await expect(page.locator('#arrange .detail .d-stats li', { hasText: '重量' }).locator('small.up')).toBeVisible();
  await expect(page.locator('#arrange .ar-slot[data-id="pegasus"]')).toContainText('換了零件');
  await page.screenshot({ path: 'e2e/screenshots/71-arrange-parts.png' });

  // 備用零件每種一件：隊友（烈焰龍）的軸承軸選項被停用並標出裝在誰身上
  await page.locator('#arrange .ar-slot[data-id="blaze"]').click();
  await expect(page.locator('#arrange .detail .d-zh')).toHaveText('烈焰龍');
  const taken = page.locator('#arrange .detail select[data-slot="driver"] option[value="bearing"]');
  await expect(taken).toHaveJSProperty('disabled', true);
  await expect(taken).toContainText('暴嵐天駒');

  // ▲ 調換順序：鐵壁龜（第 3 戰）往前兩次 → 第 1 戰
  await page.locator('#arrange .ar-slot[data-id="turtle"] .ar-up').click();
  await page.locator('#arrange .ar-slot[data-id="turtle"] .ar-up').click();
  expect(await arrangeOrder(page)).toEqual(['turtle', 'pegasus', 'blaze']);

  // 回上一步：選擇與順序保留；換掉暴嵐天駒（零件歸還）、改選疾風鳳
  await page.locator('#arrange .ar-back').click();
  await expect(page.locator('#select')).toBeVisible();
  await expect(page.locator('#select .card[data-id="turtle"] .badge')).toHaveText('1');
  await expect(page.locator('#select .card[data-id="pegasus"] .badge')).toHaveText('2');
  await expect(page.locator('#select .card[data-id="blaze"] .badge')).toHaveText('3');
  await page.locator('#select .card[data-id="pegasus"]').click();
  await page.locator('#select .card[data-id="gale"]').click();
  await page.locator('#select .go').click();
  await expect(page.locator('#arrange')).toBeVisible();
  expect(await arrangeOrder(page)).toEqual(['turtle', 'blaze', 'gale']);
  await page.locator('#arrange .ar-slot[data-id="blaze"]').click();
  await expect(page.locator('#arrange .detail select[data-slot="driver"] option[value="bearing"]')).toHaveJSProperty('disabled', false);
  await page.locator('#arrange .detail select[data-slot="driver"]').selectOption('bearing');

  // 出陣：順序與零件帶進對戰
  await page.locator('#arrange .ar-ready').click();
  await expect(page.locator('#arrange')).toBeHidden();
  const d = await dbg(page);
  expect(d.match?.player).toEqual(['turtle', 'blaze', 'gale']);
  expect(d.loadouts.blaze?.driver).toBe('bearing');
  expect(d.loadouts.pegasus).toBeUndefined();
  expect(d.showcase).toBeNull();
  expect(errors).toEqual([]);
});

test.describe('手機橫向', () => {
  test.use(phone('Pixel 7 landscape'));
  test('兩步組隊版面不超出、絕招示範在動、第 2 步點 ▲ 調順序與換零件', async ({ page }) => {
    await page.goto('./?seed=32');
    await page.tap('#title');
    await expect(page.locator('#select')).toBeVisible();
    await expectInViewport(page, '#select .cards');
    await expectInViewport(page, '#select .detail');
    await expectInViewport(page, '#select .go');
    await expectNoHorizontalScroll(page);
    await expect.poll(async () => (await dbg(page)).showcase?.fires ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);

    await pickTops(page, ['orion', 'blaze', 'turtle'], true);
    await expect(page.locator('#arrange')).toBeVisible();
    for (const sel of ['#arrange .ar-slots', '#arrange .ar-ready', '#arrange .ar-back', '#arrange .detail', '#arrange .ar-opp']) await expectInViewport(page, sel);
    await expectNoHorizontalScroll(page);
    await page.locator('#arrange .ar-slot[data-id="turtle"] .ar-up').tap();
    expect(await arrangeOrder(page)).toEqual(['orion', 'turtle', 'blaze']);
    await page.locator('#arrange .ar-slot[data-id="orion"]').tap();
    await page.locator('#arrange .detail select[data-slot="driver"]').selectOption('rubber');
    await expect(page.locator('#arrange .detail .radar .ghost')).toBeVisible();
    await expect.poll(async () => (await dbg(page)).showcase?.fires ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
    await page.screenshot({ path: 'e2e/screenshots/72-mobile-arrange.png' });
  });
});

test.describe('手機直向', () => {
  test.use(phone('Pixel 7'));
  test('兩步組隊版面不超出、絕招示範在動', async ({ page }) => {
    await page.goto('./?seed=33');
    await page.tap('#title');
    await expect(page.locator('#select')).toBeVisible();
    await expectInViewport(page, '#select .cards');
    await expectInViewport(page, '#select .detail');
    await expectInViewport(page, '#select .go');
    await expectNoHorizontalScroll(page);
    await expect.poll(async () => (await dbg(page)).showcase?.fires ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
    await page.screenshot({ path: 'e2e/screenshots/73-portrait-select.png' });

    await pickTops(page, ['gale', 'blaze', 'wolf'], true);
    await expect(page.locator('#arrange')).toBeVisible();
    for (const sel of ['#arrange .ar-slots', '#arrange .ar-ready', '#arrange .ar-back', '#arrange .ar-opp']) await expectInViewport(page, sel);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: 'e2e/screenshots/74-portrait-arrange.png' });
  });
});
