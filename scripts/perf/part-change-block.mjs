// 診斷：組隊第 2 步換零件後，頁面主執行緒被卡住多久（換零件會重建絕招示範的陀螺並產生新的 3D 縮圖）。
// 每次換軸後立刻量「頁面多久之後才能回應一次 evaluate」，印出每次的毫秒數、中位數與最大值。
// 用來比較兩個建置（例如改版前後）在 headless 軟體 WebGL 下的差異。
// 用法（PowerShell 7）：先各自跑 vite preview，再：
//   node scripts/perf/part-change-block.mjs http://localhost:4173/ 3
//   node scripts/perf/part-change-block.mjs http://localhost:4174/ 3
import { chromium } from '@playwright/test';

const [base = 'http://localhost:4173/', roundsArg = '3'] = process.argv.slice(2);
/** 依序換上的軸（每一種都是新的組合，會產生新的縮圖） */
const DRIVERS = ['bearing', 'flat', 'taper', 'sharp', 'needle', 'ball'];

/** 跑一輪：開新瀏覽器、選三顆進第 2 步、依序換軸並量每次卡住的時間 */
async function round() {
  const browser = await chromium.launch({
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${base}?seed=31`);
  await page.locator('#title').click();
  for (const id of ['pegasus', 'blaze', 'turtle']) await page.locator(`#select .card[data-id="${id}"]`).click();
  await page.locator('#select .go').click();
  await page.locator('#arrange').waitFor();
  // 等縮圖與示範穩定
  await page.waitForTimeout(4000);
  const times = [];
  for (const d of DRIVERS) {
    await page.locator('#arrange .detail select[data-slot="driver"]').selectOption(d);
    const t0 = Date.now();
    await page.evaluate(() => 0);
    times.push(Date.now() - t0);
    await page.waitForTimeout(1500);
  }
  await browser.close();
  return times;
}

const all = [];
for (let i = 0; i < Number(roundsArg); i++) {
  const t = await round();
  all.push(...t);
  console.log(`第 ${i + 1} 輪（毫秒）：${t.join(', ')}`);
}
all.sort((a, b) => a - b);
console.log(`${base}　中位數 ${all[Math.floor(all.length / 2)]} ms，最大 ${all[all.length - 1]} ms（${all.length} 次）`);
