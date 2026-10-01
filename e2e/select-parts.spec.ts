import { devices, expect, test, type Page } from '@playwright/test';
import { expectInViewport, expectNoHorizontalScroll } from './mobile.helpers';
import { arrangeOrder, choosePart, pickTops } from './team.helpers';

/**
 * 組隊兩步：
 * - 第 1 步（選場地與三顆）：陀螺 3D 縮圖、外觀與絕招示範；只看介紹，沒有零件選單。
 * - 第 2 步（出場順序與零件）：▲▼ 調換順序；每個欄位的「盤」「軸」按鈕展開零件清單（附數值增減），
 *   換上後雷達圖與數值立刻更新、按鈕發光；備用零件每種一件；鍵盤 Q／E 也能開清單；
 *   回上一步換掉陀螺時零件歸還；出陣後順序與零件帶進對戰。
 * - 說明區塊：上方固定名稱＋雷達圖（一定看得到），其餘在下方捲動；切換陀螺時面板高度與雷達圖位置都不變；切換場地時名鑑不會上下跳。
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
  await page.locator('#title .to-cpu').click();
  await expect(page.locator('#select')).toBeVisible();

  // 20 格都換上 3D 縮圖（dataURL）
  await expect(page.locator('#select .card.tile img.thumb:not([hidden])')).toHaveCount(20, { timeout: 30_000 });
  const src = await page.locator('#select .card.tile img.thumb').first().getAttribute('src');
  expect(src?.startsWith('data:image/png')).toBe(true);

  // 絕招示範：舞台窗有畫布，會放出必殺並閃出招式名
  await expect(page.locator('#select .detail .d-canvas')).toBeVisible();
  await expect.poll(async () => (await dbg(page)).showcase?.fires ?? 0, { timeout: 20_000 }).toBeGreaterThan(0);
  await page.screenshot({ path: 'e2e/screenshots/70-select-showcase.png' });

  // 說明區塊：名稱、原型說明、必殺說明長短不同的陀螺，面板高度、雷達圖的位置與捲動區的大小都不變；
  // 雷達圖在上方固定區（在畫面內），1280×720 時內容比面板高，捲動的是下方的捲動區（不是整個面板）
  const layouts: string[] = [];
  for (const id of ['blaze', 'pegasus', 'nemesis', 'ldrago', 'requiem', 'kerbeus']) {
    await page.locator(`#select .card[data-id="${id}"]`).hover();
    await expect(page.locator('#select .detail')).toHaveAttribute('data-id', id);
    const box = async (sel: string) => (await page.locator(`#select .detail ${sel}`.trim()).boundingBox())!;
    const panel = await box('');
    const radar = await box('.d-fixed .radar');
    const scroll = await box('.d-scroll');
    layouts.push([panel.height, radar.y - panel.y, scroll.y - panel.y, scroll.height].map(Math.round).join(','));
  }
  expect(new Set(layouts).size, layouts.join(' / ')).toBe(1);
  await expectInViewport(page, '#select .detail .d-fixed .radar');
  const scrolls = await page.locator('#select .detail').evaluate((d) => {
    const sc = d.querySelector('.d-scroll') as HTMLElement;
    return { panel: d.scrollHeight - d.clientHeight, inner: sc.scrollHeight - sc.clientHeight };
  });
  expect(scrolls.panel, '整個面板不捲動').toBeLessThanOrEqual(1);
  expect(scrolls.inner, '下方的捲動區要能捲').toBeGreaterThan(0);
  // 捲到最下面看必殺說明，雷達圖仍在原位；換一顆陀螺時捲動位置保留
  const radarY = async () => Math.round((await page.locator('#select .detail .radar').boundingBox())!.y);
  const y1 = await radarY();
  await page.locator('#select .detail .d-scroll').evaluate((sc) => (sc.scrollTop = sc.scrollHeight));
  await expect(page.locator('#select .detail .d-desc')).toBeInViewport();
  expect(await radarY()).toBe(y1);
  await page.screenshot({ path: 'e2e/screenshots/70b-select-detail-scrolled.png' });
  // 換一顆時不重設捲動位置：只會因為新的內容比較短而被夾到最多能捲的位置（內容放得下時才是 0）
  const scrolledTop = await page.locator('#select .detail .d-scroll').evaluate((sc) => sc.scrollTop);
  expect(scrolledTop).toBeGreaterThan(0);
  for (const id of ['pegasus', 'blaze']) {
    await page.locator(`#select .card[data-id="${id}"]`).hover();
    await expect(page.locator('#select .detail')).toHaveAttribute('data-id', id);
    const st = await page.locator('#select .detail .d-scroll').evaluate((sc) => ({ top: sc.scrollTop, max: sc.scrollHeight - sc.clientHeight }));
    expect(Math.abs(st.top - Math.min(scrolledTop, st.max)), `${id} 的捲動位置`).toBeLessThanOrEqual(1);
  }
  // 切換場地（說明長短不同）時名鑑不會上下跳
  const cardsY = async () => Math.round((await page.locator('#select .cards').boundingBox())!.y);
  const y0 = await cardsY();
  for (const a of ['stadium', 'double', 'volcano', 'random', 'practice']) {
    await page.locator(`#select .arena button[data-id="${a}"]`).click();
    expect(await cardsY(), a).toBe(y0);
  }

  // 第 1 步只看介紹：沒有零件
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

  // 每個欄位都有「盤」「軸」按鈕，一開始是原廠；詳細資料不再有下拉選單
  await expect(page.locator('#arrange .ar-slot .part-btn')).toHaveCount(6);
  await expect(page.locator('#arrange .ar-slot .part-btn.changed')).toHaveCount(0);
  await expect(page.locator('#arrange .detail select')).toHaveCount(0);
  // 第 1 戰的暴嵐天駒換軸：按「軸」展開零件清單（原廠在第一個、每件附數值增減），換上軸承軸 → 雷達圖與數值立刻變
  await expect(page.locator('#arrange .detail .d-zh')).toHaveText('暴嵐天駒');
  const before = await radarPoints(page);
  await page.locator('#arrange .ar-slot[data-id="pegasus"] .part-btn[data-slot="driver"]').click();
  await expect(page.locator('#part-menu')).toBeVisible();
  await expect(page.locator('#part-menu .pm-opt').first()).toContainText('原廠');
  await expect(page.locator('#part-menu .pm-opt[data-part="bearing"] .pm-delta i').first()).toBeVisible();
  await expectInViewport(page, '#part-menu');
  await page.screenshot({ path: 'e2e/screenshots/71b-arrange-part-menu.png' });
  await page.locator('#part-menu .pm-opt[data-part="bearing"]').click();
  await expect(page.locator('#part-menu')).toHaveCount(0);
  await expect(page.locator('#arrange .ar-slot[data-id="pegasus"] .part-btn[data-slot="driver"]')).toHaveClass(/changed/);
  await expect(page.locator('#arrange .ar-slot[data-id="pegasus"] .part-btn[data-slot="driver"]')).toContainText('軸承軸');
  await expect.poll(() => radarPoints(page)).not.toBe(before);
  await expect(page.locator('#arrange .detail .radar .ghost')).toBeVisible();
  await expect(page.locator('#arrange .detail .d-stats small.up').first()).toBeVisible();
  await expect(page.locator('#arrange .detail .d-stats small.down').first()).toBeVisible();
  // 換盤
  await choosePart(page, 'pegasus', 'disk', 'heavy');
  await expect(page.locator('#arrange .detail .d-stats li', { hasText: '重量' }).locator('small.up')).toBeVisible();
  await expect(page.locator('#arrange .ar-slot[data-id="pegasus"] .part-btn.changed')).toHaveCount(2);
  await expect(page.locator('#arrange .detail .d-parts .changed')).toHaveCount(2);
  await page.screenshot({ path: 'e2e/screenshots/71-arrange-parts.png' });

  // 備用零件每種一件：隊友（烈焰龍）的軸清單裡，軸承軸停用並標出裝在誰身上；Esc 收起
  await page.locator('#arrange .ar-slot[data-id="blaze"] .part-btn[data-slot="driver"]').click();
  await expect(page.locator('#arrange .detail .d-zh')).toHaveText('烈焰龍');
  const taken = page.locator('#part-menu .pm-opt[data-part="bearing"]');
  await expect(taken).toBeDisabled();
  await expect(taken).toContainText('暴嵐天駒');
  await page.keyboard.press('Escape');
  await expect(page.locator('#part-menu')).toHaveCount(0);
  // 鍵盤：Q 打開選到那一顆（烈焰龍）的盤清單，↓ 移到下一件、Enter 換上
  await page.keyboard.press('q');
  await expect(page.locator('#part-menu')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('#part-menu')).toHaveCount(0);
  await expect(page.locator('#arrange .ar-slot[data-id="blaze"] .part-btn[data-slot="disk"]')).toHaveClass(/changed/);
  await expect(page.locator('#arrange')).toBeVisible();

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
  await choosePart(page, 'blaze', 'driver', 'bearing');

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
    await page.locator('#title .to-cpu').tap();
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
    // 盤／軸按鈕在畫面內；點「軸」展開的清單也在畫面內
    await expectInViewport(page, '#arrange .ar-slot[data-id="orion"] .part-btn[data-slot="driver"]');
    await page.locator('#arrange .ar-slot[data-id="orion"] .part-btn[data-slot="driver"]').tap();
    await expectInViewport(page, '#part-menu');
    await page.screenshot({ path: 'e2e/screenshots/72b-mobile-part-menu.png' });
    await page.locator('#part-menu .pm-opt[data-part="rubber"]').tap();
    await expect(page.locator('#part-menu')).toHaveCount(0);
    await expect(page.locator('#arrange .detail .radar .ghost')).toBeVisible();
    await expect.poll(async () => (await dbg(page)).showcase?.fires ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
    await page.screenshot({ path: 'e2e/screenshots/72-mobile-arrange.png' });
  });
});

test.describe('手機直向', () => {
  test.use(phone('Pixel 7'));
  test('兩步組隊版面不超出、絕招示範在動', async ({ page }) => {
    await page.goto('./?seed=33');
    // 標題是按鈕選單：點「電腦對戰」開始
    await page.locator('#title .to-cpu').tap();
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
