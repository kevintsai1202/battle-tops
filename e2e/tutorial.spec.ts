import { devices, expect, test, type Page } from '@playwright/test';
import { expectInViewport, expectNoHorizontalScroll, swipe } from './mobile.helpers';

/**
 * 操作教學（四章十二步：組隊兩步 → 拉發射台 → 推移、衝刺、必殺 → 計分），指引畫在實際的遊戲畫面上：
 * 1. 桌機：從標題的「操作教學」進入，用滑鼠與鍵盤一步一步做完。每一步檢查：
 *    - 滑鼠游標指著實際要點的那一個元素（依序指推薦的三顆、下一步、第 2 戰的 ▲、軸的選單、出陣），
 *      而且指引不擋點擊（那個位置點下去就是目標本身），聚光圈只框住那一個元素；
 *    - 發射：倒數暫停時用真的發射台示範一次（不會發射），倒數開始後提示在哪裡按住往下拉；只按 Space 會要求重來；
 *    - 推移、衝刺、必殺顯示要按的大鍵帽，必殺框住量表；終結畫箭頭指向對手；面板裡只有計分那一步有說明圖。
 *    完成後回到標題並記住。
 * 2. 第一次玩：標題顯示提示，點標題其他地方照常開打；選「不用了」之後不再提示。
 * 3. 手機橫向：大手指照著做完全部步驟（點選、手指拉發射台、滑動推移、快甩衝刺、點必殺按鈕），教學面板在畫面內。
 */

type Dbg = {
  state: string;
  counters: { dashes: number; specials: number };
  voice: { guidePlayed: number; guideLast: string | null };
  tutorial: { step: string; index: number; guard: boolean; holding: boolean; demo: boolean; pushTime: number } | null;
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

/**
 * 大畫面指引指著實際要點的元素：手指（游標）的位置在目標裡面，而且那個位置點下去就是目標本身
 * （指引、聚光圈、面板都不擋點擊）；聚光圈只框住那一個元素（不是整片區塊）。
 */
async function expectGuideOn(page: Page, selector: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate((sel) => {
          const g = document.querySelector<HTMLElement>('#tutorial .tut-guide');
          const t = document.querySelector(sel);
          const spot = document.querySelector<HTMLElement>('#tutorial .tut-spot');
          if (!g || g.hidden || !t) return `沒有指引或目標（${sel}）`;
          const x = Number(g.dataset.x);
          const y = Number(g.dataset.y);
          const r = t.getBoundingClientRect();
          if (x < r.left || x > r.right || y < r.top || y > r.bottom) return `指引 ${x},${y} 不在 ${sel} ${JSON.stringify(r)} 裡`;
          const hit = document.elementFromPoint(x, y);
          if (!hit || (hit !== t && !t.contains(hit))) return `指引的位置點下去是 ${hit?.tagName}.${hit?.className}，不是 ${sel}`;
          const s = spot?.getBoundingClientRect();
          if (!s || spot!.hidden || Math.abs(s.width - r.width - 12) > 3 || Math.abs(s.height - r.height - 12) > 3) return `聚光圈 ${JSON.stringify(s)} 沒有只框住 ${sel}`;
          return 'ok';
        }, selector),
      { timeout: 15_000 },
    )
    .toBe('ok');
}

/**
 * 大畫面上的主手指（游標）。指引的容器是 0×0 的定位點，Playwright 會把它當成看不見，
 * 所以看不看得見要檢查裡面的手指本身（容器隱藏時手指也跟著隱藏）。
 */
const hand = (page: Page, kind?: string) => page.locator(`#tutorial .tut-guide${kind ? `[data-kind="${kind}"]` : ''} .tut-hand:not(.extra)`);

/** 兩個元素不重疊（大鍵帽不被教學面板蓋住） */
async function expectApart(page: Page, a: string, b: string): Promise<void> {
  await expect
    .poll(async () => {
      const p = (await page.locator(a).boundingBox())!;
      const t = (await page.locator(b).boundingBox())!;
      const apart = p.x + p.width <= t.x || t.x + t.width <= p.x || p.y + p.height <= t.y || t.y + t.height <= p.y;
      return apart ? 'apart' : `${a} ${JSON.stringify(p)} 和 ${b} ${JSON.stringify(t)} 重疊`;
    })
    .toBe('apart');
}

/** 這一步的標題與解說：面板顯示標題，播出指定的解說語音 */
async function expectStep(page: Page, id: string, title: string, voice: string, timeout = 30_000): Promise<void> {
  await expect.poll(() => step(page), { timeout }).toBe(id);
  await expect(page.locator('#tutorial .tut-title')).toHaveText(title);
  await expect.poll(async () => (await dbg(page)).voice.guideLast, { timeout: 30_000 }).toBe(voice);
}

test('桌機：從標題進入操作教學，跟著大畫面上的游標與鍵帽做完四章十二步，回到標題並記住已完成', async ({ page }) => {
  test.setTimeout(600_000);
  const errors = watchErrors(page);
  await page.goto('./?seed=61');
  await expect(page.locator('#title .tut-offer')).toBeVisible();
  await page.locator('#title .to-tutorial').click();

  // 第 1 章 組隊：游標依序指推薦的三顆；選別顆也算（這裡第二顆選星河狼），游標仍指還沒選的推薦陀螺
  await expect(page.locator('#select')).toBeVisible();
  await expectStep(page, 'pick', '組隊：選三顆陀螺', 'tut_pick');
  await expect(page.locator('#tutorial .tut-count')).toHaveText('1／12');
  await expect(page.locator('#tutorial .tut-hand').first()).toHaveAttribute('data-icon', 'cursor');
  await expect(page.locator('#tutorial .tut-panel .tut-demo')).toBeHidden();
  await expectGuideOn(page, '#select .card[data-id="blaze"]');
  await expectPanelClear(page, '#select .card[data-id="blaze"]');
  await page.screenshot({ path: 'e2e/screenshots/a0-tutorial-pick.png' });
  await page.locator('#select .card[data-id="blaze"]').click();
  await expectGuideOn(page, '#select .card[data-id="turtle"]');
  await page.locator('#select .card[data-id="wolf"]').click();
  await expectGuideOn(page, '#select .card[data-id="turtle"]');
  await page.locator('#select .card[data-id="turtle"]').click();
  await expectStep(page, 'next', '組隊：下一步', 'tut_next');
  await expectGuideOn(page, '#select .go');
  await expectPanelClear(page, '#select .go');
  await page.locator('#select .go').click();
  await expectStep(page, 'order', '調整出場順序', 'tut_order');
  await expectGuideOn(page, '#arrange .ar-slot:nth-child(2) .ar-up');
  await expectPanelClear(page, '#arrange .ar-slot:nth-child(2) .ar-up');
  await page.locator('#arrange .ar-slot:nth-child(2) .ar-up').click();
  await expectStep(page, 'parts', '換盤與軸', 'tut_parts');
  await expectGuideOn(page, '#arrange .ar-detail select[data-slot="driver"]');
  await expectPanelClear(page, '#arrange .ar-detail select[data-slot="driver"]');
  await page.screenshot({ path: 'e2e/screenshots/a1-tutorial-parts.png' });
  await page.locator('#arrange .detail select[data-slot="driver"]').selectOption('bearing');
  await expectStep(page, 'ready', '出陣', 'tut_ready');
  await expectGuideOn(page, '#arrange .ar-ready');
  await expectPanelClear(page, '#arrange .ar-ready');
  await page.locator('#arrange .ar-ready').click();

  // 第 2 章 發射：倒數暫停時用真的發射台示範（游標按住往下拉、外圈收縮、放手跳出 GO SHOOT），開場大字收起
  await expectStep(page, 'launch', '拉發射台', 'tut_launch_kb');
  await expect.poll(async () => (await dbg(page)).tutorial!.demo).toBe(true);
  expect((await dbg(page)).tutorial!.holding).toBe(true);
  await expect(page.locator('#launch')).toBeVisible();
  await expect(page.locator('#launch')).toHaveClass(/pulling/, { timeout: 10_000 });
  await expect(hand(page, 'drag')).toBeVisible();
  await expect(page.locator('#banner .bn')).toHaveCount(0);
  // 遊戲本身的發射台說明字收起（教學面板已經說明）
  await expect(page.locator('#launch .hint')).toBeHidden();
  await page.screenshot({ path: 'e2e/screenshots/a2-tutorial-launch-demo.png' });
  await expect(page.locator('#tutorial .tut-go')).toBeVisible({ timeout: 10_000 });
  // 示範中按下去不會開始拉條（還沒倒數）
  await page.mouse.click(640, 200);
  expect((await dbg(page)).state).toBe('launch');
  // 解說講完：示範收起，倒數開始，游標停在按住的位置提示往下拉
  await expect.poll(async () => (await dbg(page)).tutorial!.demo, { timeout: 60_000 }).toBe(false);
  await expect(page.locator('#tutorial .tut-press-hint')).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/a2b-tutorial-launch-hint.png' });
  // 第一次只按 Space（沒有拉條）→ 要求重來，重來的那一次不再示範
  await page.locator('#banner .bn', { hasText: 'ゴー' }).waitFor({ timeout: 90_000 });
  await page.keyboard.press('Space');
  await expect(page.locator('#tutorial .tut-toast')).toContainText('沒有拉條');
  await expect.poll(async () => (await dbg(page)).voice.guideLast).toBe('tut_retry');
  await expect.poll(async () => (await dbg(page)).state, { timeout: 30_000 }).toBe('launch');
  expect(await step(page)).toBe('launch');
  expect((await dbg(page)).tutorial!.demo).toBe(false);
  // 第二次：倒數到「1」時用滑鼠按住往下拉（拉條中提示收起，不擋在游標底下），到「ゴー」放手
  await page.locator('#banner .bn', { hasText: /^1$/ }).waitFor({ timeout: 90_000 });
  await page.mouse.move(640, 160);
  await page.mouse.down();
  await page.mouse.move(640, 560, { steps: 6 });
  await expect(hand(page)).toBeHidden();
  await page.locator('#banner .bn', { hasText: 'ゴー' }).waitFor({ timeout: 10_000 });
  await page.mouse.up();

  // 第 3 章 操控：推移顯示方向鍵（按住）→ 衝刺顯示方向鍵＋Shift → 必殺框住量表並顯示空白鍵
  await expectStep(page, 'push', '推移陀螺', 'tut_push_kb');
  await expect(page.locator('#tutorial .tut-keys[data-kind="keysMove"] .k-up')).toBeVisible();
  await expectApart(page, '#tutorial .tut-keys', '#tutorial .tut-panel');
  await page.screenshot({ path: 'e2e/screenshots/a3-tutorial-push-keys.png' });
  await page.keyboard.down('ArrowUp');
  await expectStep(page, 'dash', '衝刺', 'tut_dash_kb');
  await expect(page.locator('#tutorial .tut-keys[data-kind="keysDash"]')).toContainText('Shift');
  await page.keyboard.press('Shift');
  await expectStep(page, 'special', '必殺技', 'tut_special_kb');
  await page.keyboard.up('ArrowUp');
  await expect(page.locator('#tutorial .tut-keys[data-kind="keySpace"]')).toContainText('SPACE');
  await expectApart(page, '#tutorial .tut-keys', '#tutorial .tut-panel');
  await expect(page.locator('#hud .panel[data-side="0"]')).toHaveClass(/can/);
  await page.screenshot({ path: 'e2e/screenshots/a3b-tutorial-special.png' });
  await page.keyboard.press('Space');

  // 第 4 章 計分：箭頭指向對手 → 很快分出勝負 → 說明終結方式（面板裡的三種終結說明圖）→ 三對三賽制（完成）
  await expectStep(page, 'finish', '終結對手', 'tut_finish');
  expect((await dbg(page)).tutorial!.guard).toBe(false);
  await expect(page.locator('#tutorial .tut-arrow')).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/a3c-tutorial-finish-arrow.png' });
  // 對手轉速降到兩成後要等它停轉（headless 軟體渲染慢，留寬一點）
  await expectStep(page, 'points', '終結方式與得分', 'tut_points', 240_000);
  await expect(page.locator('#tutorial .demo-finishes .fin')).toHaveCount(3);
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

  test('觸控跟著大手指做完操作教學：點選組隊、手指拉發射台、滑動推移、快甩衝刺、點必殺按鈕，面板在畫面內', async ({ page }) => {
    test.setTimeout(600_000);
    const errors = watchErrors(page);
    await page.goto('./?seed=63');
    await expectInViewport(page, '#title .to-tutorial');
    await expectInViewport(page, '#title .tut-offer');
    await expectNoHorizontalScroll(page);
    await page.locator('#title .tut-offer-go').tap();

    // 組隊：大手指依序指推薦的三顆，照著點
    await expectStep(page, 'pick', '組隊：選三顆陀螺', 'tut_pick');
    await expect(page.locator('#tutorial .tut-hand').first()).toHaveAttribute('data-icon', 'finger');
    await expectInViewport(page, '#tutorial .tut-panel');
    for (const id of ['blaze', 'turtle', 'gale']) {
      await expectGuideOn(page, `#select .card[data-id="${id}"]`);
      await expectPanelClear(page, `#select .card[data-id="${id}"]`);
      if (id === 'blaze') await page.screenshot({ path: 'e2e/screenshots/a6-tutorial-mobile-pick.png' });
      await page.locator(`#select .card[data-id="${id}"]`).tap();
    }
    await expectStep(page, 'next', '組隊：下一步', 'tut_next');
    await expectGuideOn(page, '#select .go');
    await page.locator('#select .go').tap();
    await expectStep(page, 'order', '調整出場順序', 'tut_order');
    await expectInViewport(page, '#tutorial .tut-panel');
    await expectGuideOn(page, '#arrange .ar-slot:nth-child(2) .ar-up');
    await expectPanelClear(page, '#arrange .ar-slot:nth-child(2) .ar-up');
    await page.screenshot({ path: 'e2e/screenshots/a6b-tutorial-mobile-order.png' });
    await page.locator('#arrange .ar-slot:nth-child(2) .ar-up').tap();
    // 換零件：軸的選單在可以捲動的詳細資料裡，會先捲到看得見的地方
    await expectStep(page, 'parts', '換盤與軸', 'tut_parts');
    await expectGuideOn(page, '#arrange .ar-detail select[data-slot="driver"]');
    await expectInViewport(page, '#arrange .ar-detail select[data-slot="driver"]');
    await page.screenshot({ path: 'e2e/screenshots/a6c-tutorial-mobile-parts.png' });
    await page.locator('#arrange .detail select[data-slot="driver"]').selectOption('rubber');
    await expectStep(page, 'ready', '出陣', 'tut_ready');
    await expectGuideOn(page, '#arrange .ar-ready');
    await page.locator('#arrange .ar-ready').tap();

    // 發射：手機版的解說；倒數暫停時大手指在真的發射台上示範一次，倒數到「2」時手指往下滑（CDP 觸控很慢，提早開始）
    await expectStep(page, 'launch', '拉發射台', 'tut_launch_tc');
    await expect(page.locator('#tutorial .tut-text')).toContainText('手指');
    await expect.poll(async () => (await dbg(page)).tutorial!.demo).toBe(true);
    await expect(page.locator('#launch')).toHaveClass(/pulling/, { timeout: 10_000 });
    await page.screenshot({ path: 'e2e/screenshots/a7-tutorial-mobile-launch.png' });
    await page.locator('#banner .bn', { hasText: /^2$/ }).waitFor({ timeout: 90_000 });
    await swipe(page, { x: 430, y: 150 }, { x: 430, y: 340 }, 2);

    // 推移：大手指在自己的陀螺旁邊示範滑動；照著單指按住往上拖（CDP 觸控），按住時手指示範收起
    await expectStep(page, 'push', '推移陀螺', 'tut_push_tc');
    await expect(hand(page, 'swipe')).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/a7b-tutorial-mobile-push.png' });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 230, id: 4 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300, y: 160, id: 4 }] });
    await expectStep(page, 'dash', '衝刺', 'tut_dash_tc');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    // 快甩：大手指示範快速甩一下；照著做（頁面內連續送觸控類型的 pointer 事件，headless 的 CDP 觸控太慢做不出快甩）
    await expect(hand(page, 'flick')).toBeVisible();
    await page.evaluate(() => {
      const fire = (type: string, x: number) =>
        window.dispatchEvent(new PointerEvent(type, { pointerId: 99, pointerType: 'touch', clientX: x, clientY: 260, bubbles: true }));
      fire('pointerdown', 350);
      fire('pointermove', 480);
      fire('pointermove', 610);
      fire('pointerup', 610);
    });

    // 必殺：大手指指著集滿時右下角出現的必殺按鈕（面板不蓋住它），照著點一下
    await expectStep(page, 'special', '必殺技', 'tut_special_tc');
    await expectGuideOn(page, '#special-btn');
    await expectPanelClear(page, '#special-btn');
    await page.screenshot({ path: 'e2e/screenshots/a7c-tutorial-mobile-special.png' });
    await page.locator('#special-btn').tap();
    await expectStep(page, 'finish', '終結對手', 'tut_finish');
    await expect(page.locator('#tutorial .tut-arrow')).toBeVisible();

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
