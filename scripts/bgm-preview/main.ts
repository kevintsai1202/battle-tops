import { CHEER_LEVEL } from '../../src/audio/cheer';
import { AudioEngine } from '../../src/audio/engine';

/**
 * 背景音樂試聽的離線合成（瀏覽器端）：用遊戲真正的音效引擎，在 OfflineAudioContext 裡排好一段 BGM（與觀眾歡呼），
 * 合成成 WAV，並量整體音量與高頻能量（4 kHz 以上佔多少）。由 scripts/render-bgm.mjs 呼叫，結果存到 logs/。
 */

/** 取樣率：和一般裝置一樣 */
const RATE = 48000;

/** 一段合成結果：WAV（base64）、整體 RMS（dBFS）、4 kHz 以上的能量相對整體（dB，越負越不刺耳） */
interface Clip {
  wav: string;
  rmsDb: number;
  hfDb: number;
}

/**
 * 試聽的版本：代號、說明、要不要把 BGM 關掉（只聽歡呼），以及在第幾秒播一聲終結時的觀眾歡呼
 * （錄音，經過遊戲真正的音效引擎與主輸出壓縮器，用來確認遊戲裡的音量）。
 */
export const VARIANTS: { id: string; label: string; muteMusic?: boolean; cheerAt?: number }[] = [
  { id: 'now', label: '目前的 BGM（沒有觀眾音）' },
  { id: 'cheer', label: 'BGM＋第 3 秒終結時的觀眾歡呼（遊戲裡的音量）', cheerAt: 3 },
  { id: 'cheerOnly', label: '只有第 3 秒的觀眾歡呼（校準音量用）', muteMusic: true, cheerAt: 3 },
];

/** 在離線環境合成 seconds 秒的 BGM（intense：對戰版或選單版），需要時在指定時間播一聲觀眾歡呼 */
async function renderBuffer(variant: string, intense: boolean, seconds: number): Promise<AudioBuffer> {
  const v = VARIANTS.find((x) => x.id === variant);
  if (!v) throw new Error(`unknown variant ${variant}`);
  const ctx = new OfflineAudioContext(2, RATE * seconds, RATE);
  const engine = new AudioEngine({ ctx: ctx as unknown as AudioContext });
  if (v.muteMusic) engine.music.gain.value = 0;
  engine.scheduleMusic(intense, 0.05, seconds);
  if (v.cheerAt !== undefined) {
    // 開發伺服器提供 public/ 底下的檔案
    await engine.loadCheer('/sfx/cheer.mp3');
    engine.cheer(CHEER_LEVEL.finish, v.cheerAt);
  }
  return ctx.startRendering();
}

/** 一段音訊的 RMS（兩聲道合併） */
function rms(buf: AudioBuffer): number {
  let sum = 0;
  let n = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    for (const v of buf.getChannelData(c)) sum += v * v;
    n += buf.length;
  }
  return Math.sqrt(sum / n);
}

/** 只留 4 kHz 以上（再過一次離線的高通濾波），量高頻有多少 */
async function highpass(buf: AudioBuffer, freq: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(buf.numberOfChannels, buf.length, buf.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = freq;
  src.connect(hp).connect(ctx.destination);
  src.start();
  return ctx.startRendering();
}

/** AudioBuffer → 16-bit PCM 立體聲 WAV → base64 */
function toWavBase64(buf: AudioBuffer): string {
  const ch = buf.numberOfChannels;
  const len = buf.length;
  const out = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  out.setUint32(4, 36 + len * ch * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, ch, true);
  out.setUint32(24, buf.sampleRate, true);
  out.setUint32(28, buf.sampleRate * ch * 2, true);
  out.setUint16(32, ch * 2, true);
  out.setUint16(34, 16, true);
  str(36, 'data');
  out.setUint32(40, len * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  const bytes = new Uint8Array(out.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** 合成一段並量測 */
async function render(variant: string, intense: boolean, seconds: number): Promise<Clip> {
  const buf = await renderBuffer(variant, intense, seconds);
  const total = rms(buf);
  const hf = rms(await highpass(buf, 4000));
  const db = (v: number) => Number((20 * Math.log10(Math.max(v, 1e-9))).toFixed(2));
  return { wav: toWavBase64(buf), rmsDb: db(total), hfDb: Number((db(hf) - db(total)).toFixed(2)) };
}

(window as unknown as { bgmPreview: unknown }).bgmPreview = { render, variants: VARIANTS.map(({ id, label }) => ({ id, label })) };
