// 用 Groq Whisper 對語音檔做聽寫抽查，與台詞原文（去語氣標記）比對字元相似度。
// 日文抽查 public/voice/*.mp3，中文（--lang zh）抽查 public/voice/zh/*.mp3。
// 用法（PowerShell 7）：
//   node --env-file=../transcript-review/.env scripts/check-voice.mjs
//   node --env-file=../transcript-review/.env scripts/check-voice.mjs --lang zh
//   node --env-file=../transcript-review/.env scripts/check-voice.mjs --lang zh --only go_shoot,countdown_3
// 結果表存到 logs/voice-check.json（中文是 logs/voice-check-zh.json）。金鑰讀環境變數 GROQ_API_KEY，不會印出。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/**
 * 各語言的音檔位置、Whisper 語言與結果檔。
 * 中文加上繁體提示：沒有提示時 Whisper 常輸出簡體字，相似度會無故變低。
 */
const LANGS = {
  ja: { dir: 'public/voice', whisper: 'ja', prompt: null, out: 'logs/voice-check.json' },
  zh: { dir: 'public/voice/zh', whisper: 'zh', prompt: '以下是繁體中文的句子。', out: 'logs/voice-check-zh.json' },
  tutorial: { dir: 'public/voice/tutorial', whisper: 'zh', prompt: '以下是繁體中文的句子。', out: 'logs/voice-check-tutorial.json' },
};
const API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MAX_RETRY = 6;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 去掉方括號語氣標記，供比對與顯示。 */
const stripTags = (s) => s.replace(/\[[^\]]*\]/g, '').trim();

/**
 * 正規化：去標記、長音符、破折號、標點、空白、中黑點，片假名轉平假名，
 * 阿拉伯數字轉成中文數字（Whisper 常把「三！」聽寫成「3.」），供相似度比較。
 */
function normalize(s) {
  return stripTags(s)
    .replace(/[ー－―—\-・･\s、。，,.！!？?…「」『』（）()〜~：:；;]/g, '')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[0-9]/g, (d) => '〇一二三四五六七八九'[Number(d)])
    .toLowerCase()
    // 中文版的倒數喊英文（Three! Two! One!），Whisper 常寫成阿拉伯數字：英文數字也換成中文數字再比
    .replace(/three/g, '三')
    .replace(/two/g, '二')
    .replace(/one/g, '一');
}

/** Levenshtein 編輯距離（以 code point 為單位）。 */
function editDistance(a, b) {
  const x = [...a], y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

/** 字元相似度 = 1 - 編輯距離 / 較長字串長度。 */
function similarity(a, b) {
  const n = Math.max([...a].length, [...b].length);
  return n === 0 ? 1 : 1 - editDistance(a, b) / n;
}

/** 呼叫 Groq Whisper 聽寫單一檔案；429/5xx 依 Retry-After 或指數退避重試。 */
async function transcribe(key, file, lang) {
  const buf = await readFile(path.join(ROOT, lang.dir, file));
  for (let attempt = 0; ; attempt++) {
    const form = new FormData();
    form.append('file', new Blob([buf], { type: 'audio/mpeg' }), file);
    form.append('model', 'whisper-large-v3');
    form.append('language', lang.whisper);
    if (lang.prompt) form.append('prompt', lang.prompt);
    form.append('temperature', '0');
    const res = await fetch(API_URL, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
    if (res.ok) return (await res.json()).text ?? '';
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= MAX_RETRY) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const ra = Number(res.headers.get('retry-after'));
    const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 + 500 : 3000 * 2 ** attempt;
    console.log(`  HTTP ${res.status}，${wait}ms 後重試`);
    await sleep(wait);
  }
}

/**
 * 主流程：逐句聽寫、算相似度、印表並寫入結果檔。
 * 參數 --lang ja|zh 選語言（預設 ja）；--only id1,id2 只抽查指定台詞（結果另存 *-only.json，不覆蓋全量結果）。
 */
async function main() {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('缺少環境變數 GROQ_API_KEY');
  const li = process.argv.indexOf('--lang');
  const langId = li > 0 ? process.argv[li + 1] : 'ja';
  const lang = LANGS[langId];
  if (!lang) throw new Error(`--lang 只能是 ${Object.keys(LANGS).join('、')}`);
  const OUT_FILE = path.join(ROOT, lang.out);
  const manifest = JSON.parse(await readFile(path.join(ROOT, lang.dir, 'manifest.json'), 'utf8'));
  const oi = process.argv.indexOf('--only');
  const only = oi > 0 ? new Set(process.argv[oi + 1].split(',')) : null;
  const rows = [];
  for (const [id, m] of Object.entries(manifest)) {
    if (only && !only.has(id)) continue;
    const expected = stripTags(m.text);
    let heard = '', error = null;
    try { heard = await transcribe(key, m.file, lang); } catch (e) { error = e.message; }
    const score = error ? null : Number(similarity(normalize(expected), normalize(heard)).toFixed(3));
    rows.push({ id, speaker: m.speaker, tags: (m.text.match(/\[[^\]]*\]/g) ?? []).join(''), expected, heard, similarity: score, error });
    console.log(`${id}\t${score ?? 'ERR'}\t${expected}\t=>\t${heard}${error ? ' ' + error : ''}`);
  }
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(only ? OUT_FILE.replace('.json', '-only.json') : OUT_FILE, JSON.stringify(rows, null, 2));
  const low = rows.filter((r) => r.similarity === null || r.similarity < 0.8);
  console.log(`總結：共 ${rows.length} 句，< 0.8 或失敗 ${low.length} 句`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
