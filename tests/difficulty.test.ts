import { describe, expect, test } from 'vitest';
import { BattleSim } from '../src/sim/battle';
import { cpuThink } from '../src/sim/cpu';
import { DIFFICULTIES } from '../src/sim/difficulty';
import { launchSpinRatio, STRICT_WINDOW } from '../src/sim/rules';
import { TOP_SPECS } from '../src/sim/tops';

describe('難度設定', () => {
  const { easy, normal, hard } = DIFFICULTIES;

  test('越簡單發射判定越寬、最低力道越高', () => {
    expect(easy.launch.perfect).toBeGreaterThan(normal.launch.perfect);
    expect(normal.launch.perfect).toBeGreaterThan(hard.launch.perfect);
    expect(easy.launch.min).toBeGreaterThan(normal.launch.min);
    expect(normal.launch.min).toBeGreaterThan(hard.launch.min);
  });

  test('越難 CPU 發射力道越強', () => {
    expect(easy.cpuLaunch[1]).toBeLessThanOrEqual(normal.cpuLaunch[1]);
    expect(normal.cpuLaunch[0]).toBeLessThan(hard.cpuLaunch[0]);
    expect(easy.cpuSpecialRate).toBeLessThan(normal.cpuSpecialRate);
  });

  test('困難等於原本的嚴格判定', () => {
    expect(hard.launch).toEqual(STRICT_WINDOW);
  });
});

describe('放寬後的發射判定', () => {
  test('簡單：誤差 0.12 秒仍滿分，最低 0.8', () => {
    const w = DIFFICULTIES.easy.launch;
    expect(launchSpinRatio(0.12, w)).toBe(1);
    expect(launchSpinRatio(0.6, w)).toBeCloseTo(0.8, 10);
    expect(launchSpinRatio(2, w)).toBe(0.8);
  });

  test('普通：誤差 0.08 秒仍滿分，最低 0.65', () => {
    const w = DIFFICULTIES.normal.launch;
    expect(launchSpinRatio(0.08, w)).toBe(1);
    expect(launchSpinRatio(-0.08, w)).toBe(1);
    expect(launchSpinRatio(2, w)).toBe(0.65);
  });
});

describe('CPU 必殺頻率', () => {
  /** 兩顆靠很近、CPU 量表全滿（攻擊型在 2.2 內就會想放必殺） */
  function ready() {
    const sim = new BattleSim(TOP_SPECS.balance, TOP_SPECS.attack, { seed: 1, launch: [0.9, 0.9] });
    sim.tops[0].pos = { x: -0.5, z: 0 };
    sim.tops[1].pos = { x: 0.5, z: 0 };
    sim.tops[1].special = 1;
    return sim;
  }

  test('頻率 0 永遠不放必殺；預設頻率在條件成立時會放', () => {
    expect(cpuThink(ready(), 1, () => 0, 0).special).toBe(false);
    expect(cpuThink(ready(), 1, () => 0).special).toBe(true);
  });
});
