/** 開頭判定有聲的門檻（約 -34 dBFS）：讓台詞準確對上節拍 */
export const HEAD_GATE = 0.02;
/** 結尾判定有聲的門檻（約 -44 dBFS）：比開頭低，避免切掉輕聲的尾音子音 */
export const TAIL_GATE = 0.006;
/** 開頭往前留的長度（秒）；結尾往後留四倍 */
const HEAD_PAD = 0.01;

/**
 * 計算去掉頭尾靜音後要保留的樣本範圍 [start, end]（含 end）。
 * 開頭用較高的門檻，讓台詞準確落在節拍上；結尾用較低的門檻，保留輕聲的尾音。
 * 遊戲播放（VoicePlayer）與語音生成腳本（記錄每句實際播放長度）共用這份計算，兩邊的長度才會一致。
 * 不 import 任何東西，Node 腳本可以直接載入這個 .ts 檔。
 */
export function trimRange(ch: ArrayLike<number>, sampleRate: number): [number, number] {
  let s = 0;
  while (s < ch.length && Math.abs(ch[s]) < HEAD_GATE) s++;
  let e = ch.length - 1;
  while (e > s && Math.abs(ch[e]) < TAIL_GATE) e--;
  const pad = Math.floor(sampleRate * HEAD_PAD);
  s = Math.min(Math.max(0, s - pad), Math.max(0, ch.length - 1));
  e = Math.max(s, Math.min(ch.length - 1, e + pad * 4));
  return [s, e];
}

/** 去掉頭尾靜音後的長度（秒），也就是遊戲裡實際播放的長度 */
export function trimmedSeconds(ch: ArrayLike<number>, sampleRate: number): number {
  const [s, e] = trimRange(ch, sampleRate);
  return (e - s + 1) / sampleRate;
}
