import { describe, expect, test } from 'vitest';
import { BattleSim } from '../src/sim/battle';
import { cpuThink } from '../src/sim/cpu';
import { createRng } from '../src/sim/rng';
import { TOP_SPECS } from '../src/sim/tops';
import type { FinishType, TopType } from '../src/sim/types';

const STEP = 1 / 120;

/** 讓兩顆 CPU 陀螺自動對打到分出勝負（或時間到），回傳結果 */
function autoBattle(a: TopType, b: TopType, seed: number, maxSeconds = 120) {
  const sim = new BattleSim(TOP_SPECS[a], TOP_SPECS[b], { seed, launch: [0.95, 0.95] });
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
      const s = new BattleSim(TOP_SPECS.attack, TOP_SPECS.defense, { seed, launch: [0.9, 0.9] });
      for (let i = 0; i < 600; i++) s.step(STEP);
      return JSON.stringify(s.tops.map((t) => [t.pos, t.vel, t.spin, t.burst]));
    };
    expect(run(42)).toBe(run(42));
    expect(run(42)).not.toBe(run(43));
  });

  test('轉速耗盡會判定停轉（Spin Finish），勝者是另一顆', () => {
    const sim = new BattleSim(TOP_SPECS.balance, TOP_SPECS.balance, { seed: 1, launch: [0.9, 0.9] });
    sim.tops[1].spin = sim.tops[1].spec.maxSpin * 0.05;
    sim.step(STEP);
    expect(sim.result).toMatchObject({ finish: 'spin', loser: 1, winner: 0 });
    expect(sim.drainEvents().some((e) => e.type === 'finish')).toBe(true);
  });

  test('爆裂量表滿了判定爆裂（Burst Finish）', () => {
    const sim = new BattleSim(TOP_SPECS.balance, TOP_SPECS.balance, { seed: 1, launch: [0.9, 0.9] });
    sim.tops[0].burst = 1;
    sim.step(STEP);
    expect(sim.result).toMatchObject({ finish: 'burst', loser: 0, winner: 1 });
  });

  test('必殺技需要量表全滿；使用後量表歸零並發出事件', () => {
    const sim = new BattleSim(TOP_SPECS.stamina, TOP_SPECS.attack, { seed: 1, launch: [0.6, 0.9] });
    expect(sim.useSpecial(0)).toBe(false);
    sim.tops[0].special = 1;
    const before = sim.tops[0].spin;
    expect(sim.useSpecial(0)).toBe(true);
    expect(sim.tops[0].special).toBe(0);
    expect(sim.tops[0].spin).toBeGreaterThan(before);
    expect(sim.drainEvents().some((e) => e.type === 'special' && e.id === 0)).toBe(true);
  });

  test('必殺技每回合只能用一次', () => {
    const sim = new BattleSim(TOP_SPECS.stamina, TOP_SPECS.attack, { seed: 1, launch: [0.6, 0.9] });
    sim.tops[0].special = 1;
    expect(sim.useSpecial(0)).toBe(true);
    sim.tops[0].special = 1;
    expect(sim.useSpecial(0)).toBe(false);
  });

  test('攻擊型必殺技會往對手方向突進', () => {
    const sim = new BattleSim(TOP_SPECS.attack, TOP_SPECS.defense, { seed: 1, launch: [0.9, 0.9] });
    const [a, b] = sim.tops;
    a.vel = { x: 0, z: 0 };
    a.special = 1;
    sim.useSpecial(0);
    const toB = { x: b.pos.x - a.pos.x, z: b.pos.z - a.pos.z };
    expect(a.vel.x * toB.x + a.vel.z * toB.z).toBeGreaterThan(0);
  });

  test('發射力道越好初始轉速越高', () => {
    const sim = new BattleSim(TOP_SPECS.balance, TOP_SPECS.balance, { seed: 1, launch: [1, 0.5] });
    expect(sim.tops[0].spin).toBeGreaterThan(sim.tops[1].spin);
  });
});

describe('CPU 對打耐久測試（平衡性）', () => {
  const types: TopType[] = ['attack', 'defense', 'stamina', 'balance'];

  test('所有對戰組合都會在 120 秒內分出勝負，且會真的發生碰撞', () => {
    const finishes = new Map<FinishType, number>();
    for (const a of types) {
      for (const b of types) {
        for (let seed = 1; seed <= 6; seed++) {
          const { sim, clashes } = autoBattle(a, b, seed);
          expect(sim.result, `${a} vs ${b} seed ${seed} 沒分出勝負`).not.toBeNull();
          expect(clashes, `${a} vs ${b} seed ${seed} 沒有碰撞`).toBeGreaterThan(0);
          const f = sim.result!.finish;
          finishes.set(f, (finishes.get(f) ?? 0) + 1);
        }
      }
    }
    // 三種終結方式都要出現，玩法才不會單調
    expect(finishes.get('spin') ?? 0).toBeGreaterThan(0);
    expect(finishes.get('over') ?? 0).toBeGreaterThan(0);
    expect(finishes.get('burst') ?? 0).toBeGreaterThan(0);
  });
});
