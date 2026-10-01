import { expect, test, type Page } from '@playwright/test';
import { arrangeOrder } from './team.helpers';

/**
 * 端對端驗收：在真的瀏覽器裡跑遊戲，確認撞擊特寫、特效、音效與日語語音真的有發生。
 * 畫面截圖存到 e2e/screenshots/，供人工檢視特效外觀。
 * 執行：npm run build; npx playwright test
 */

type Snapshot = {
  state: string;
  frames: number;
  clock: number;
  round: number;
  score: [number, number];
  director: { mode: string; timeScale: number; closeups: number; progress: number };
  counters: { clashes: number; bigClashes: number; finishes: number; specials: number; rounds: number; dashes: number };
  sparks: number;
  sfx: number;
  audioLevel: number;
  audioState: string;
  voice: { mode: string; played: number; last: string | null };
  launch: { ratio: number; label: string };
};

/** 讀取遊戲的除錯快照 */
function snap(page: Page): Promise<Snapshot> {
  return page.evaluate(() => (window as unknown as { __game: { debug(): Snapshot } }).__game.debug());
}

/** 除錯暫停：時間停住但畫面照常渲染，用來在特寫當下定格截圖 */
async function setPaused(page: Page, on: boolean): Promise<void> {
  await page.evaluate((v) => ((window as unknown as { __game: { paused: boolean } }).__game.paused = v), on);
}

/** 收集頁面錯誤與 console error，測試最後斷言為空 */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  // 錯誤當下就印出來，測試中途逾時也看得到原因
  page.on('pageerror', (e) => {
    errors.push(String(e));
    console.log('[pageerror]', String(e));
  });
  page.on('console', (m) => {
    if (m.type() === 'error') {
      errors.push(m.text());
      console.log('[console.error]', m.text());
    }
  });
  return errors;
}

test('展示模式：撞擊觸發特寫慢動作、火花、音效與日語語音，並打到回合終結', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./?demo=1&seed=42&p=blaze&c=wolf');

  // 語音來源必須是預先生成的 Fish Audio 音檔（本機沒有日語系統語音，退路等於沒聲音）
  await page.waitForFunction(() => !!(window as any).__game && (window as any).__game.debug().voice.mode !== 'none', null, { timeout: 30_000 });
  const boot = await snap(page);
  expect(boot.voice.mode).toBe('fish-files');
  expect(boot.audioState).toBe('running');

  // 倒數畫面
  await page.waitForFunction(() => (window as any).__game.debug().state === 'launch');
  await page.waitForTimeout(1800);
  await page.screenshot({ path: 'e2e/screenshots/01-countdown.png' });

  // 等到撞擊特寫發生：在同一個瀏覽器回呼裡暫停並取快照，避免截圖期間特寫已結束
  const closeHandle = await page.waitForFunction(
    () => {
      const g = (window as any).__game;
      const d = g.debug();
      if (d.director.mode !== 'closeup' || d.director.progress < 0.3 || d.director.timeScale > 0.3) return null;
      g.paused = true;
      return d;
    },
    null,
    { timeout: 90_000, polling: 'raf' },
  );
  const close = (await closeHandle.jsonValue()) as Snapshot;
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'e2e/screenshots/02-closeup.png' });
  expect(close.director.timeScale).toBeLessThan(0.3);
  expect(close.counters.bigClashes).toBeGreaterThan(0);
  expect(close.sparks).toBeGreaterThan(0);
  expect(close.sfx).toBeGreaterThan(0);
  // 主輸出真的有訊號（RMS 峰值），不是只有計數器在跳
  expect(close.audioLevel).toBeGreaterThan(0.01);
  console.log(`主輸出 RMS 峰值：${close.audioLevel.toFixed(3)}`);
  console.log(`特寫觸發時：遊戲時間 ${close.clock.toFixed(1)}s、已渲染 ${close.frames} 格（約 ${(close.frames / close.clock).toFixed(1)} fps）`);
  await setPaused(page, false);

  // 特寫結束後回到全景
  await page.waitForFunction(() => (window as any).__game.debug().director.mode !== 'closeup', null, { timeout: 20_000 });
  await page.screenshot({ path: 'e2e/screenshots/03-overview.png' });

  // 打到回合終結，同樣定格截圖
  await page.waitForFunction(
    () => {
      const g = (window as any).__game;
      if (g.debug().counters.finishes === 0) return false;
      g.paused = true;
      return true;
    },
    null,
    { timeout: 120_000, polling: 'raf' },
  );
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'e2e/screenshots/04-finish.png' });
  await setPaused(page, false);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'e2e/screenshots/05-finish-cam.png' });

  const end = await snap(page);
  // 倒數 3 句 + ゴー・シュート + 撞擊或終結台詞，至少 5 句
  expect(end.voice.played).toBeGreaterThanOrEqual(5);
  expect(end.counters.clashes).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('玩家流程：標題 → 組隊 → 抓時機發射 → 推移操控', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./?seed=7');
  await page.screenshot({ path: 'e2e/screenshots/10-title.png' });

  await page.locator('#title').click();
  await expect(page.locator('#select')).toBeVisible();
  await page.waitForFunction(() => (window as any).__game.debug().voice.mode !== 'none', null, { timeout: 30_000 });
  // 組隊：名鑑前三顆（烈焰龍 → 鐵壁龜 → 疾風鳳），小格右上角依序顯示 1、2、3
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.locator('#select .card .badge')).toHaveText(['1', '2', '3', ...Array(17).fill('')]);
  // 右側詳細資料：游標在第三顆（疾風鳳），有雷達圖與必殺技說明
  await expect(page.locator('#select .detail .d-zh')).toHaveText('疾風鳳');
  await expect(page.locator('#select .detail .radar')).toBeVisible();
  await expect(page.locator('#select .go')).toBeEnabled();
  await expect(page.locator('.cpu-team .chip')).toHaveCount(3);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'e2e/screenshots/11-select.png' });
  await page.keyboard.press('Enter');

  // 第 2 步（出場順序與零件）：Shift＋↓ 把第 1 戰的烈焰龍往後調一戰，Enter 出陣
  await expect(page.locator('#arrange')).toBeVisible();
  await expect(page.locator('#arrange .ar-slot')).toHaveCount(3);
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(() => arrangeOrder(page)).toEqual(['turtle', 'blaze', 'gale']);
  await page.screenshot({ path: 'e2e/screenshots/11b-arrange.png' });
  await page.keyboard.press('Enter');
  await expect(page.locator('#arrange')).toBeHidden();

  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#hud .info')).toHaveText('BATTLE 1/3・練習場');
  await expect(page.locator('#hud .lineup .chip')).toHaveCount(6);
  await page.waitForFunction(() => (window as any).__game.debug().state === 'launch');
  // 看到「ゴー・シュート!!」大字時立刻按 Space（簡易發射，力道最高 85%）
  await page.locator('#banner .bn', { hasText: 'ゴー' }).waitFor({ timeout: 45_000 });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => (window as any).__game.debug().state === 'battle', null, { timeout: 10_000 });
  const s = await snap(page);
  // 第 1 戰上場的是調換順序後的鐵壁龜
  expect((s as unknown as { tops: { id: string }[] }).tops[0].id).toBe('turtle');
  expect(s.launch.ratio).toBeGreaterThanOrEqual(0.5);
  expect(s.launch.ratio).toBeLessThanOrEqual(0.85);
  expect(s.launch.label).not.toBe('');

  // Shift＋方向鍵衝刺：按一次衝一次；按住 Shift 時系統送的自動重複 keydown（repeat）不會連續衝刺
  const dashes0 = (await snap(page)).counters.dashes;
  await page.keyboard.down('w');
  await page.keyboard.press('Shift');
  await expect.poll(async () => (await snap(page)).counters.dashes, { timeout: 5000 }).toBe(dashes0 + 1);
  await page.evaluate(() => {
    const g = (window as any).__game;
    g.sim.lastDash[g.me] = -10; // 冷卻歸零：這時若照單全收 repeat 就會再衝一次
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true, repeat: true }));
  });
  await page.waitForTimeout(800);
  expect((await snap(page)).counters.dashes).toBe(dashes0 + 1);
  await page.keyboard.up('w');

  // 必殺技：把量表灌滿後按 Space，確認 cut-in 出現並觸發必殺事件
  await page.evaluate(() => ((window as any).__game.sim.tops[0].special = 1));
  await page.keyboard.press('Space');
  await expect(page.locator('#cutin')).toBeVisible({ timeout: 3000 });
  // 暫停遊戲，並把 CSS 動畫定格在橫幅滑入後的位置再截圖（headless 很慢，不定格會錯過）
  await page.evaluate(() => {
    (window as any).__game.paused = true;
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = 500;
    }
  });
  await page.screenshot({ path: 'e2e/screenshots/13-special-cutin.png' });
  await page.evaluate(() => {
    for (const a of document.getAnimations()) a.play();
    (window as any).__game.paused = false;
  });
  expect((await snap(page)).counters.specials).toBeGreaterThan(0);

  // 按住 W 推移一秒，確認對戰持續進行
  await page.keyboard.down('w');
  await page.waitForTimeout(1000);
  await page.keyboard.up('w');
  await page.screenshot({ path: 'e2e/screenshots/12-battle-hud.png' });
  const b = await snap(page);
  expect(['battle', 'roundEnd', 'launch']).toContain(b.state);
  expect(errors).toEqual([]);
});
