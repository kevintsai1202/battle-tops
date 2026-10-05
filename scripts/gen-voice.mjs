// 用 Fish Audio TTS 把台詞表生成成語音檔：日文 src/audio/voice-lines.json → public/voice/，
// 中文 src/audio/voice-lines.zh.json → public/voice/zh/，英文 src/audio/voice-lines.en.json → public/voice/en/；
// 操作教學（--lang tutorial）src/audio/tutorial-lines.json → public/voice/tutorial/，
// 英文版的操作教學（--lang tutorial-en）src/audio/tutorial-lines.en.json → public/voice/tutorial/en/。
// 用法（PowerShell 7）：
//   npm run voice
//   npm run voice -- --lang zh
//   npm run voice -- --lang en
//   npm run voice -- --lang tutorial-en
//   npm run voice -- --force
//   npm run voice -- --only countdown_3,go_shoot
//   npm run voice -- --voice announcer=<voiceId> --voice rival=<voiceId>
// 金鑰從環境變數 FISH_API_KEY 讀取（專案根目錄 .env 或 $env:FISH_API_KEY），不會印出。
// 每句另外用 ffmpeg 解碼，記下去掉頭尾靜音後的播放長度（manifest 的 seconds），
// 給單元測試檢查倒數、開場介紹、勝負宣告有沒有超過節拍；快取命中但還沒記長度的句子也會補上（不呼叫 API）。
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { trimmedSeconds } from '../src/audio/trim.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** 各語言的台詞表與輸出資料夾 */
const LANGS = {
  ja: { lines: 'src/audio/voice-lines.json', out: 'public/voice' },
  zh: { lines: 'src/audio/voice-lines.zh.json', out: 'public/voice/zh' },
  en: { lines: 'src/audio/voice-lines.en.json', out: 'public/voice/en' },
  // 操作教學的中文解說（日文版、中文版共用）
  tutorial: { lines: 'src/audio/tutorial-lines.json', out: 'public/voice/tutorial' },
  // 操作教學的英文解說（英文版用）
  'tutorial-en': { lines: 'src/audio/tutorial-lines.en.json', out: 'public/voice/tutorial/en' },
};
const execFileP = promisify(execFile);

const API_URL = 'https://api.fish.audio/v1/tts';
const MODEL = 's2.1-pro-free';
const MAX_RETRY = 5;

/** 解析命令列參數：--lang ja|zh|en|tutorial|tutorial-en、--force、--only a,b、--voice speaker=id（可重複）。 */
function parseArgs(argv) {
  const opts = { lang: 'ja', force: false, only: null, voices: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--lang') {
      opts.lang = String(argv[++i] ?? '');
      if (!LANGS[opts.lang]) throw new Error(`--lang 只能是 ${Object.keys(LANGS).join('、')}`);
    } else if (a === '--force') opts.force = true;
    else if (a === '--only') opts.only = new Set(String(argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--voice') {
      const [sp, id] = String(argv[++i] ?? '').split('=');
      if (!sp || !id) throw new Error('--voice 格式應為 speaker=voiceId');
      opts.voices[sp] = id;
    } else throw new Error(`未知參數：${a}`);
  }
  return opts;
}

/** 計算快取雜湊：sha256(text + voiceId + model) 前 16 碼。 */
function hashOf(text, voiceId) {
  return createHash('sha256').update(text + voiceId + MODEL).digest('hex').slice(0, 16);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 判斷檔案是否存在。 */
async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

/** 讀 manifest，不存在或壞掉時回傳空物件。 */
async function loadManifest(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return {}; }
}

/**
 * 遊戲裡實際播放的長度（秒）：ffmpeg 解碼第一聲道成 32-bit float，套用與 VoicePlayer 相同的頭尾靜音裁切。
 * 沒有 ffmpeg 或解碼失敗時回傳 null（不影響生成）。
 */
async function playSeconds(file) {
  const rate = 48000;
  try {
    const { stdout } = await execFileP(
      'ffmpeg',
      ['-v', 'error', '-i', file, '-af', 'pan=mono|c0=c0', '-ar', String(rate), '-f', 'f32le', 'pipe:1'],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
    );
    // Buffer 的位移不一定對齊 4 位元組，複製一份再轉 Float32Array
    const samples = new Float32Array(stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.byteLength));
    return Number(trimmedSeconds(samples, rate).toFixed(3));
  } catch {
    return null;
  }
}

/**
 * 呼叫 Fish TTS 取得音訊 Buffer。
 * 429 / 5xx 讀 Retry-After 後以指數退避重試，最多 MAX_RETRY 次。
 */
async function synthesize(key, text, voiceId) {
  const body = JSON.stringify({
    text, reference_id: voiceId, format: 'mp3', mp3_bitrate: 128, normalize: true, latency: 'normal',
  });
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, model: MODEL, 'Content-Type': 'application/json' },
        body,
      });
    } catch (e) {
      if (attempt >= MAX_RETRY) throw e;
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const retryable = res.status === 429 || res.status >= 500;
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    if (!retryable || attempt >= MAX_RETRY) throw new Error(`HTTP ${res.status} ${detail}`);
    const ra = Number(res.headers.get('retry-after'));
    const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * 2 ** attempt;
    console.log(`  HTTP ${res.status}，${wait}ms 後重試（${attempt + 1}/${MAX_RETRY}）`);
    await sleep(wait);
  }
}

/** 主流程：逐句序列生成，維護 manifest，最後印總結並依失敗數決定 exit code。 */
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const key = process.env.FISH_API_KEY;
  if (!key) throw new Error('缺少環境變數 FISH_API_KEY（寫進專案根目錄 .env，或先設定 $env:FISH_API_KEY）');

  const LINES_FILE = path.join(ROOT, LANGS[opts.lang].lines);
  const OUT_DIR = path.join(ROOT, LANGS[opts.lang].out);
  const MANIFEST_FILE = path.join(OUT_DIR, 'manifest.json');
  const data = JSON.parse(await readFile(LINES_FILE, 'utf8'));
  const speakers = data.speakers;
  await mkdir(OUT_DIR, { recursive: true });
  const manifest = await loadManifest(MANIFEST_FILE);
  console.log(`語言：${opts.lang}（${path.relative(ROOT, LINES_FILE)} → ${path.relative(ROOT, OUT_DIR)}）`);

  if (opts.only) {
    const unknown = [...opts.only].filter((id) => !data.lines[id]);
    if (unknown.length) throw new Error(`--only 含不存在的 id：${unknown.join(',')}`);
  }
  for (const sp of Object.keys(opts.voices)) {
    if (!speakers[sp]) throw new Error(`--voice 指定的角色不存在：${sp}`);
  }

  let made = 0, cached = 0, failed = 0;
  for (const [id, line] of Object.entries(data.lines)) {
    if (opts.only && !opts.only.has(id)) continue;
    const voiceId = opts.voices[line.speaker] ?? speakers[line.speaker]?.voiceId;
    if (!voiceId) { console.log(`${id}\t失敗：找不到角色 ${line.speaker}`); failed++; continue; }
    const file = `${id}.mp3`;
    const hash = hashOf(line.text, voiceId);
    if (!opts.force && manifest[id]?.hash === hash && (await exists(path.join(OUT_DIR, file)))) {
      // 舊的 manifest 沒有播放長度：補算（不呼叫 API）
      if (manifest[id].seconds == null) {
        const seconds = await playSeconds(path.join(OUT_DIR, file));
        if (seconds != null) {
          manifest[id] = { ...manifest[id], seconds };
          await writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
        }
      }
      console.log(`${id}\t快取命中，跳過\t${manifest[id].seconds ?? '?'}s`);
      cached++;
      continue;
    }
    const t0 = Date.now();
    try {
      const buf = await synthesize(key, line.text, voiceId);
      await writeFile(path.join(OUT_DIR, file), buf);
      const seconds = await playSeconds(path.join(OUT_DIR, file));
      manifest[id] = { file, text: line.text, speaker: line.speaker, voiceId, hash, ...(seconds != null ? { seconds } : {}) };
      await writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2)); // 每句即存，中斷也不丟進度
      console.log(`${id}\t${buf.length} bytes\t${Date.now() - t0}ms\t${seconds ?? '?'}s`);
      made++;
    } catch (e) {
      console.log(`${id}\t失敗：${e.message}`);
      failed++;
    }
  }
  console.log(`總結：生成 ${made}、快取跳過 ${cached}、失敗 ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e.message); process.exit(1); });
