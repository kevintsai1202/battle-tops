import { describe, expect, test } from 'vitest';
import { CameraDirector } from '../src/director/director';
import { launchSpinRatio } from '../src/sim/rules';

describe('發射規則', () => {
  test('發射時機：越準轉速越高，提早或延遲對稱，最低 0.5', () => {
    expect(launchSpinRatio(0)).toBe(1);
    expect(launchSpinRatio(0.03)).toBe(1);
    const mid = launchSpinRatio(0.2);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeGreaterThan(0.5);
    expect(launchSpinRatio(-0.2)).toBeCloseTo(mid, 10);
    expect(launchSpinRatio(2)).toBe(0.5);
  });
});

describe('鏡頭導演', () => {
  const clash = (intensity: number) => ({ pos: { x: 0.5, z: 0 }, normal: { x: 1, z: 0 }, intensity });

  /** 以牆鐘時間推進導演 seconds 秒 */
  function run(d: CameraDirector, seconds: number) {
    const dt = 1 / 60;
    for (let t = 0; t < seconds; t += dt) d.update(dt);
  }

  test('輕微碰撞不觸發特寫', () => {
    const d = new CameraDirector();
    expect(d.notifyClash(clash(1))).toBe(false);
    expect(d.mode).toBe('overview');
  });

  test('重擊觸發特寫：進入慢動作與衝擊幀', () => {
    const d = new CameraDirector();
    expect(d.notifyClash(clash(9))).toBe(true);
    expect(d.mode).toBe('closeup');
    expect(d.impactFlash).toBeGreaterThan(0);
    run(d, 0.15);
    expect(d.timeScale).toBeLessThan(0.15);
    expect(d.impactFlash).toBe(0);
    expect(d.focus).toEqual({ x: 0.5, z: 0 });
  });

  test('特寫結束後回到全景，時間流速回到 1', () => {
    const d = new CameraDirector();
    d.notifyClash(clash(9));
    run(d, 3);
    expect(d.mode).toBe('overview');
    expect(d.timeScale).toBe(1);
  });

  test('冷卻時間內的重擊不會再次觸發特寫，冷卻後可以', () => {
    const d = new CameraDirector({ cooldown: 2 });
    d.notifyClash(clash(9));
    run(d, d.config.closeupDuration + 0.2);
    expect(d.mode).toBe('overview');
    expect(d.notifyClash(clash(9))).toBe(false);
    run(d, 2);
    expect(d.notifyClash(clash(9))).toBe(true);
  });

  test('終結事件優先於特寫，進入終結鏡頭並慢動作', () => {
    const d = new CameraDirector();
    d.notifyClash(clash(9));
    d.notifyFinish({ x: 1, z: 1 });
    expect(d.mode).toBe('finish');
    run(d, 0.3);
    expect(d.timeScale).toBeLessThan(1);
    expect(d.notifyClash(clash(20))).toBe(false);
  });

  test('重擊會帶來畫面震動並逐漸衰減', () => {
    const d = new CameraDirector();
    d.notifyClash(clash(4));
    const s0 = d.shake;
    expect(s0).toBeGreaterThan(0);
    run(d, 1);
    expect(d.shake).toBeLessThan(s0);
  });
});
