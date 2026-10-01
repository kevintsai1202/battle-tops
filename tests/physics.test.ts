import { describe, expect, test } from 'vitest';
import { ARENA, ARENAS } from '../src/sim/arena';
import { createTop, integrateTop, resolveCollision, resolveRim } from '../src/sim/physics';
import { createRng } from '../src/sim/rng';
import { TOP_SPECS } from '../src/sim/tops';
import type { TopState } from '../src/sim/types';

const len = (x: number, z: number) => Math.hypot(x, z);

/** 建一顆完全沒有轉速的陀螺，用來單獨觀察坡度力 */
function still(x: number, z: number): TopState {
  return createTop(0, TOP_SPECS.wolf, { x, z }, { x: 0, z: 0 }, 0, 1);
}

describe('碗形場地坡度', () => {
  test('靜止的陀螺會往中心加速', () => {
    const t = still(2, 0);
    integrateTop(t, 0.05);
    expect(t.vel.x).toBeLessThan(0);
    expect(Math.abs(t.vel.z)).toBeLessThan(1e-9);
  });

  test('離中心越遠，往中心的加速度越大', () => {
    const near = still(1, 0);
    const far = still(2.5, 0);
    integrateTop(near, 0.05);
    integrateTop(far, 0.05);
    expect(Math.abs(far.vel.x)).toBeGreaterThan(Math.abs(near.vel.x));
  });
});

describe('轉速衰減', () => {
  test('轉速會隨時間下降', () => {
    const t = createTop(0, TOP_SPECS.wolf, { x: 0, z: 0 }, { x: 0, z: 0 }, 1, 1);
    const before = t.spin;
    for (let i = 0; i < 120; i++) integrateTop(t, 1 / 120);
    expect(t.spin).toBeLessThan(before);
  });

  test('持久型比攻擊型保留更多轉速比例', () => {
    const atk = createTop(0, TOP_SPECS.blaze, { x: 0, z: 0 }, { x: 0, z: 0 }, 1, 1);
    const sta = createTop(1, TOP_SPECS.gale, { x: 0, z: 0 }, { x: 0, z: 0 }, 1, 1);
    for (let i = 0; i < 120 * 10; i++) {
      integrateTop(atk, 1 / 120);
      integrateTop(sta, 1 / 120);
    }
    expect(sta.spin / sta.spec.maxSpin).toBeGreaterThan(atk.spin / atk.spec.maxSpin);
  });

  test('轉速低時開始晃動（tilt 上升）', () => {
    const t = createTop(0, TOP_SPECS.wolf, { x: 0, z: 0 }, { x: 0, z: 0 }, 0.2, 1);
    integrateTop(t, 1 / 120);
    expect(t.tilt).toBeGreaterThan(0);
    const fresh = createTop(0, TOP_SPECS.wolf, { x: 0, z: 0 }, { x: 0, z: 0 }, 1, 1);
    integrateTop(fresh, 1 / 120);
    expect(fresh.tilt).toBe(0);
  });
});

describe('推移', () => {
  /** 在場地中央靜止、往 +x 推移一步後的速度；dash 為機動分數 */
  const pushed = (dash: number) => {
    const spec = { ...TOP_SPECS.wolf, stats: { ...TOP_SPECS.wolf.stats, dash } };
    const t = createTop(0, spec, { x: 0, z: 0 }, { x: 0, z: 0 }, 1, 1);
    t.control = { x: 1, z: 0 };
    integrateTop(t, 1 / 120);
    return t.vel.x;
  };

  test('機動越高推得越動：尖頭、針頭這類低機動的軸心幾乎推不動（換軸時機動才有取捨的價值）', () => {
    expect(pushed(10)).toBeGreaterThan(pushed(5));
    expect(pushed(5)).toBeGreaterThan(pushed(1));
    expect(pushed(1)).toBeGreaterThan(0);
    expect(pushed(1) / pushed(10)).toBeLessThan(0.6);
  });
});

/** 兩顆正面相撞的陀螺：a 在左往右、b 在右往左，彼此略微重疊 */
function headOn(dirA: 1 | -1, dirB: 1 | -1) {
  const a = createTop(0, TOP_SPECS.wolf, { x: -0.3, z: 0 }, { x: 3, z: 0 }, 1, dirA);
  const b = createTop(1, TOP_SPECS.wolf, { x: 0.3, z: 0 }, { x: -3, z: 0 }, 1, dirB);
  return { a, b };
}

describe('陀螺互撞', () => {
  test('解算後不再重疊，且沿法線方向改為分離', () => {
    const { a, b } = headOn(1, 1);
    resolveCollision(a, b, createRng(1));
    const d = len(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
    expect(d).toBeGreaterThanOrEqual(a.spec.radius + b.spec.radius - 1e-6);
    const vn = (b.vel.x - a.vel.x) * Math.sign(b.pos.x - a.pos.x);
    expect(vn).toBeGreaterThan(0);
  });

  test('衝量等大反向：總動量守恆', () => {
    const { a, b } = headOn(1, 1);
    const m = a.spec.mass;
    const px0 = m * a.vel.x + m * b.vel.x;
    const pz0 = m * a.vel.z + m * b.vel.z;
    resolveCollision(a, b, createRng(1));
    expect(m * a.vel.x + m * b.vel.x).toBeCloseTo(px0, 6);
    expect(m * a.vel.z + m * b.vel.z).toBeCloseTo(pz0, 6);
  });

  test('同向旋轉的撞擊比逆向旋轉彈得更開', () => {
    const same = headOn(1, 1);
    const counter = headOn(1, -1);
    resolveCollision(same.a, same.b, createRng(1));
    resolveCollision(counter.a, counter.b, createRng(1));
    const sep = (s: { a: TopState; b: TopState }) => len(s.b.vel.x - s.a.vel.x, s.b.vel.z - s.a.vel.z);
    expect(sep(same)).toBeGreaterThan(sep(counter));
  });

  test('回傳撞擊強度，並扣轉速、累積爆裂量表與必殺量表', () => {
    const { a, b } = headOn(1, 1);
    const spinB = b.spin;
    const hit = resolveCollision(a, b, createRng(1));
    expect(hit).not.toBeNull();
    expect(hit!.intensity).toBeGreaterThan(0);
    expect(b.spin).toBeLessThan(spinB);
    expect(b.burst).toBeGreaterThan(0);
    expect(a.special).toBeGreaterThan(0);
  });

  test('攻擊型打防禦差的對手，造成的轉速損失比持久型打同一對手更大', () => {
    const victim = () => createTop(1, TOP_SPECS.gale, { x: 0.3, z: 0 }, { x: -3, z: 0 }, 1, 1);
    const vA = victim();
    const vB = victim();
    const atk = createTop(0, TOP_SPECS.blaze, { x: -0.3, z: 0 }, { x: 3, z: 0 }, 1, 1);
    const sta = createTop(0, TOP_SPECS.gale, { x: -0.3, z: 0 }, { x: 3, z: 0 }, 1, 1);
    resolveCollision(atk, vA, createRng(1));
    resolveCollision(sta, vB, createRng(1));
    expect(vA.spin).toBeLessThan(vB.spin);
  });

  test('主動衝撞的一方受到的傷害比被撞的一方少', () => {
    const a = createTop(0, TOP_SPECS.wolf, { x: -0.3, z: 0 }, { x: 5, z: 0 }, 1, 1);
    const b = createTop(1, TOP_SPECS.wolf, { x: 0.3, z: 0 }, { x: 0, z: 0 }, 1, 1);
    resolveCollision(a, b, () => 0.5);
    expect(a.spin).toBeGreaterThan(b.spin);
    expect(a.burst).toBeLessThan(b.burst);
  });

  test('同一次撞擊雙方爆裂量同時滿時，只有較高的一方達到爆裂', () => {
    const { a, b } = headOn(1, 1);
    a.burst = 0.99;
    b.burst = 0.98;
    resolveCollision(a, b, () => 0.5);
    expect(a.burst >= 1 && b.burst >= 1).toBe(false);
    expect(Math.max(a.burst, b.burst)).toBeGreaterThanOrEqual(1);
  });

  test('吸轉：輕輕貼著磨的接觸吸得比正面重擊少（避免每一步的貼身接觸疊加成大量吸轉）', () => {
    /** 裝上吸轉增益的 a 以 speed 撞向 b，回傳 b 被吸走的轉速 */
    const stolen = (speed: number) => {
      const a = createTop(0, TOP_SPECS.ldrago, { x: -0.3, z: 0 }, { x: speed, z: 0 }, 1, -1);
      const b = createTop(1, TOP_SPECS.wolf, { x: 0.3, z: 0 }, { x: -speed, z: 0 }, 1, 1);
      a.buff = { from: 'ldrago', time: 2, mods: { spinSteal: 0.02 } };
      const noSteal = createTop(1, TOP_SPECS.wolf, { x: 0.3, z: 0 }, { x: -speed, z: 0 }, 1, 1);
      const plain = createTop(0, TOP_SPECS.ldrago, { x: -0.3, z: 0 }, { x: speed, z: 0 }, 1, -1);
      resolveCollision(a, b, () => 0.5);
      resolveCollision(plain, noSteal, () => 0.5);
      return noSteal.spin - b.spin;
    };
    const graze = stolen(0.1);
    const hard = stolen(3);
    expect(graze).toBeGreaterThan(0);
    expect(graze).toBeLessThan(hard * 0.1);
  });

  test('沒接觸時不處理', () => {
    const a = createTop(0, TOP_SPECS.wolf, { x: -2, z: 0 }, { x: 0, z: 0 }, 1, 1);
    const b = createTop(1, TOP_SPECS.wolf, { x: 2, z: 0 }, { x: 0, z: 0 }, 1, 1);
    expect(resolveCollision(a, b, createRng(1))).toBeNull();
  });
});

describe('場地邊緣與出場口', () => {
  const wallAngle = ARENA.pockets[0].at + Math.PI / 3; // 兩個出場口正中間，一定是牆
  const edge = ARENA.radius - TOP_SPECS.wolf.radius + 0.02;

  test('一般牆面：高速撞牆會反彈回場內，不出場', () => {
    const dir = { x: Math.cos(wallAngle), z: Math.sin(wallAngle) };
    const t = createTop(0, TOP_SPECS.wolf, { x: dir.x * edge, z: dir.z * edge }, { x: dir.x * 8, z: dir.z * 8 }, 1, 1);
    const r = resolveRim(t);
    expect(r.out).toBeNull();
    expect(t.vel.x * dir.x + t.vel.z * dir.z).toBeLessThan(0);
    expect(len(t.pos.x, t.pos.z)).toBeLessThanOrEqual(ARENA.radius - t.spec.radius + 1e-6);
  });

  test('出場口：高速往外衝會出場（回傳出場口的種類）', () => {
    const a = ARENA.pockets[0].at;
    const dir = { x: Math.cos(a), z: Math.sin(a) };
    const t = createTop(0, TOP_SPECS.wolf, { x: dir.x * edge, z: dir.z * edge }, { x: dir.x * 8, z: dir.z * 8 }, 1, 1);
    expect(resolveRim(t).out).toBe('over');
  });

  test('標準戰鬥盤：撞進中間寬口是極限終結（xtreme），撞進兩角是場外終結（over）', () => {
    for (const p of ARENAS.stadium.pockets) {
      const dir = { x: Math.cos(p.at), z: Math.sin(p.at) };
      const t = createTop(0, TOP_SPECS.wolf, { x: dir.x * edge, z: dir.z * edge }, { x: dir.x * 8, z: dir.z * 8 }, 1, 1);
      expect(resolveRim(t, ARENAS.stadium).out).toBe(p.kind);
    }
  });

  test('出場口：低速滑過去不會出場', () => {
    const a = ARENA.pockets[0].at;
    const dir = { x: Math.cos(a), z: Math.sin(a) };
    const t = createTop(0, TOP_SPECS.wolf, { x: dir.x * edge, z: dir.z * edge }, { x: dir.x * 1, z: dir.z * 1 }, 1, 1);
    expect(resolveRim(t).out).toBeNull();
  });
});
