import { describe, expect, test } from 'vitest';
import { trimRange, trimmedSeconds } from '../src/audio/trim';

/**
 * 語音頭尾靜音裁切：遊戲播放與生成腳本（記錄每句實際播放長度）共用同一份計算。
 * 取樣率用 1000 Hz，1 個樣本 = 1 毫秒，方便對照留白長度。
 */
const SR = 1000;

/** 產生 n 個樣本；parts 的每段 [起, 迄, 振幅] 填入正負交替的方波 */
function wave(n: number, parts: [number, number, number][]): Float32Array {
  const a = new Float32Array(n);
  for (const [from, to, amp] of parts) for (let i = from; i < to; i++) a[i] = i % 2 ? amp : -amp;
  return a;
}

describe('語音頭尾靜音裁切', () => {
  test('開頭用較高的門檻：低於門檻的雜音不算開始，從有聲處往前留 10 毫秒', () => {
    const [start] = trimRange(wave(1000, [[100, 200, 0.01], [300, 600, 0.5]]), SR);
    expect(start).toBe(290);
  });

  test('結尾用較低的門檻：輕聲的尾音保留，再往後留 40 毫秒', () => {
    const [, end] = trimRange(wave(1000, [[300, 600, 0.5], [600, 700, 0.01]]), SR);
    expect(end).toBe(699 + 40);
  });

  test('結尾低於門檻的雜音會被切掉', () => {
    const [, end] = trimRange(wave(1000, [[300, 600, 0.5], [600, 700, 0.004]]), SR);
    expect(end).toBe(599 + 40);
  });

  test('留白不超出檔案的頭尾', () => {
    expect(trimRange(wave(100, [[0, 100, 0.5]]), SR)).toEqual([0, 99]);
  });

  test('裁切後的長度（秒）', () => {
    // 有聲 300～599，往前留 10、往後留 40 → 290～639，共 350 個樣本
    expect(trimmedSeconds(wave(1000, [[300, 600, 0.5]]), SR)).toBeCloseTo(0.35, 6);
  });

  test('整段靜音也不會出錯，回傳的範圍在檔案內', () => {
    const [s, e] = trimRange(new Float32Array(500), SR);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(e).toBeLessThanOrEqual(499);
    expect(e).toBeGreaterThanOrEqual(s);
  });
});
