import { describe, expect, test } from 'vitest';
import { joystickVector } from '../src/ui/touch';

describe('虛擬搖桿換算', () => {
  const R = 60;
  const DZ = 0.2;

  test('死區內回傳 0（手指輕放不會亂動）', () => {
    expect(joystickVector(5, -5, R, DZ)).toEqual({ x: 0, y: 0 });
  });

  test('往右推到底 = x 1', () => {
    const v = joystickVector(R, 0, R, DZ);
    expect(v.x).toBeCloseTo(1, 6);
    expect(v.y).toBeCloseTo(0, 6);
  });

  test('螢幕往上推（dy 為負）= 往前（y 為正），與 W 鍵相同', () => {
    const v = joystickVector(0, -R, R, DZ);
    expect(v.y).toBeCloseTo(1, 6);
  });

  test('超出底盤半徑時長度截斷為 1', () => {
    const v = joystickVector(3 * R, 4 * R, R, DZ);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 6);
    expect(v.x).toBeCloseTo(0.6, 6);
    expect(v.y).toBeCloseTo(-0.8, 6);
  });

  test('死區外從 0 平滑開始：推一半時強度為 (0.5 − 死區)/(1 − 死區)', () => {
    const v = joystickVector(R * 0.5, 0, R, DZ);
    expect(v.x).toBeCloseTo((0.5 - DZ) / (1 - DZ), 6);
  });
});
