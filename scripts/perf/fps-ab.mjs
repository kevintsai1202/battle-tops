// 診斷：比較兩個建置在 headless 軟體 WebGL 下的影格速度（每秒幾格）。
// 每一輪開新瀏覽器跑展示模式（練習場），量「對戰中」與「終結後（特寫鏡頭＋後製）」各幾秒內前進的影格數。
// 用來判斷 e2e 變慢是程式造成的，還是機器當下比較慢（兩個建置輪流跑，機器狀態相同）。
// 用法（PowerShell 7）：先各自跑 vite preview（例如舊版在 4174、新版在 4173），再：
//   node scripts/perf/fps-ab.mjs http://localhost:4174/ http://localhost:4173/ 3
import { chromium } from '@playwright/test';

const [a = 'http://localhost:4174/', b = 'http://localhost:4173/', roundsArg = '3'] = process.argv.slice(2);

/** 等 ms 毫秒 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 量一個建置一輪：回傳對戰中與終結後的每秒影格數 */
async function measure(base) {
  const browser = await chromium.launch({
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${base}?demo=1&seed=5&arena=practice&p=blaze&c=gale`);
  await page.waitForFunction(() => window.__game?.debug().state === 'battle', null, { timeout: 90_000 });
  const frames = () => page.evaluate(() => window.__game.debug().frames);
  // 對戰中：等 2 秒穩定後量 6 秒
  await sleep(2000);
  let f0 = await frames();
  let t0 = Date.now();
  await sleep(6000);
  const battle = ((await frames()) - f0) / ((Date.now() - t0) / 1000);
  // 終結後：把電腦的爆裂值灌滿，量 5 秒
  await page.evaluate(() => (window.__game.sim.tops[1].burst = 1));
  await page.waitForFunction(() => window.__game.debug().state === 'roundEnd', null, { timeout: 30_000 });
  f0 = await frames();
  t0 = Date.now();
  await sleep(5000);
  const finish = ((await frames()) - f0) / ((Date.now() - t0) / 1000);
  await browser.close();
  return { battle, finish };
}

const rows = [];
for (let i = 0; i < Number(roundsArg); i++) {
  for (const [label, base] of [
    ['A', a],
    ['B', b],
  ]) {
    const r = await measure(base);
    rows.push({ label, ...r });
    console.log(`${label} 第 ${i + 1} 輪：對戰中 ${r.battle.toFixed(1)} fps、終結後 ${r.finish.toFixed(1)} fps`);
  }
}
for (const label of ['A', 'B']) {
  const mine = rows.filter((r) => r.label === label);
  const avg = (k) => mine.reduce((s, r) => s + r[k], 0) / mine.length;
  console.log(`${label} 平均：對戰中 ${avg('battle').toFixed(1)} fps、終結後 ${avg('finish').toFixed(1)} fps`);
}
