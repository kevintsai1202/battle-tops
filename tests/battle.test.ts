import { describe, expect, test } from 'vitest';
import { BattleSim, DASH_COOLDOWN } from '../src/sim/battle';
import { ARENAS, ARENA_IDS, type ArenaSpec } from '../src/sim/arena';
import { cpuThink } from '../src/sim/cpu';
import { createRng } from '../src/sim/rng';
import { buildSpec, TOP_IDS, TOP_SPECS } from '../src/sim/tops';
import type { FinishType, TopId } from '../src/sim/types';

const STEP = 1 / 120;

/** 讓兩顆 CPU 陀螺自動對打到分出勝負（或時間到），回傳結果 */
function autoBattle(a: TopId, b: TopId, seed: number, arena: ArenaSpec = ARENAS.practice, maxSeconds = 120) {
  const sim = new BattleSim(TOP_SPECS[a], TOP_SPECS[b], { seed, launch: [0.95, 0.95], arena });
  const rng = createRng(seed * 7 + 3);
  let clashes = 0;
  while (!sim.result && sim.time < maxSeconds) {
    for (const id of [0, 1] as const) {
      const ai = cpuThink(sim, id, rng);
      sim.setControl(id, ai.control);
      if (ai.special) sim.useSpecial(id);
    }
    sim.step(STEP);
    clashes += sim.drainEvents().filter((e) => e.type === 'clash').length;
  }
  return { sim, clashes };
}

describe('BattleSim', () => {
  test('相同種子結果完全一致；不同種子會分歧', () => {
    const run = (seed: number) => {
      const s = new BattleSim(TOP_SPECS.blaze, TOP_SPECS.turtle, { seed, launch: [0.9, 0.9] });
      for (let i = 0; i < 600; i++) s.step(STEP);
      return JSON.stringify(s.tops.map((t) => [t.pos, t.vel, t.spin, t.burst]));
    };
    expect(run(42)).toBe(run(42));
    expect(run(42)).not.toBe(run(43));
  });

  test('轉速耗盡會判定停轉（Spin Finish），勝者是另一顆', () => {
    const sim = new BattleSim(TOP_SPECS.wolf, TOP_SPECS.wolf, { seed: 1, launch: [0.9, 0.9] });
    sim.tops[1].spin = sim.tops[1].spec.maxSpin * 0.05;
    sim.step(STEP);
    expect(sim.result).toMatchObject({ finish: 'spin', loser: 1, winner: 0 });
    expect(sim.drainEvents().some((e) => e.type === 'finish')).toBe(true);
  });

  test('爆裂量表滿了判定爆裂（Burst Finish）', () => {
    const sim = new BattleSim(TOP_SPECS.wolf, TOP_SPECS.wolf, { seed: 1, launch: [0.9, 0.9] });
    sim.tops[0].burst = 1;
    sim.step(STEP);
    expect(sim.result).toMatchObject({ finish: 'burst', loser: 0, winner: 1 });
  });

  test('必殺技需要量表全滿；使用後量表歸零並發出事件', () => {
    const sim = new BattleSim(TOP_SPECS.gale, TOP_SPECS.blaze, { seed: 1, launch: [0.6, 0.9] });
    expect(sim.useSpecial(0)).toBe(false);
    sim.tops[0].special = 1;
    const before = sim.tops[0].spin;
    expect(sim.useSpecial(0)).toBe(true);
    expect(sim.tops[0].special).toBe(0);
    expect(sim.tops[0].spin).toBeGreaterThan(before);
    expect(sim.drainEvents().some((e) => e.type === 'special' && e.id === 0)).toBe(true);
  });

  test('必殺技每回合只能用一次', () => {
    const sim = new BattleSim(TOP_SPECS.gale, TOP_SPECS.blaze, { seed: 1, launch: [0.6, 0.9] });
    sim.tops[0].special = 1;
    expect(sim.useSpecial(0)).toBe(true);
    sim.tops[0].special = 1;
    expect(sim.useSpecial(0)).toBe(false);
  });

  test('必殺技的突進速度看機動：換上低機動的軸心（例如針頭）突進得比較慢', () => {
    /** 雷皇龍裝上指定軸心、靜止時放必殺後的速度 */
    const dashSpeed = (driver: string | null) => {
      const sim = new BattleSim(buildSpec('ldrago', { disk: null, driver }), TOP_SPECS.turtle, { seed: 1, launch: [0.9, 0.9] });
      const a = sim.tops[0];
      a.vel = { x: 0, z: 0 };
      a.special = 1;
      sim.useSpecial(0);
      return Math.hypot(a.vel.x, a.vel.z);
    };
    expect(dashSpeed('needle')).toBeLessThan(dashSpeed(null) * 0.75);
  });

  test('攻擊型必殺技會往對手方向突進', () => {
    const sim = new BattleSim(TOP_SPECS.blaze, TOP_SPECS.turtle, { seed: 1, launch: [0.9, 0.9] });
    const [a, b] = sim.tops;
    a.vel = { x: 0, z: 0 };
    a.special = 1;
    sim.useSpecial(0);
    const toB = { x: b.pos.x - a.pos.x, z: b.pos.z - a.pos.z };
    expect(a.vel.x * toB.x + a.vel.z * toB.z).toBeGreaterThan(0);
  });

  test('發射力道越好初始轉速越高', () => {
    const sim = new BattleSim(TOP_SPECS.wolf, TOP_SPECS.wolf, { seed: 1, launch: [1, 0.5] });
    expect(sim.tops[0].spin).toBeGreaterThan(sim.tops[1].spin);
  });

  test('旋轉方向取自陀螺本身：左旋陀螺開場就是左旋', () => {
    const sim = new BattleSim(TOP_SPECS.ldrago, TOP_SPECS.pegasus, { seed: 1, launch: [0.9, 0.9] });
    expect(sim.tops[0].spinDir).toBe(-1);
    expect(sim.tops[1].spinDir).toBe(1);
  });

  test('發射方向偏移會轉動初速方向，速率不變', () => {
    const base = new BattleSim(TOP_SPECS.wolf, TOP_SPECS.wolf, { seed: 3, launch: [0.9, 0.9] });
    const aimed = new BattleSim(TOP_SPECS.wolf, TOP_SPECS.wolf, { seed: 3, launch: [0.9, 0.9], aim: [0.5, 0] });
    const [v0, v1] = [base.tops[0].vel, aimed.tops[0].vel];
    expect(Math.hypot(v1.x, v1.z)).toBeCloseTo(Math.hypot(v0.x, v0.z), 6);
    const ang = Math.atan2(v1.z, v1.x) - Math.atan2(v0.z, v0.x);
    expect(ang).toBeCloseTo(0.5, 6);
    expect(aimed.tops[1].vel).toEqual(base.tops[1].vel);
  });
});

describe('每顆陀螺的必殺技', () => {
  test('每顆都能發動，而且效果各不相同（同一個初始狀態下結果互不相同）', () => {
    const snapshots = new Map<string, string>();
    for (const id of TOP_IDS) {
      const sim = new BattleSim(TOP_SPECS[id], TOP_SPECS.wolf, { seed: 5, launch: [0.7, 0.9] });
      const [a, b] = sim.tops;
      a.pos = { x: -0.6, z: 0.2 };
      b.pos = { x: 0.6, z: 0 };
      a.burst = 0.4;
      a.special = 1;
      expect(sim.useSpecial(0), `${id} 無法發動`).toBe(true);
      // 推進一小段，讓持續型效果（力場、減益）也反映出來
      for (let i = 0; i < 30; i++) sim.step(STEP);
      const snap = JSON.stringify(
        [a.pos, a.vel, a.spin, a.spinDir, a.burst, b.pos, b.vel, b.spin, b.burst, a.buff?.mods, b.hex?.mods].map((v) =>
          typeof v === 'number' ? v.toFixed(4) : JSON.stringify(v),
        ),
      );
      expect(snapshots.has(snap), `${id} 與 ${snapshots.get(snap)} 效果相同`).toBe(false);
      snapshots.set(snap, id);
    }
  });

  test('雙旋陀螺的必殺技會反轉旋轉方向', () => {
    const sim = new BattleSim(TOP_SPECS.requiem, TOP_SPECS.wolf, { seed: 1, launch: [0.9, 0.9] });
    sim.tops[0].special = 1;
    sim.useSpecial(0);
    expect(sim.tops[0].spinDir).toBe(-1);
  });

  test('吸轉：吸走對手轉速並補到自己身上', () => {
    const sim = new BattleSim(TOP_SPECS.fafnir, TOP_SPECS.wolf, { seed: 1, launch: [0.6, 0.9] });
    const [a, b] = sim.tops;
    const [sa, sb] = [a.spin, b.spin];
    a.special = 1;
    sim.useSpecial(0);
    expect(b.spin).toBeLessThan(sb);
    expect(a.spin).toBeGreaterThan(sa);
  });

  test('冰封減益：對手推移倍率下降，時間到解除', () => {
    const sim = new BattleSim(TOP_SPECS.wolborg, TOP_SPECS.wolf, { seed: 1, launch: [0.9, 0.9] });
    sim.tops[0].special = 1;
    sim.useSpecial(0);
    expect(sim.tops[1].hex?.mods.ctrl).toBeLessThan(1);
    // 等到減益時間（取自必殺定義）再多 0.2 秒
    const hex = TOP_SPECS.wolborg.special.steps.find((s) => s.op === 'hex');
    const wait = (hex && 'time' in hex ? hex.time : 0) + 0.2;
    for (let i = 0; i < Math.round(wait / STEP); i++) sim.step(STEP);
    expect(sim.tops[1].hex).toBeNull();
  });
});

describe('CPU 對打耐久測試（平衡性）', () => {
  /** 對打一組清單並檢查每場都分出勝負、有碰撞，回傳終結方式分布 */
  function runAll(pairs: [TopId, TopId, number][], arena: ArenaSpec) {
    const finishes = new Map<FinishType, number>();
    for (const [a, b, seed] of pairs) {
      const { sim, clashes } = autoBattle(a, b, seed, arena);
      expect(sim.result, `${arena.id}: ${a} vs ${b} seed ${seed} 沒分出勝負`).not.toBeNull();
      expect(clashes, `${arena.id}: ${a} vs ${b} seed ${seed} 沒有碰撞`).toBeGreaterThan(0);
      const f = sim.result!.finish;
      finishes.set(f, (finishes.get(f) ?? 0) + 1);
    }
    return finishes;
  }

  test('練習場：所有對戰組合都會在 120 秒內分出勝負，且三種終結方式都會出現', () => {
    const pairs: [TopId, TopId, number][] = [];
    TOP_IDS.forEach((a, i) => TOP_IDS.forEach((b, j) => pairs.push([a, b, 1 + ((i * 7 + j) % 5)])));
    const finishes = runAll(pairs, ARENAS.practice);
    expect(finishes.get('spin') ?? 0).toBeGreaterThan(0);
    expect(finishes.get('over') ?? 0).toBeGreaterThan(0);
    expect(finishes.get('burst') ?? 0).toBeGreaterThan(0);
  });

  test('鏡像對戰（同一顆對自己）也打得完：回復型必殺不會讓回合拖不完', () => {
    const pairs: [TopId, TopId, number][] = [];
    for (const id of TOP_IDS) for (const seed of [11, 12, 13]) pairs.push([id, id, seed]);
    runAll(pairs, ARENAS.practice);
  });

  test.each(ARENA_IDS.filter((id) => id !== 'practice'))('%s：抽樣組合都會分出勝負', (arenaId) => {
    const pairs: [TopId, TopId, number][] = [];
    // 每顆陀螺至少上場兩次（對下一顆、對隔三顆），各 2 個種子
    TOP_IDS.forEach((a, i) => {
      for (const seed of [21, 22]) {
        pairs.push([a, TOP_IDS[(i + 1) % TOP_IDS.length], seed]);
        pairs.push([a, TOP_IDS[(i + 3) % TOP_IDS.length], seed]);
      }
    });
    runAll(pairs, ARENAS[arenaId]);
  });
});

describe('快甩衝刺（手機）', () => {
  test('朝指定方向加速，並消耗一點轉速；發出 dash 事件', () => {
    const sim = new BattleSim(TOP_SPECS.wolf, TOP_SPECS.turtle, { seed: 1, launch: [0.9, 0.9] });
    const a = sim.tops[0];
    a.vel = { x: 0, z: 0 };
    const spin = a.spin;
    expect(sim.dash(0, { x: 0, z: 1 })).toBe(true);
    expect(a.vel.z).toBeGreaterThan(1);
    expect(Math.abs(a.vel.x)).toBeLessThan(1e-9);
    expect(a.spin).toBeLessThan(spin);
    expect(sim.drainEvents().some((e) => e.type === 'dash' && e.id === 0)).toBe(true);
  });

  test('冷卻時間內不能連續衝刺，冷卻結束後可以', () => {
    const sim = new BattleSim(TOP_SPECS.wolf, TOP_SPECS.turtle, { seed: 1, launch: [0.9, 0.9] });
    expect(sim.dash(0, { x: 1, z: 0 })).toBe(true);
    expect(sim.dash(0, { x: 1, z: 0 })).toBe(false);
    for (let i = 0; i < Math.ceil(DASH_COOLDOWN / STEP) + 1; i++) sim.step(STEP);
    expect(sim.dash(0, { x: 1, z: 0 })).toBe(true);
  });

  test('被終結後不能衝刺；方向長度為 0 時不衝刺', () => {
    const sim = new BattleSim(TOP_SPECS.wolf, TOP_SPECS.turtle, { seed: 1, launch: [0.9, 0.9] });
    expect(sim.dash(0, { x: 0, z: 0 })).toBe(false);
    sim.tops[0].burst = 1;
    sim.step(STEP);
    expect(sim.dash(0, { x: 1, z: 0 })).toBe(false);
  });

  test('低機動的軸心衝得比較慢', () => {
    const speed = (driver: string | null) => {
      const sim = new BattleSim(buildSpec('ldrago', { disk: null, driver }), TOP_SPECS.turtle, { seed: 1, launch: [0.9, 0.9] });
      sim.tops[0].vel = { x: 0, z: 0 };
      sim.dash(0, { x: 1, z: 0 });
      return sim.tops[0].vel.x;
    };
    expect(speed('needle')).toBeLessThan(speed(null));
  });
});
