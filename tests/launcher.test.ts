import { describe, expect, test } from 'vitest';
import { KEY_LAUNCH_CAP, keyLaunchRatio, MAX_AIM, measurePull, pullLaunchRatio, type PullSample } from '../src/sim/launcher';

/** 從 (x0, y0) 等速拉到 (x1, y1)，歷時 sec 秒，取樣 n 點 */
function pull(x0: number, y0: number, x1: number, y1: number, sec: number, n = 20): PullSample[] {
  return Array.from({ length: n }, (_, i) => {
    const k = i / (n - 1);
    return { t: k * sec, x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k };
  });
}

/** 畫面短邊（px） */
const SCALE = 800;

describe('拉條量測', () => {
  test('又長又快的往下拉：長度與速度都接近滿分，方向正中', () => {
    const m = measurePull(pull(400, 200, 400, 600, 0.12), SCALE);
    expect(m.length).toBe(1);
    expect(m.speed).toBeGreaterThan(0.9);
    expect(m.aim).toBeCloseTo(0, 6);
  });

  test('慢慢拉的速度分數低；拉得短的長度分數低', () => {
    expect(measurePull(pull(400, 200, 400, 600, 2), SCALE).speed).toBeLessThan(0.2);
    expect(measurePull(pull(400, 200, 400, 260, 0.1), SCALE).length).toBeLessThan(0.2);
  });

  test('往上拉不算數', () => {
    const m = measurePull(pull(400, 600, 400, 200, 0.1), SCALE);
    expect(m.length).toBe(0);
    expect(m.speed).toBe(0);
  });

  test('彈弓式瞄準：往左下拉 → 往右偏（正值），角度限制在 ±35°', () => {
    expect(measurePull(pull(400, 200, 300, 500, 0.2), SCALE).aim).toBeGreaterThan(0);
    expect(measurePull(pull(400, 200, 500, 500, 0.2), SCALE).aim).toBeLessThan(0);
    expect(measurePull(pull(400, 200, 0, 220, 0.2), SCALE).aim).toBeCloseTo(MAX_AIM, 6);
  });

  test('點一下（沒有拉）：全部為 0', () => {
    expect(measurePull([{ t: 0, x: 1, y: 1 }], SCALE)).toEqual({ length: 0, speed: 0, aim: 0 });
  });

  test('只有一個抖動取樣也不會算出超高速（至少要 50ms 的區間）', () => {
    const s: PullSample[] = [
      { t: 0, x: 0, y: 0 },
      { t: 0.001, x: 0, y: 40 },
      { t: 0.3, x: 0, y: 40 },
    ];
    expect(measurePull(s, SCALE).speed).toBeLessThan(0.2);
  });
});

describe('發射力道', () => {
  const perfect = { length: 1, speed: 1, aim: 0 };
  const none = { length: 0, speed: 0, aim: 0 };

  test('時機滿分 + 拉得完美 = 滿力；拉得很差 = 保底', () => {
    expect(pullLaunchRatio(1, perfect, 0.68)).toBe(1);
    expect(pullLaunchRatio(1, none, 0.68)).toBeCloseTo(0.68, 6);
  });

  test('時機差會打折，但不低於 0.5', () => {
    expect(pullLaunchRatio(0.7, perfect, 0.68)).toBeCloseTo(0.7, 6);
    expect(pullLaunchRatio(0.5, none, 0.55)).toBe(0.5);
  });

  test('Space 簡易發射最高 85%', () => {
    expect(keyLaunchRatio(1)).toBe(KEY_LAUNCH_CAP);
    expect(keyLaunchRatio(0.6)).toBe(0.6);
  });
});
