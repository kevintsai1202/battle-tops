import { expect, test } from '@playwright/test';

/**
 * 線上對戰伺服器的連線檢查（部署後跑）：從 GitHub Pages 的遊戲頁面（真正的來源 https://kevintsai1202.github.io）
 * 開 wss 連線到伺服器，在已開啟的連線上量 30 次來回延遲；另外確認不在白名單的來源會被拒絕。
 * 執行（PowerShell）：
 *   npx playwright test --config scripts/net-eval/playwright.config.ts --project chromium -g 線上伺服器
 * 伺服器網址可用環境變數 GAME_SERVER 覆寫（預設 wss://battle-tops.zeabur.app/ws）。
 */

const SERVER = process.env.GAME_SERVER ?? 'wss://battle-tops.zeabur.app/ws';

test('線上伺服器：從遊戲網頁連得上 wss，量開啟連線上的來回延遲', async ({ page }) => {
  test.setTimeout(120_000);
  // 遊戲首頁在 headless 軟體算圖下主執行緒被 3D 畫面佔滿，收到的訊息要排隊等畫格結束，
  // 量到的會是約 500 ms 的假延遲（2026-10-01 實測；Node 客戶端同時量到 45 ms），所以量之前先停掉繪圖迴圈。
  // （GitHub Pages 的 404 頁有內容安全政策會擋 WebSocket，不能拿來當輕量頁面。）
  await page.goto('https://kevintsai1202.github.io/battle-tops/');
  await page.waitForFunction(() => !!(window as any).__game);
  await page.evaluate(() => (window as any).__game.gfx.renderer.setAnimationLoop(null));
  const result = await page.evaluate(async (url) => {
    const ws = new WebSocket(url);
    await new Promise<void>((ok, fail) => {
      ws.onopen = () => ok();
      ws.onerror = () => fail(new Error('連線失敗'));
    });
    const rtts: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      ws.send(JSON.stringify({ t: 'ping', c: t0 }));
      await new Promise<void>((ok) => {
        ws.onmessage = () => ok();
      });
      rtts.push(performance.now() - t0);
      await new Promise((r) => setTimeout(r, 100));
    }
    ws.close();
    rtts.sort((a, b) => a - b);
    return { origin: location.origin, median: rtts[15], p90: rtts[27], min: rtts[0], max: rtts[29] };
  }, SERVER);
  console.log(`來源 ${result.origin} → ${SERVER}：來回延遲 中位 ${result.median.toFixed(1)} ms、90% ${result.p90.toFixed(1)} ms、最小 ${result.min.toFixed(1)}、最大 ${result.max.toFixed(1)}`);
  expect(result.median).toBeLessThan(200);
});

test('線上伺服器：不在白名單的來源連不上', async ({ page }) => {
  await page.goto('https://example.com/');
  const opened = await page.evaluate(
    (url) =>
      new Promise<boolean>((done) => {
        const ws = new WebSocket(url);
        ws.onopen = () => done(true);
        ws.onerror = () => done(false);
      }),
    SERVER,
  );
  expect(opened).toBe(false);
});
