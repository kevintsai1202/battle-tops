import { devices, expect, test, type Page } from '@playwright/test';
import { expectInViewport, expectNoHorizontalScroll, swipe } from './mobile.helpers';

/**
 * 操作教學（四章十二步：組隊兩步 → 拉發射台 → 推移、衝刺、必殺 → 計分）：
 * 1. 桌機：從標題的「操作教學」進入，用滑鼠與鍵盤一步一步做完；每一步都有聚光圈、示範動畫與中文解說語音，
 *    做到了才進下一步。發射只按 Space（沒有拉條）會要求重來；解說講完前倒數暫停。完成後回到標題並記住。
 * 2. 第一次玩：標題顯示提示，點標題其他地方照常開打；選「不用了」之後不再提示。
 * 3. 手機橫向：觸控做完全部步驟（點選、手指拉發射台、滑動推移、快甩衝刺、三指必殺），教學面板在畫面內。
 */

type Dbg = {
  state: string;
  counters: { dashes: number; specials: number };
  voice: { guidePlayed: number; guideLast: string | null };
  tutorial: { step: string; index: number; guard: boolean; holding: boolean; pushTime: number } | null;
};
const dbg = (page: Page) => page.evaluate(() => (window as unknown as { __game: { debug(): Dbg } }).__game.debug());
/** 目前在教學的哪一步（不在教學時為 null） */
const step = async (page: Page) => (await dbg(page)).tutorial?.step ?? null;

/** 收集頁面錯誤，測試最後斷言為空 */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

/**
 * 教學面板沒有蓋到這一步要操作的元素（手機橫向的名鑑幾乎佔滿畫面高度，面板要改放側邊）。
 * 縮圖載入等版面變動後面板會重新定位，所以用 poll 等它穩定。
 */
async function expectPanelClear(page: Page, selector: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const p = (await page.locator('#tutorial .tut-panel').boundingBox())!;
        const t = (await page.locator(selector).boundingBox())!;
        const apart = p.x + p.width <= t.x || t.x + t.width <= p.x || p.y + p.height <= t.y || t.y + t.height <= p.y;
        return apart ? 'clear' : `面板 ${JSON.stringify(p)} 蓋到 ${selector} ${JSON.stringify(t)}`;
      },
      { timeout: 10_000 },
    )
    .toBe('clear');
}

/** 這一步的標題與解說：面板顯示標題，播出指定的解說語音 */
async function expectStep(page: Page, id: string, title: string, voice: string, timeout = 30_000): Promise<void> {
  await expect.poll(() => step(page), { timeout }).toBe(id);
  await expect(page.locator('#tutorial .tut-title')).toHaveText(title);
  await expect.poll(async () => (await dbg(page)).voice.guideLast, { timeout: 30_000 }).toBe(voice);
}

test('桌機：從標題進入操作教學，用滑鼠與鍵盤做完四章十二步，回到標題並記住已完成', async ({ page }) => {
  test.setTimeout(600_000);
  const errors = watchErrors(page);
  await page.goto('./?seed=61');
  await expect(page.locator('#title .tut-offer')).toBeVisible();
  await page.locator('#title .to-tutorial').click();

  // 第 1 章 組隊
  await expect(page.locator('#select')).toBeVisible();
  await expect(page.locator('#tutorial .tut-panel')).toBeVisible();
  await expectStep(page, 'pick', '組隊：選三顆陀螺', 'tut_pick');
  await expect(page.locator('#tutorial .tut-spot')).toBeVisible();
  await expect(page.locator('#tutorial .tut-demo.demo-tap .finger')).toBeVisible();
  await expect(page.locator('#tutorial .tut-count')).toHaveText('1／12');
  await expectPanelClear(page, '#select .cards');
  await page.screenshot({ path: 'e2e/screenshots/a0-tutorial-pick.png' });
  for (const id of ['blaze', 'turtle', 'gale']) await page.locator(`#select .card[data-id="${id}"]`).click();
  await expectStep(page, 'next', '組隊：下一步', 'tut_next');
  await expectPanelClear(page, '#select .go');
  await page.locator('#select .go').click();
  await expectStep(page, 'order', '調整出場順序', 'tut_order');
  await expectPanelClear(page, '#arrange .ar-slots');
  await page.locator('#arrange .ar-slot[data-id="gale"] .ar-up').click();
  await expectStep(page, 'parts', '換盤與軸', 'tut_parts');
  await expectPanelClear(page, '#arrange .ar-detail .d-parts');
  await page.screenshot({ path: 'e2e/screenshots/a1-tutorial-parts.png' });
  await page.locator('#arrange .detail select[data-slot="driver"]').selectOption('bearing');
  await expectStep(page, 'ready', '出陣', 'tut_ready');
  await expectPanelClear(page, '#arrange .ar-ready');
  await page.locator('#arrange .ar-ready').click();

  // 第 2 章 發射：解說講完前倒數暫停；第一次只按 Space（沒有拉條）→ 要求重來
  await expectStep(page, 'launch', '拉發射台', 'tut_launch_kb');
  expect((await dbg(page)).tutorial!.holding).toBe(true);
  await expect(page.locator('#tutorial .tut-demo.demo-drag .ring-out')).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/a2-tutorial-launch.png' });
  await page.locator('#banner .bn', { hasText: 'ゴー' }).waitFor({ timeout: 90_000 });
  await page.keyboard.press('Space');
  await expect(page.locator('#tutorial .tut-toast')).toContainText('沒有拉條');
  await expect.poll(async () => (await dbg(page)).voice.guideLast).toBe('tut_retry');
  await expect.poll(async () => (await dbg(page)).state, { timeout: 30_000 }).toBe('launch');
  expect(await step(page)).toBe('launch');
  // 第二次：倒數到「1」時用滑鼠按住往下拉，到「ゴー」放手
  await page.locator('#banner .bn', { hasText: /^1$/ }).waitFor({ timeout: 90_000 });
  await page.mouse.move(640, 160);
  await page.mouse.down();
  await page.mouse.move(640, 560, { steps: 6 });
  await page.locator('#banner .bn', { hasText: 'ゴー' }).waitFor({ timeout: 10_000 });
  await page.mouse.up();

  // 第 3 章 操控：推移（按住方向鍵）→ 衝刺（方向鍵＋Shift）→ 必殺（量表自動集滿，按 Space）
  await expectStep(page, 'push', '推移陀螺', 'tut_push_kb');
  await expect(page.locator('#tutorial .tut-demo.demo-keysMove .k-up')).toBeVisible();
  await page.keyboard.down('ArrowUp');
  await expectStep(page, 'dash', '衝刺', 'tut_dash_kb');
  await page.screenshot({ path: 'e2e/screenshots/a3-tutorial-dash.png' });
  await page.keyboard.press('Shift');
  await expectStep(page, 'special', '必殺技', 'tut_special_kb');
  await page.keyboard.up('ArrowUp');
  await expect(page.locator('#hud .panel[data-side="0"]')).toHaveClass(/can/);
  await page.keyboard.press('Space');

  // 第 4 章 計分：對手轉速降低，很快分出勝負 → 說明終結方式（下一步）→ 三對三賽制（完成）
  await expectStep(page, 'finish', '終結對手', 'tut_finish');
  expect((await dbg(page)).tutorial!.guard).toBe(false);
  await expect(page.locator('#tutorial .demo-finishes .fin')).toHaveCount(3);
  // 對手轉速降到兩成後要等它停轉（headless 軟體渲染慢，留寬一點）
  await expectStep(page, 'points', '終結方式與得分', 'tut_points', 240_000);
  await expect(page.locator('#tutorial .tut-next')).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/a4-tutorial-points.png' });
  await page.locator('#tutorial .tut-next').click();
  await expectStep(page, 'match', '三對三賽制', 'tut_match');
  await expect(page.locator('#tutorial .tut-next')).toHaveText('完成 ✓');
  await page.keyboard.press('Enter');

  // 完成：回到標題，教學畫面移除，之後不再提示
  await expect(page.locator('#title')).toBeVisible();
  await expect(page.locator('#tutorial')).toHaveCount(0);
  await expect(page.locator('#title .tut-offer')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('battle-tops.tutorial'))).toBe('done');
  expect((await dbg(page)).voice.guidePlayed).toBeGreaterThanOrEqual(13);
  expect(errors).toEqual([]);
});

test('第一次玩：標題有提示但不擋開打；選「不用了」之後不再提示', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./?seed=62');
  await expect(page.locator('#title .tut-offer')).toBeVisible();
  await expectInViewport(page, '#title .tut-offer');
  await page.screenshot({ path: 'e2e/screenshots/a5-tutorial-offer.png' });
  await page.locator('#title .tut-offer-no').click();
  await expect(page.locator('#title .tut-offer')).toBeHidden();
  await expect(page.locator('#title')).toBeVisible();
  await page.reload();
  await expect(page.locator('#title .tut-offer')).toBeHidden();
  // 點標題照常開打，不會進教學
  await page.locator('#title .blink').click();
  await expect(page.locator('#select')).toBeVisible();
  await expect(page.locator('#tutorial')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test.describe('手機橫向', () => {
  test.use((() => {
    const { defaultBrowserType: _, ...rest } = devices['Pixel 7 landscape'];
    return rest;
  })());

  test('觸控做完操作教學：點選組隊、手指拉發射台、滑動推移、快甩衝刺、三指必殺，面板在畫面內', async ({ page }) => {
    test.setTimeout(600_000);
    const errors = watchErrors(page);
    await page.goto('./?seed=63');
    await expectInViewport(page, '#title .to-tutorial');
    await expectInViewport(page, '#title .tut-offer');
    await expectNoHorizontalScroll(page);
    await page.locator('#title .tut-offer-go').tap();

    await expectStep(page, 'pick', '組隊：選三顆陀螺', 'tut_pick');
    await expectInViewport(page, '#tutorial .tut-panel');
    await expectPanelClear(page, '#select .cards');
    await page.screenshot({ path: 'e2e/screenshots/a6-tutorial-mobile-pick.png' });
    for (const id of ['orion', 'blaze', 'turtle']) await page.locator(`#select .card[data-id="${id}"]`).tap();
    await expectStep(page, 'next', '組隊：下一步', 'tut_next');
    await expectPanelClear(page, '#select .go');
    await page.locator('#select .go').tap();
    await expectStep(page, 'order', '調整出場順序', 'tut_order');
    await expectInViewport(page, '#tutorial .tut-panel');
    await expectPanelClear(page, '#arrange .ar-slots');
    await page.screenshot({ path: 'e2e/screenshots/a6b-tutorial-mobile-order.png' });
    await page.locator('#arrange .ar-slot[data-id="turtle"] .ar-up').tap();
    await expectStep(page, 'parts', '換盤與軸', 'tut_parts');
    await page.locator('#arrange .detail select[data-slot="driver"]').selectOption('rubber');
    await expectStep(page, 'ready', '出陣', 'tut_ready');
    await expectPanelClear(page, '#arrange .ar-ready');
    await page.locator('#arrange .ar-ready').tap();

    // 發射：手機版的解說與示範；倒數到「2」時手指往下滑（CDP 觸控很慢，提早開始）
    await expectStep(page, 'launch', '拉發射台', 'tut_launch_tc');
    await expect(page.locator('#tutorial .tut-text')).toContainText('手指');
    await page.screenshot({ path: 'e2e/screenshots/a7-tutorial-mobile-launch.png' });
    await page.locator('#banner .bn', { hasText: /^2$/ }).waitFor({ timeout: 90_000 });
    await swipe(page, { x: 430, y: 150 }, { x: 430, y: 340 }, 2);

    // 推移：單指按住往上拖（CDP 觸控），按住超過推移目標的時間
    await expectStep(page, 'push', '推移陀螺', 'tut_push_tc');
    await expect(page.locator('#tutorial .tut-demo.demo-swipe .finger')).toBeVisible();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 230, id: 4 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300, y: 160, id: 4 }] });
    await expectStep(page, 'dash', '衝刺', 'tut_dash_tc');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    // 快甩：頁面內連續送觸控類型的 pointer 事件（headless 的 CDP 觸控太慢做不出快甩，見 mobile-landscape.spec）
    await page.evaluate(() => {
      const fire = (type: string, x: number) =>
        window.dispatchEvent(new PointerEvent(type, { pointerId: 99, pointerType: 'touch', clientX: x, clientY: 260, bubbles: true }));
      fire('pointerdown', 350);
      fire('pointermove', 480);
      fire('pointermove', 610);
      fire('pointerup', 610);
    });

    // 三指必殺
    await expectStep(page, 'special', '必殺技', 'tut_special_tc');
    await expect(page.locator('#tutorial .tut-demo.demo-threeTap .f3')).toBeVisible();
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: 300, y: 220, id: 1 },
        { x: 450, y: 240, id: 2 },
        { x: 600, y: 220, id: 3 },
      ],
    });
    await expectStep(page, 'finish', '終結對手', 'tut_finish');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    // 對手轉速降到兩成後要等它停轉（headless 軟體渲染慢，留寬一點）
  await expectStep(page, 'points', '終結方式與得分', 'tut_points', 240_000);
    await expectInViewport(page, '#tutorial .tut-panel');
    await page.screenshot({ path: 'e2e/screenshots/a8-tutorial-mobile-points.png' });
    await page.locator('#tutorial .tut-next').tap();
    await expectStep(page, 'match', '三對三賽制', 'tut_match');
    await page.locator('#tutorial .tut-next').tap();
    await expect(page.locator('#title')).toBeVisible();
    await expect(page.locator('#tutorial')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
