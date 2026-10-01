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

describe('鏡頭導演：必殺凍結與線上強制切換', () => {
  const clash = (intensity: number) => ({ pos: { x: 0.5, z: 0 }, normal: { x: 1, z: 0 }, intensity });
  /** 以牆鐘時間推進導演 seconds 秒 */
  function run(d: CameraDirector, seconds: number) {
    const dt = 1 / 60;
    for (let t = 0; t < seconds; t += dt) d.update(dt);
  }

  test('必殺 cut-in：1.1 秒內時間流速乘上 0.12，之後恢復（CPU 模式與伺服器共用）', () => {
    const d = new CameraDirector();
    d.notifySpecial();
    d.update(1 / 60);
    expect(d.specialFreeze).toBeGreaterThan(0);
    expect(d.timeScale).toBeCloseTo(0.12, 6);
    run(d, 1.2);
    expect(d.specialFreeze).toBe(0);
    expect(d.timeScale).toBe(1);
  });

  test('必殺凍結與撞擊特寫同時發生時流速相乘', () => {
    const d = new CameraDirector();
    d.notifyClash(clash(9));
    run(d, 0.2);
    const closeup = d.timeScale;
    d.notifySpecial();
    d.update(1 / 60);
    expect(d.timeScale).toBeLessThan(closeup);
    expect(d.timeScale).toBeCloseTo(0.07 * 0.12, 3);
  });

  test('forceCloseup：不看門檻與冷卻，直接進特寫（線上客戶端照伺服器的事件切換）', () => {
    const d = new CameraDirector();
    d.notifyClash(clash(9));
    run(d, 1.5);
    expect(d.mode).toBe('overview');
    // 冷卻中、強度也低，一般的 notifyClash 不會觸發
    expect(d.notifyClash(clash(1))).toBe(false);
    d.forceCloseup(clash(1));
    expect(d.mode).toBe('closeup');
    expect(d.focus).toEqual({ x: 0.5, z: 0 });
    d.update(1 / 60);
    expect(d.timeScale).toBeLessThan(1);
  });

  test('forceFinish 等同 notifyFinish（線上客戶端用）', () => {
    const d = new CameraDirector();
    d.forceFinish({ x: 1, z: 2 });
    expect(d.mode).toBe('finish');
    expect(d.focus).toEqual({ x: 1, z: 2 });
  });

  test('reset 會清掉必殺凍結', () => {
    const d = new CameraDirector();
    d.notifySpecial();
    d.reset();
    d.update(1 / 60);
    expect(d.specialFreeze).toBe(0);
    expect(d.timeScale).toBe(1);
  });
});
