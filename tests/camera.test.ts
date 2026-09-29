import { describe, expect, test } from 'vitest';
import { aspectFov } from '../src/render/cameraRig';

/** 由垂直 FOV 與長寬比算水平 FOV（度） */
const hfov = (vfov: number, aspect: number) => (2 * Math.atan(Math.tan((vfov * Math.PI) / 360) * aspect) * 180) / Math.PI;

describe('直向螢幕的視角補償', () => {
  test('16:9 或更寬時不改變', () => {
    expect(aspectFov(50, 16 / 9)).toBeCloseTo(50, 6);
    expect(aspectFov(50, 2.16)).toBeCloseTo(50, 6);
  });

  test('畫面變窄時加大垂直 FOV，讓水平視野不要縮太多', () => {
    const portrait = 390 / 844;
    const v = aspectFov(50, portrait);
    expect(v).toBeGreaterThan(50);
    // 補償後的水平視野明顯大於不補償
    expect(hfov(v, portrait)).toBeGreaterThan(hfov(50, portrait) * 1.8);
  });

  test('有上限，不會變成超廣角魚眼', () => {
    expect(aspectFov(60, 0.3)).toBeLessThan(100);
  });
});
