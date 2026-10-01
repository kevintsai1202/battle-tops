import { chromium, test, type Browser, type Page } from '@playwright/test';

/**
 * 診斷：兩個 headless 瀏覽器（各自軟體 WebGL）同時開遊戲時，各畫面的 fps 與主執行緒回應時間。
 * 用途：線上對戰 e2e 很慢時，分辨是「兩個軟體算圖搶 CPU」還是「遊戲某個畫面本身太重」。
 * 需要先開遊戲預覽（npm run preview，http://localhost:4173）；不需要對戰伺服器（只進線上房間畫面、不連線）。
 * 執行（PowerShell 7）：
 *   npx playwright test --config scripts/net-eval/playwright.config.ts --project chromium -g 兩個瀏覽器
 *   $env:VIEWPORT = '640x360'; npx playwright test --config scripts/net-eval/playwright.config.ts --project chromium -g 兩個瀏覽器; Remove-Item Env:VIEWPORT
 *   $env:DPR = '0.5'; npx playwright test --config scripts/net-eval/playwright.config.ts --project chromium -g 兩個瀏覽器; Remove-Item Env:DPR
 */

const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
/** 視窗大小（環境變數 VIEWPORT，例如 640x360；軟體算圖的成本大致和像素數成正比） */
const [VW, VH] = (process.env.VIEWPORT ?? '1280x720').split('x').map(Number);
/** 裝置像素比（環境變數 DPR，例如 0.5：版面維持原尺寸，畫布只算四分之一的像素） */
const DPR = Number(process.env.DPR ?? 1);
/** 與 playwright.config.ts 相同的軟體 WebGL 參數 */
const ARGS = ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'];

/** 量一段時間內的 fps（遊戲每幀 frames++）與 evaluate 的來回時間 */
async function measure(page: Page, ms = 6000): Promise<{ fps: number; evalMs: number }> {
  const frames = () => page.evaluate(() => (window as unknown as { __game: { frames: number } }).__game.frames);
  const t0 = Date.now();
  const f0 = await frames();
  const e0 = Date.now();
  await page.evaluate(() => 1);
  const evalMs = Date.now() - e0;
  await page.waitForTimeout(ms);
  const f1 = await frames();
  return { fps: +((f1 - f0) / ((Date.now() - t0) / 1000)).toFixed(1), evalMs };
}

/** 開一個瀏覽器與分頁到標題畫面 */
async function open(browsers: Browser[]): Promise<Page> {
  const b = await chromium.launch({ args: ARGS });
  browsers.push(b);
  const page = await (await b.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR })).newPage();
  await page.goto(`${BASE}?seed=1`);
  await page.waitForFunction(() => !!(window as unknown as { __game?: unknown }).__game, null, { timeout: 120_000 });
  return page;
}

test('兩個瀏覽器同時開遊戲：各畫面的 fps 與主執行緒回應', async () => {
  test.setTimeout(600_000);
  const browsers: Browser[] = [];
  const log = (label: string, r: unknown) => console.log(`${label.padEnd(24)} ${JSON.stringify(r)}`);
  try {
    const a = await open(browsers);
    log('畫布像素', await a.evaluate(() => ({ dpr: devicePixelRatio, w: document.querySelector('canvas')?.width, h: document.querySelector('canvas')?.height })));
    log('單一瀏覽器・標題', await measure(a));

    const b = await open(browsers);
    const [ra, rb] = await Promise.all([measure(a), measure(b)]);
    log('兩個瀏覽器・標題 A', ra);
    log('兩個瀏覽器・標題 B', rb);

    // A 進線上房間畫面（不連線）
    await a.locator('#title .to-online').click();
    const [oa, ob] = await Promise.all([measure(a), measure(b)]);
    log('A 線上房間／B 標題 A', oa);
    log('A 線上房間／B 標題 B', ob);

    // B 進 CPU 組隊畫面（20 格 3D 縮圖＋絕招示範）
    await b.locator('#title').click();
    for (let i = 0; i < 3; i++) {
      const [sa, sb] = await Promise.all([measure(a), measure(b)]);
      log(`A 線上房間／B 組隊 ${i} A`, sa);
      log(`A 線上房間／B 組隊 ${i} B`, sb);
    }

    // 只剩 B（組隊畫面）
    await browsers[0].close();
    log('只剩 B・組隊', await measure(b));
  } finally {
    for (const br of browsers) await br.close().catch(() => undefined);
  }
});
