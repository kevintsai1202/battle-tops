// 背景音樂試聽檔產生器：啟動 Vite 開發伺服器，用 Playwright 開 scripts/bgm-preview/（離線合成，不會出聲），
// 每個版本各合成「選單版」與「對戰版」，存成 WAV，並產生試聽頁 index.html（附整體音量與高頻能量）。可在指定時間播一聲觀眾歡呼，確認遊戲裡的音量。
// 用法（PowerShell 7）：
//   node scripts/render-bgm.mjs                        # 全部版本 → logs/bgm-samples/
//   node scripts/render-bgm.mjs --only now --out logs/bgm-baseline
//   node scripts/render-bgm.mjs --seconds 16
// 版本定義在 scripts/bgm-preview/main.ts 的 VARIANTS（目前的 BGM、BGM＋歡呼、只有歡呼）。
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** 讀命令列參數 */
const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : def;
};
const OUT = path.resolve(ROOT, arg('--out', 'logs/bgm-samples'));
const ONLY = arg('--only', null)?.split(',') ?? null;
const SECONDS = Number(arg('--seconds', '12'));
/** 兩種畫面：選單畫面的輕量版、對戰中的完整版 */
const SCENES = [
  { id: 'select', intense: false, label: '選單畫面' },
  { id: 'battle', intense: true, label: '對戰中' },
];

const server = await createServer({ root: ROOT, server: { port: 5179, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`${url}scripts/bgm-preview/index.html`);
  await page.waitForFunction(() => 'bgmPreview' in window, null, { timeout: 30_000 });
  const variants = (await page.evaluate(() => window.bgmPreview.variants)).filter((v) => !ONLY || ONLY.includes(v.id));
  await mkdir(OUT, { recursive: true });
  const rows = [];
  for (const v of variants) {
    for (const s of SCENES) {
      const t0 = Date.now();
      const clip = await page.evaluate(([id, intense, sec]) => window.bgmPreview.render(id, intense, sec), [v.id, s.intense, SECONDS]);
      const file = `${v.id}-${s.id}.wav`;
      await writeFile(path.join(OUT, file), Buffer.from(clip.wav, 'base64'));
      rows.push({ variant: v.id, label: v.label, scene: s.id, file, rmsDb: clip.rmsDb, hfDb: clip.hfDb });
      console.log(`${file}\tRMS ${clip.rmsDb} dB\t4kHz 以上 ${clip.hfDb} dB\t${Date.now() - t0}ms`);
    }
  }
  await writeFile(path.join(OUT, 'result.json'), JSON.stringify(rows, null, 2));
  // 試聽頁：每個版本一列，選單版與對戰版各一個播放器
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  let html = '<!doctype html><meta charset="utf-8"><title>BGM 試聽</title>' +
    '<style>body{font-family:system-ui;margin:24px;max-width:1100px}td,th{padding:8px 10px;border-bottom:1px solid #ddd;vertical-align:top;text-align:left}audio{height:32px}small{color:#666}</style>' +
    `<h1>背景音樂試聽（每段 ${SECONDS} 秒）</h1>` +
    '<p><small>RMS：整體音量（dBFS）。高頻：4 kHz 以上的能量相對整體（dB），越負越不刺耳。</small></p><table><tr><th>版本</th>';
  for (const s of SCENES) html += `<th>${s.label}</th>`;
  html += '</tr>';
  for (const v of variants) {
    html += `<tr><td><b>${esc(v.id)}</b><br>${esc(v.label)}</td>`;
    for (const s of SCENES) {
      const r = rows.find((x) => x.variant === v.id && x.scene === s.id);
      html += `<td><audio controls preload="none" src="${r.file}"></audio><br><small>RMS ${r.rmsDb} dB・高頻 ${r.hfDb} dB</small></td>`;
    }
    html += '</tr>';
  }
  await writeFile(path.join(OUT, 'index.html'), html + '</table>');
  console.log(`完成：${path.relative(ROOT, OUT)}（${rows.length} 段）`);
} finally {
  await browser.close();
  await server.close();
}
