// 用 Groq Whisper 對 public/voice/*.mp3 做聽寫抽查，與台詞原文（去語氣標記）比對字元相似度。
// 用法（PowerShell 7）：
//   node --env-file=../transcript-review/.env scripts/check-voice.mjs
// 結果表存到 logs/voice-check.json。金鑰讀環境變數 GROQ_API_KEY，不會印出。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VOICE_DIR = path.join(ROOT, 'public/voice');
const OUT_FILE = path.join(ROOT, 'logs/voice-check.json');
const API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MAX_RETRY = 6;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 去掉方括號語氣標記，供比對與顯示。 */
const stripTags = (s) => s.replace(/\[[^\]]*\]/g, '').trim();

/** 正規化：去標記、長音符、標點、空白、中黑點，片假名轉平假名，供相似度比較。 */
function normalize(s) {
  return stripTags(s)
    .replace(/[ー－―\-・･\s、。，,.！!？?…「」『』（）()〜~]/g, '')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .toLowerCase();
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
async function transcribe(key, file) {
  const buf = await readFile(path.join(VOICE_DIR, file));
  for (let attempt = 0; ; attempt++) {
    const form = new FormData();
    form.append('file', new Blob([buf], { type: 'audio/mpeg' }), file);
    form.append('model', 'whisper-large-v3');
    form.append('language', 'ja');
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
 * 主流程：逐句聽寫、算相似度、印表並寫入 logs/voice-check.json。
 * 參數 --only id1,id2 只抽查指定台詞（結果另存 logs/voice-check-only.json，不覆蓋全量結果）。
 */
async function main() {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('缺少環境變數 GROQ_API_KEY');
  const manifest = JSON.parse(await readFile(path.join(VOICE_DIR, 'manifest.json'), 'utf8'));
  const oi = process.argv.indexOf('--only');
  const only = oi > 0 ? new Set(process.argv[oi + 1].split(',')) : null;
  const rows = [];
  for (const [id, m] of Object.entries(manifest)) {
    if (only && !only.has(id)) continue;
    const expected = stripTags(m.text);
    let heard = '', error = null;
    try { heard = await transcribe(key, m.file); } catch (e) { error = e.message; }
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
