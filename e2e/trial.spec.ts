import { devices, expect, test, type Page } from '@playwright/test';
import { expectInViewport, expectNoHorizontalScroll } from './mobile.helpers';

/**
 * 試驗模式（一對一，自己指定雙方的陀螺與零件，比較搭配的效果）：
 * 1. 電腦：標題按「試驗模式」→ 換電腦的陀螺、換你的盤（零件清單）、選場地 → 開始試驗 → 打完一戰看到這一戰的數據與累計戰績 →
 *    同設定再戰累計到第 2 戰 → 電腦自動對打 100 場顯示勝率 → 換設定（換了零件累計戰績重新算）→ 回標題。
 * 2. 手機橫向：設定畫面與結果畫面都在畫面內，點選操作。
 * 為了快點分出勝負，對戰中用除錯把一邊的爆裂值灌滿。
 */

type Record3 = { games: number; wins: number; losses: number; draws: number };
type TrialDbg = {
  state: string;
  arena: string;
  trial: { key: string; record: Record3 | null } | null;
  trialCfg: { player: { top: string; loadout: { disk: string | null; driver: string | null } }; cpu: { top: string }; arena: string } | null;
  trialAuto: number | null;
  lastAutoDuel: (Record3 & { seats: [number, number] }) | null;
};
const dbg = (page: Page) => page.evaluate(() => (window as unknown as { __game: { debug(): TrialDbg } }).__game.debug());

/** 手機裝置設定（去掉 defaultBrowserType 才能在 describe 裡用 test.use） */
const phone = (name: string) => {
  const { defaultBrowserType: _, ...rest } = devices[name];
  return rest;
};

/**
 * 等倒數的「ゴー」大字出現時按 Space 發射，再把 loser 那一邊（0 = 你、1 = 電腦）的爆裂值灌滿，等結果畫面出現。
 * 終結後的特寫鏡頭在 headless 軟體渲染只有每秒 1～2 格，遊戲每格最多算 0.1 秒、要 3.6 秒才換畫面，所以等久一點。
 */
async function fightAndFinish(page: Page, loser: 0 | 1): Promise<void> {
  await page.waitForFunction(() => (window as any).__game.debug().state === 'launch', null, { timeout: 30_000 });
  await page.locator('#banner .bn', { hasText: 'ゴー' }).waitFor({ timeout: 45_000 });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => (window as any).__game.debug().state === 'battle', null, { timeout: 10_000 });
  await page.evaluate((l) => ((window as any).__game.sim.tops[l].burst = 1), loser);
  await expect(page.locator('#trial-result')).toBeVisible({ timeout: 150_000 });
}

test('試驗模式：指定雙方的陀螺與零件 → 一戰的數據與累計戰績 → 同設定再戰 → 電腦自動對打 100 場 → 換設定', async ({ page }) => {
  test.setTimeout(480_000);
  const errors: string[] = [];
  // 頁面錯誤也印出來：中途失敗時看得到原因
  page.on('pageerror', (e) => {
    errors.push(String(e));
    console.log('pageerror', e.stack ?? String(e));
  });
  await page.goto('./?seed=41');
  await page.locator('#title .to-trial').click();
  await expect(page.locator('#trial')).toBeVisible();
  await expect(page.locator('#trial .card')).toHaveCount(20);
  // 預設：你＝烈焰龍、電腦＝鐵壁龜，選取「你」；場地沒有「隨機」
  await expect(page.locator('#trial .tr-side[data-side="player"]')).toHaveClass(/on/);
  await expect(page.locator('#trial .tr-side[data-side="player"] .tr-name')).toContainText('烈焰龍');
  await expect(page.locator('#trial .tr-side[data-side="cpu"] .tr-name')).toContainText('鐵壁龜');
  await expect(page.locator('#trial .arena button')).toHaveCount(6);
  await expect(page.locator('#trial .arena button[data-id="random"]')).toHaveCount(0);

  // 點「電腦」再點名鑑的疾風鳳：電腦換成疾風鳳，名鑑標出「電」
  await page.locator('#trial .tr-side[data-side="cpu"]').click();
  await expect(page.locator('#trial .tr-side[data-side="cpu"]')).toHaveClass(/on/);
  await page.locator('#trial .card[data-id="gale"]').click();
  await expect(page.locator('#trial .tr-side[data-side="cpu"] .tr-name')).toContainText('疾風鳳');
  await expect(page.locator('#trial .card[data-id="gale"] .badge')).toHaveText('電');
  await expect(page.locator('#trial .detail .d-zh')).toHaveText('疾風鳳');

  // 你的陀螺換盤：「盤」按鈕展開零件清單，換上重量盤 → 按鈕發光、詳細資料換成你的陀螺並疊上原廠輪廓
  await page.locator('#trial .tr-side[data-side="player"] .part-btn[data-slot="disk"]').click();
  await expect(page.locator('#trial .tr-side[data-side="player"]')).toHaveClass(/on/);
  await expect(page.locator('#part-menu')).toBeVisible();
  await page.locator('#part-menu .pm-opt[data-part="heavy"]').click();
  await expect(page.locator('#trial .tr-side[data-side="player"] .part-btn[data-slot="disk"]')).toHaveClass(/changed/);
  await expect(page.locator('#trial .detail .d-zh')).toHaveText('烈焰龍');
  await expect(page.locator('#trial .detail .radar .ghost')).toBeVisible();
  // 場地：標準戰鬥盤（場館跟著換）
  await page.locator('#trial .arena button[data-id="stadium"]').click();
  expect((await dbg(page)).arena).toBe('stadium');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'e2e/screenshots/b0-trial-select.png' });

  // 開始試驗：單戰（HUD 標示「試驗」與雙方陀螺），你贏一戰
  await page.locator('#trial .tr-go').click();
  await expect(page.locator('#trial')).toBeHidden();
  await expect(page.locator('#hud .info')).toHaveText('試驗・標準戰鬥盤');
  await expect(page.locator('#hud .lineup .chip')).toHaveCount(2);
  const cfg = (await dbg(page)).trialCfg!;
  expect(cfg.player).toEqual({ top: 'blaze', loadout: { disk: 'heavy', driver: null } });
  expect(cfg.cpu.top).toBe('gale');
  expect(cfg.arena).toBe('stadium');
  await fightAndFinish(page, 1);
  // 結果：這一戰的數據（終結方式、時間、剩餘轉速、爆裂值、發射力道、必殺、撞擊）與累計戰績
  await expect(page.locator('#trial-result .tr-headline')).toHaveText('YOU WIN!!');
  await expect(page.locator('#trial-result .tr-matchup')).toContainText('烈焰龍（重量盤）');
  await expect(page.locator('#trial-result .tr-matchup')).toContainText('疾風鳳（原廠）');
  await expect(page.locator('#trial-result .tr-stats')).toContainText('BURST FINISH');
  for (const label of ['剩餘轉速', '爆裂值', '發射力道', '必殺', '撞擊']) await expect(page.locator('#trial-result .tr-stats')).toContainText(label);
  await expect(page.locator('#trial-result .tr-record')).toContainText('累計 1 戰：1 勝 0 敗 0 平');
  await page.screenshot({ path: 'e2e/screenshots/b1-trial-result.png' });

  // 同設定再戰：這次你輸，累計到 2 戰
  await page.locator('#trial-result .tr-retry').click();
  await expect(page.locator('#trial-result')).toBeHidden();
  await fightAndFinish(page, 0);
  await expect(page.locator('#trial-result .tr-headline')).toHaveText('YOU LOSE…');
  await expect(page.locator('#trial-result .tr-record')).toContainText('累計 2 戰：1 勝 1 敗 0 平');
  expect((await dbg(page)).trial?.record).toMatchObject({ games: 2, wins: 1, losses: 1 });

  // 電腦自動對打 100 場：進行中顯示進度、其他按鈕停用；打完顯示勝率與終結方式（座位各半）
  await page.locator('#trial-result .tr-auto-run').click();
  await expect(page.locator('#trial-result .tr-auto-box')).toBeVisible();
  await expect(page.locator('#trial-result .tr-retry')).toBeDisabled();
  await expect.poll(async () => (await dbg(page)).lastAutoDuel?.games ?? 0, { timeout: 180_000 }).toBe(100);
  const auto = (await dbg(page)).lastAutoDuel!;
  expect(auto.wins + auto.losses + auto.draws).toBe(100);
  expect(auto.seats).toEqual([50, 50]);
  await expect(page.locator('#trial-result .tr-auto-title')).toContainText('自動對打 100 場');
  await expect(page.locator('#trial-result .tr-rate')).toContainText('勝率');
  await expect(page.locator('#trial-result .tr-retry')).toBeEnabled();
  await page.screenshot({ path: 'e2e/screenshots/b2-trial-auto.png' });

  // 換設定：回到設定畫面（沿用剛才的設定），把盤換回原廠再開打 → 新的一組設定，累計從 1 戰開始
  await page.locator('#trial-result .tr-change').click();
  await expect(page.locator('#trial')).toBeVisible();
  await expect(page.locator('#trial .tr-side[data-side="cpu"] .tr-name')).toContainText('疾風鳳');
  await page.locator('#trial .tr-side[data-side="player"] .part-btn[data-slot="disk"]').click();
  await page.locator('#part-menu .pm-opt[data-part=""]').click();
  await expect(page.locator('#trial .tr-side[data-side="player"] .part-btn[data-slot="disk"]')).not.toHaveClass(/changed/);
  await page.keyboard.press('Enter');
  await expect(page.locator('#trial')).toBeHidden();
  await fightAndFinish(page, 1);
  await expect(page.locator('#trial-result .tr-record')).toContainText('累計 1 戰：1 勝 0 敗 0 平');

  // 回標題
  await page.locator('#trial-result .tr-title').click();
  await expect(page.locator('#title')).toBeVisible();
  expect((await dbg(page)).state).toBe('title');
  expect(errors).toEqual([]);
});

test.describe('手機橫向', () => {
  test.use(phone('Pixel 7 landscape'));
  test('試驗模式的設定畫面與結果畫面都在畫面內，點選操作', async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto('./?seed=42');
    await page.locator('#title .to-trial').tap();
    await expect(page.locator('#trial')).toBeVisible();
    for (const sel of ['#trial .tr-sides', '#trial .cards', '#trial .detail', '#trial .tr-go', '#trial .tr-auto', '#trial .tr-back']) await expectInViewport(page, sel);
    await expectNoHorizontalScroll(page);
    await page.locator('#trial .tr-side[data-side="cpu"]').tap();
    await page.locator('#trial .card[data-id="pegasus"]').tap();
    await expect(page.locator('#trial .tr-side[data-side="cpu"] .tr-name')).toContainText('暴嵐天駒');
    await page.locator('#trial .tr-side[data-side="player"] .part-btn[data-slot="driver"]').tap();
    await expectInViewport(page, '#part-menu');
    // 烈焰龍的原廠軸是橡膠平頭軸，換成針頭軸
    await page.locator('#part-menu .pm-opt[data-part="needle"]').tap();
    await page.screenshot({ path: 'e2e/screenshots/b3-trial-mobile-select.png' });
    // 從設定畫面直接按自動對打：結果畫面只看自動對打，打完顯示勝率
    await page.locator('#trial .tr-auto').tap();
    await expect(page.locator('#trial-result')).toBeVisible();
    await expect(page.locator('#trial-result .tr-headline')).toHaveText('電腦自動對打');
    await expect(page.locator('#trial-result .tr-stats')).toBeHidden();
    await expect.poll(async () => (await dbg(page)).lastAutoDuel?.games ?? 0, { timeout: 180_000 }).toBe(100);
    for (const sel of ['#trial-result .tr-auto-box', '#trial-result .tr-retry', '#trial-result .tr-title']) await expectInViewport(page, sel);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: 'e2e/screenshots/b4-trial-mobile-auto.png' });
  });
});
