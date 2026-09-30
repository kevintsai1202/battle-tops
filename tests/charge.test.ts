import { describe, expect, test } from 'vitest';
import { createTop, integrateTop, PASSIVE_FILL, resolveCollision } from '../src/sim/physics';
import { createRng } from '../src/sim/rng';
import { TOP_IDS, TOP_SPECS } from '../src/sim/tops';
import type { TopSpec, TopState } from '../src/sim/types';

const STEP = 1 / 120;

/** 在場地中央原地旋轉 seconds 秒（不碰撞），回傳陀螺狀態 */
function spinAlone(spec: TopSpec, seconds: number): TopState {
  const t = createTop(0, spec, { x: 0, z: 0 }, { x: 0, z: 0 }, 1);
  for (let i = 0; i < Math.round(seconds / STEP); i++) integrateTop(t, STEP);
  return t;
}

/** 兩顆正面相撞的陀螺：a 在左往右、b 在右往左，彼此略微重疊；speed 為各自的速度 */
function headOn(dirA: 1 | -1, dirB: 1 | -1, speed = 3) {
  const a = createTop(0, TOP_SPECS.wolf, { x: -0.3, z: 0 }, { x: speed, z: 0 }, 1, dirA);
  const b = createTop(1, TOP_SPECS.wolf, { x: 0.3, z: 0 }, { x: -speed, z: 0 }, 1, dirB);
  return { a, b };
}

describe('必殺集氣', () => {
  test('每顆陀螺都有自己的集氣時間，落在 5～10 秒，而且不是全部一樣', () => {
    const charges = TOP_IDS.map((id) => TOP_SPECS[id].special.charge);
    for (const [i, c] of charges.entries()) {
      expect(c, TOP_IDS[i]).toBeGreaterThanOrEqual(5);
      expect(c, TOP_IDS[i]).toBeLessThanOrEqual(10);
    }
    expect(new Set(charges).size).toBeGreaterThan(2);
  });

  test('完全不碰撞也會靠時間集滿：大約在集氣時間的 PASSIVE_FILL 倍時集滿', () => {
    for (const id of ['blaze', 'gale', 'fafnir', 'turtle']) {
      const spec = TOP_SPECS[id];
      const full = spec.special.charge * PASSIVE_FILL;
      expect(spinAlone(spec, full * 0.95).special, `${id} 太早集滿`).toBeLessThan(1);
      expect(spinAlone(spec, full * 1.05).special, `${id} 沒有集滿`).toBe(1);
    }
  });

  test('集氣時間越短，被動集氣越快（與集氣時間成反比）', () => {
    const sorted = [...TOP_IDS].sort((x, y) => TOP_SPECS[x].special.charge - TOP_SPECS[y].special.charge);
    const fast = TOP_SPECS[sorted[0]];
    const slow = TOP_SPECS[sorted[sorted.length - 1]];
    const a = spinAlone(fast, 2).special;
    const b = spinAlone(slow, 2).special;
    expect(a).toBeGreaterThan(b);
    expect(a / b).toBeCloseTo(slow.special.charge / fast.special.charge, 2);
  });

  test('撞擊集氣和旋轉方向無關：左旋對右旋與同向對撞，同樣的正面衝擊集到一樣多', () => {
    const same = headOn(1, 1);
    const counter = headOn(1, -1);
    resolveCollision(same.a, same.b, createRng(1));
    resolveCollision(counter.a, counter.b, createRng(1));
    expect(same.a.special).toBeGreaterThan(0);
    expect(counter.a.special).toBeCloseTo(same.a.special, 9);
    expect(counter.b.special).toBeCloseTo(same.b.special, 9);
  });

  test('撞得越猛集得越多', () => {
    const soft = headOn(1, 1, 1.5);
    const hard = headOn(1, 1, 3);
    resolveCollision(soft.a, soft.b, createRng(1));
    resolveCollision(hard.a, hard.b, createRng(1));
    expect(hard.a.special).toBeGreaterThan(soft.a.special);
  });

  test('必殺用過之後，時間與撞擊都不再集氣', () => {
    const t = createTop(0, TOP_SPECS.wolf, { x: 0, z: 0 }, { x: 0, z: 0 }, 1);
    t.specialUsed = true;
    for (let i = 0; i < 240; i++) integrateTop(t, STEP);
    expect(t.special).toBe(0);
    const { a, b } = headOn(1, 1);
    a.specialUsed = true;
    resolveCollision(a, b, createRng(1));
    expect(a.special).toBe(0);
    expect(b.special).toBeGreaterThan(0);
  });
});
