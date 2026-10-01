import { describe, expect, test } from 'vitest';
import { ARENAS } from '../src/sim/arena';
import { BattleSim, type SimSnapshot } from '../src/sim/battle';
import { cpuThink } from '../src/sim/cpu';
import { createRng } from '../src/sim/rng';
import { buildSpec, TOP_SPECS } from '../src/sim/tops';
import type { SimEvent, V2 } from '../src/sim/types';

const STEP = 1 / 120;

describe('亂數狀態', () => {
  test('讀出狀態後繼續取亂數，設回同一個狀態會得到完全相同的數列', () => {
    const r = createRng(5);
    r();
    r();
    const s = r.state();
    const a = [r(), r(), r()];
    r.setState(s);
    expect([r(), r(), r()]).toEqual(a);
  });
});

/** 一步的操作（兩顆陀螺的推移與是否放必殺） */
type Step = { control: [V2, V2]; special: [boolean, boolean] };

/** 用 CPU 對打產生一串操作（固定亂數），讓兩份模擬能套用完全相同的操作 */
function record(sim: BattleSim, steps: number, seed: number): Step[] {
  const rng = createRng(seed);
  const out: Step[] = [];
  for (let i = 0; i < steps && !sim.result; i++) {
    const a = cpuThink(sim, 0, rng);
    const b = cpuThink(sim, 1, rng);
    out.push({ control: [a.control, b.control], special: [a.special, b.special] });
    apply(sim, out[out.length - 1]);
  }
  return out;
}

/** 套用一步操作並推進，回傳這一步產生的事件 */
function apply(sim: BattleSim, s: Step): SimEvent[] {
  for (const id of [0, 1] as const) {
    sim.setControl(id, s.control[id]);
    if (s.special[id]) sim.useSpecial(id);
  }
  sim.step(STEP);
  return sim.drainEvents();
}

/** 建一場換過零件、在火山場的對戰（涵蓋零件、熔岩噴口、必殺增益） */
function makeSim(seed = 11): BattleSim {
  return new BattleSim(buildSpec('blaze', { disk: 'heavy', driver: 'bearing' }), TOP_SPECS.fafnir, {
    seed,
    launch: [0.95, 0.85],
    arena: ARENAS.volcano,
    aim: [0.2, -0.1],
  });
}

describe('模擬快照', () => {
  test('快照（經過 JSON）還原成新的模擬後，繼續推進與原本逐步完全相同（含事件）', () => {
    const sim = makeSim();
    record(sim, 240, 3);
    // 快照當下讓 0 號的必殺增益正在作用，確認增益、減益也會被還原
    sim.tops[0].special = 1;
    sim.useSpecial(0);
    sim.drainEvents();
    const snap: SimSnapshot = JSON.parse(JSON.stringify(sim.snapshot()));
    const copy = BattleSim.fromSnapshot(snap);

    const rng = createRng(99);
    for (let i = 0; i < 900 && !sim.result; i++) {
      const s: Step = {
        control: [cpuThink(sim, 0, rng).control, cpuThink(sim, 1, rng).control],
        special: [false, i === 300],
      };
      const e1 = apply(sim, s);
      const e2 = apply(copy, s);
      expect(e2, `第 ${i} 步事件不同`).toEqual(e1);
    }
    // toEqual 視 -0 與 0 相等（JSON 會把 -0 寫成 0，行為上沒有差別）
    expect(copy.snapshot()).toEqual(sim.snapshot());
    expect(copy.result).toEqual(sim.result);
  });

  test('還原進既有的模擬（客戶端預測用）：狀態覆寫後推進結果與原本相同', () => {
    const sim = makeSim();
    record(sim, 180, 4);
    const other = makeSim(12345);
    record(other, 60, 8);
    other.restore(sim.snapshot());
    const rng = createRng(7);
    for (let i = 0; i < 300; i++) {
      const s: Step = { control: [cpuThink(sim, 0, rng).control, cpuThink(sim, 1, rng).control], special: [false, false] };
      apply(sim, s);
      apply(other, s);
    }
    expect(other.snapshot()).toEqual(sim.snapshot());
  });

  test('快照是獨立的複本：之後修改快照不影響模擬，修改模擬也不影響快照', () => {
    const sim = makeSim();
    record(sim, 60, 5);
    const snap = sim.snapshot();
    const x = sim.tops[0].pos.x;
    snap.tops[0].pos.x = 999;
    expect(sim.tops[0].pos.x).toBe(x);
    sim.tops[1].pos.z = -999;
    expect(snap.tops[1].pos.z).not.toBe(-999);
  });

  test('規格不放進快照，只記代號與零件（還原時重建，零件的屬性照樣生效）', () => {
    const snap = makeSim().snapshot();
    expect(snap.tops[0]).not.toHaveProperty('spec');
    expect(snap.tops[0].specId).toBe('blaze');
    expect(snap.tops[0].parts).toEqual({ disk: 'heavy', driver: 'bearing' });
    const copy = BattleSim.fromSnapshot(snap);
    expect(copy.tops[0].spec.stats).toEqual(buildSpec('blaze', { disk: 'heavy', driver: 'bearing' }).stats);
    expect(copy.arena.id).toBe('volcano');
  });

  test('快照大小：JSON 在 2 KB 以內（每秒 20 次、每人約 40 KB/s 以下）', () => {
    const sim = makeSim();
    record(sim, 240, 6);
    expect(JSON.stringify(sim.snapshot()).length).toBeLessThan(2048);
  });
});
