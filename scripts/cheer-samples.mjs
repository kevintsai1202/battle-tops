// 觀眾歡呼試聽：把候選的 CC0 錄音（logs/cheer-candidates/<Freesound ID>.mp3，清單在 list.txt）
// 各剪出最熱烈的一段（RMS 最大的 SECONDS 秒）、加淡入淡出、統一響度，
// 再疊到對戰版 BGM（logs/bgm-samples/noCrowd-battle.wav）的第 3 秒，模擬遊戲裡終結時爆出歡呼。
// 輸出到 logs/cheer-samples/：<ID>-cut.mp3（遊戲用的片段）、<ID>-mix.mp3（疊在 BGM 上）與試聽頁 index.html。
// 用法（PowerShell 7；需要 ffmpeg）：
//   node scripts/cheer-samples.mjs
//   node scripts/cheer-samples.mjs --seconds 3.5 --lufs -21
//   node scripts/cheer-samples.mjs --export 221568   # 用同樣的剪法輸出遊戲用的 public/sfx/cheer.mp3
//     （來源不在 logs/cheer-candidates/ 時，從 Freesound 下載該 ID 的預覽檔 128 kbps mp3）
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : def;
};
/** 片段長度（秒）與響度目標（LUFS） */
const SECONDS = Number(arg('--seconds', '4'));
const LUFS = Number(arg('--lufs', '-21'));
const SRC = path.join(ROOT, 'logs/cheer-candidates');
const OUT = path.join(ROOT, 'logs/cheer-samples');
const BGM = path.join(ROOT, 'logs/bgm-samples/noCrowd-battle.wav');
/** 匯出遊戲用音檔的 Freesound ID（沒給就是產生試聽頁） */
const EXPORT = arg('--export', null);
/** 遊戲用的歡呼音檔 */
const GAME_FILE = path.join(ROOT, 'public/sfx/cheer.mp3');

/** 解碼成單聲道 16 kHz 浮點，找 RMS 最大的 SECONDS 秒視窗的起點（每 0.1 秒試一次） */
async function loudestStart(file) {
  const rate = 16000;
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(rate), '-f', 'f32le', 'pipe:1'], {
    encoding: 'buffer',
    maxBuffer: 512 * 1024 * 1024,
  });
  const x = new Float32Array(stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.byteLength));
  const hop = rate / 10;
  const win = Math.floor(SECONDS * rate);
  // 前綴和：任意視窗的平方和 O(1)
  const pre = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) pre[i + 1] = pre[i] + x[i] * x[i];
  let best = 0;
  let bestE = -1;
  for (let s = 0; s + win <= x.length; s += hop) {
    const e = pre[s + win] - pre[s];
    if (e > bestE) {
      bestE = e;
      best = s;
    }
  }
  return { start: best / rate, length: x.length / rate };
}

/** 剪出一段：從 start 秒起 SECONDS 秒，淡入 0.08 秒、最後淡出，響度統一到 LUFS，48 kHz 立體聲 128 kbps mp3 */
async function cutClip(src, start, out) {
  const fadeOut = Math.min(1.5, SECONDS / 2);
  await run('ffmpeg', [
    '-v', 'error', '-y', '-ss', start.toFixed(2), '-t', String(SECONDS), '-i', src,
    '-af', `afade=t=in:d=0.08,afade=t=out:st=${(SECONDS - fadeOut).toFixed(2)}:d=${fadeOut},loudnorm=I=${LUFS}:TP=-2:LRA=11`,
    '-ar', '48000', '-ac', '2', '-b:a', '128k', out,
  ]);
}

/** 來源錄音：logs/cheer-candidates/<id>.mp3，不在就從 Freesound 的音檔頁找預覽檔網址下載 */
async function sourceOf(id) {
  const file = path.join(SRC, `${id}.mp3`);
  try {
    await readFile(file);
    return file;
  } catch {
    const page = await (await fetch(`https://freesound.org/s/${id}/`, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
    const url = page.match(/https:\/\/cdn\.freesound\.org\/previews\/[^"]*-hq\.mp3/)?.[0];
    if (!url) throw new Error(`找不到 Freesound ${id} 的預覽檔`);
    await mkdir(SRC, { recursive: true });
    await writeFile(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
    console.log(`下載 ${url}`);
    return file;
  }
}

if (EXPORT) {
  const src = await sourceOf(EXPORT);
  const { start } = await loudestStart(src);
  await mkdir(path.dirname(GAME_FILE), { recursive: true });
  await cutClip(src, start, GAME_FILE);
  console.log(`匯出 ${path.relative(ROOT, GAME_FILE)}：Freesound ${EXPORT}，從 ${start.toFixed(2)}s 起 ${SECONDS}s，${LUFS} LUFS`);
  process.exit(0);
}

await mkdir(OUT, { recursive: true });
const list = (await readFile(path.join(SRC, 'list.txt'), 'utf8'))
  .trim()
  .split('\n')
  .map((l) => {
    const [id, title, license] = l.split('|');
    return { id, title, license };
  });
const rows = [];
for (const c of list) {
  const src = path.join(SRC, `${c.id}.mp3`);
  try {
    const { start, length } = await loudestStart(src);
    const cut = path.join(OUT, `${c.id}-cut.mp3`);
    await cutClip(src, start, cut);
    const mix = path.join(OUT, `${c.id}-mix.mp3`);
    await run('ffmpeg', [
      '-v', 'error', '-y', '-i', BGM, '-i', cut,
      '-filter_complex', '[1]adelay=3000|3000[c];[0][c]amix=inputs=2:normalize=0:duration=first',
      '-b:a', '160k', mix,
    ]);
    rows.push({ ...c, start: Number(start.toFixed(2)), length: Number(length.toFixed(1)) });
    console.log(`${c.id}\t${start.toFixed(2)}s 起 ${SECONDS}s（原長 ${length.toFixed(1)}s）\t${c.title}`);
  } catch (e) {
    console.log(`${c.id}\t失敗：${e.message.split('\n')[0]}`);
  }
}
await writeFile(path.join(OUT, 'result.json'), JSON.stringify(rows, null, 2));
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
let html = '<!doctype html><meta charset="utf-8"><title>觀眾歡呼試聽</title>' +
  '<style>body{font-family:system-ui;margin:24px;max-width:1150px}td,th{padding:8px 10px;border-bottom:1px solid #ddd;vertical-align:top;text-align:left}audio{height:32px}small{color:#666}</style>' +
  `<h1>觀眾歡呼試聽（CC0 錄音）</h1><p><small>剪輯：最熱烈的 ${SECONDS} 秒，淡入淡出、響度 ${LUFS} LUFS。疊在 BGM：對戰版 BGM（沒有觀眾底噪）的第 3 秒爆出歡呼。</small></p>` +
  '<table><tr><th>錄音（Freesound ID）</th><th>疊在 BGM 上</th><th>遊戲用的片段</th><th>原始錄音</th></tr>';
for (const r of rows) {
  html += `<tr><td><b>${r.id}</b><br>${esc(r.title)}<br><small>${esc(r.license)}・從 ${r.start}s 剪</small></td>` +
    `<td><audio controls preload="none" src="${r.id}-mix.mp3"></audio></td>` +
    `<td><audio controls preload="none" src="${r.id}-cut.mp3"></audio></td>` +
    `<td><audio controls preload="none" src="../cheer-candidates/${r.id}.mp3"></audio><br><small>${r.length}s</small></td></tr>`;
}
await writeFile(path.join(OUT, 'index.html'), html + '</table>');
console.log(`完成：${rows.length} 個`);
