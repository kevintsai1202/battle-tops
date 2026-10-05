// 版面量測：用手機橫向（Pixel 7 landscape）分別打開各語言的組隊第 1 步，印出畫面上主要區塊的位置與高度，
// 比較不同語言的文字長度造成的版面差異（例如英文說明換行把「下一步」擠出畫面）。
// 用法（PowerShell 7；先 npm run build，再另開視窗 npm run preview）：
//   node scripts/layout-probe.mjs
//   node scripts/layout-probe.mjs --langs ja,zh,en --device "Pixel 7 landscape"
import { chromium, devices } from '@playwright/test';

/** 解析命令列：要量的語言與裝置 */
const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : def;
};
const LANGS = arg('--langs', 'zh,en').split(',');
const DEVICE = arg('--device', 'Pixel 7 landscape');
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
/** 要量的區塊（組隊第 1 步） */
const SELECTORS = ['#select', '#select h2', '#select h2 small', '#select .select-row', '#select .difficulty', '#select .arena', '#select .cpu-team', '#select .arena-desc', '#select .select-main', '#select .cards', '#select .detail', '#select .team-bar', '#select .go'];

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
try {
  for (const l of LANGS) {
    const { defaultBrowserType: _, ...dev } = devices[DEVICE];
    const page = await (await browser.newContext({ ...dev, locale: 'ja-JP' })).newPage();
    await page.goto(`${BASE}?seed=63&lang=${l}`);
    await page.locator('#title .to-cpu').tap();
    await page.locator('#select').waitFor({ state: 'visible' });
    await page.waitForTimeout(1500);
    const vp = page.viewportSize();
    console.log(`\n=== ${l}（${DEVICE} ${vp.width}×${vp.height}）`);
    for (const sel of SELECTORS) {
      const b = await page.locator(sel).first().boundingBox();
      console.log(`${sel.padEnd(24)} ${b ? `x=${b.x.toFixed(0).padStart(4)} y=${b.y.toFixed(0).padStart(4)} h=${b.height.toFixed(0).padStart(4)} bottom=${(b.y + b.height).toFixed(0).padStart(4)} w=${b.width.toFixed(0)}` : '（看不到）'}`);
    }
    await page.context().close();
  }
} finally {
  await browser.close();
}
