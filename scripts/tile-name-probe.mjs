// 名鑑小格英文名的排版比較：用英文版開組隊畫面，在桌機、手機橫向、手機直向分別套用幾種 CSS 寫法，
// 量每個名字有沒有被截斷（單行省略號、單字太長被裁掉、超過兩行被裁掉）、有沒有單字被拆到兩行、
// 名鑑整塊有沒有變高（會不會把「Next」擠出畫面），並截圖到 logs/tile-probe/。
// 用法（PowerShell 7）：node scripts/tile-name-probe.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '@playwright/test';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'logs/tile-probe');

/**
 * 要比較的寫法（只套在英文版）：current 現況（src/style.css；2026-10-05 起是整字換兩行）、small 縮小字級（單行）、
 * wrap 整字換兩行、wrapSmall 整字換兩行＋略縮字級
 */
const OPTIONS = {
  current: '',
  small: `
    html:lang(en) .card.tile .nm { font-size: 10px; letter-spacing: -0.02em; }
    @media (max-height: 520px) { html:lang(en) .card.tile .nm { font-size: 7.5px; } }`,
  wrap: `
    html:lang(en) .card.tile .nm {
      white-space: normal; overflow-wrap: normal; word-break: normal; hyphens: none;
      line-height: 1.1; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; text-overflow: clip;
    }`,
  wrapSmall: `
    html:lang(en) .card.tile .nm {
      white-space: normal; overflow-wrap: normal; word-break: normal; hyphens: none;
      line-height: 1.1; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; text-overflow: clip;
      font-size: 11px;
    }
    @media (max-height: 520px) { html:lang(en) .card.tile .nm { font-size: 8px; } }`,
};

/** 三種畫面 */
const VIEWPORTS = [
  { id: 'desktop', ctx: { viewport: { width: 1280, height: 720 } } },
  { id: 'landscape', ctx: (() => { const { defaultBrowserType: _, ...d } = devices['Pixel 7 landscape']; return d; })() },
  { id: 'portrait', ctx: (() => { const { defaultBrowserType: _, ...d } = devices['Pixel 7']; return d; })() },
];

const server = await createServer({ root: ROOT, server: { port: 5181, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
await mkdir(OUT, { recursive: true });
const rows = [];
try {
  for (const vp of VIEWPORTS) {
    for (const [opt, css] of Object.entries(OPTIONS)) {
      const context = await browser.newContext({ ...vp.ctx, locale: 'en-US' });
      const page = await context.newPage();
      await page.goto(`${url}?seed=7&lang=en`);
      await page.locator('#title .to-cpu').click();
      await page.locator('#select .card.tile').first().waitFor();
      if (css) await page.addStyleTag({ content: css });
      await page.waitForTimeout(400);
      const m = await page.evaluate(() => {
        const names = [...document.querySelectorAll('#select .card.tile .nm')];
        const res = names.map((el) => {
          const text = el.textContent ?? '';
          // 被截斷：水平溢出（單行省略號或單字太長）或垂直溢出（超過兩行被裁）
          const cut = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
          // 單字被拆到兩行：逐字建立範圍，跨兩行的字會有兩個以上的矩形
          let broken = false;
          const node = el.firstChild;
          if (node) {
            let i = 0;
            for (const w of text.split(' ')) {
              const r = document.createRange();
              r.setStart(node, i);
              r.setEnd(node, i + w.length);
              const lines = new Set([...r.getClientRects()].map((c) => Math.round(c.top)));
              if (lines.size > 1) broken = true;
              i += w.length + 1;
            }
          }
          const fs = parseFloat(getComputedStyle(el).fontSize);
          return { text, cut, broken, fs };
        });
        const cards = document.querySelector('#select .cards').getBoundingClientRect();
        const go = document.querySelector('#select .go').getBoundingClientRect();
        return {
          cut: res.filter((r) => r.cut).map((r) => r.text),
          broken: res.filter((r) => r.broken).map((r) => r.text),
          fontPx: res[0]?.fs,
          cardsH: Math.round(cards.height),
          goInView: go.bottom <= window.innerHeight + 0.5 && go.top >= 0,
        };
      });
      await page.locator('#select .cards').screenshot({ path: path.join(OUT, `${vp.id}-${opt}.png`) });
      rows.push({ viewport: vp.id, option: opt, ...m });
      console.log(`${vp.id}\t${opt}\t字級 ${m.fontPx}px\t截斷 ${m.cut.length}\t拆字 ${m.broken.length}\t名鑑高 ${m.cardsH}\tNext 在畫面內 ${m.goInView}${m.cut.length ? `\t（${m.cut.join('、')}）` : ''}`);
      await context.close();
    }
  }
  await writeFile(path.join(OUT, 'result.json'), JSON.stringify(rows, null, 2));
} finally {
  await browser.close();
  await server.close();
}
