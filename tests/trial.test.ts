import { describe, expect, test } from 'vitest';
import { ARENAS } from '../src/sim/arena';
import { DIFFICULTIES } from '../src/sim/difficulty';
import { STOCK } from '../src/sim/parts';
import { buildSpec, TOP_SPECS } from '../src/sim/tops';
import { addTrialResult, AutoDuel, emptyTrialRecord, simulateDuel, trialKey, type TrialConfig } from '../src/sim/trial';

/** 試驗模式（一對一、自己指定雙方的陀螺與零件）的純邏輯：累計戰績、CPU 自動對打 */
const CFG: TrialConfig = {
  player: { top: 'blaze', loadout: STOCK },
  cpu: { top: 'turtle', loadout: STOCK },
  arena: 'practice',
  difficulty: 'normal',
};

describe('試驗模式的設定與累計戰績', () => {
  test('同一組設定（雙方陀螺、零件、場地、難度）的 key 相同；換任何一項就不同', () => {
    expect(trialKey(CFG)).toBe(trialKey(structuredClone(CFG)));
    expect(trialKey({ ...CFG, player: { top: 'blaze', loadout: { disk: 'heavy', driver: null } } })).not.toBe(trialKey(CFG));
    expect(trialKey({ ...CFG, cpu: { top: 'gale', loadout: STOCK } })).not.toBe(trialKey(CFG));
    expect(trialKey({ ...CFG, arena: 'stadium' })).not.toBe(trialKey(CFG));
    expect(trialKey({ ...CFG, difficulty: 'hard' })).not.toBe(trialKey(CFG));
  });

  test('記錄勝、敗、平手與各終結方式（以你的陀螺為主）', () => {
    let r = emptyTrialRecord();
    r = addTrialResult(r, { finish: 'over', loser: 1, winner: 0 });
    r = addTrialResult(r, { finish: 'xtreme', loser: 1, winner: 0 });
    r = addTrialResult(r, { finish: 'spin', loser: 0, winner: 1 });
    r = addTrialResult(r, { finish: 'burst', loser: 0, winner: null });
    expect(r).toMatchObject({ games: 4, wins: 2, losses: 1, draws: 1 });
    expect(r.finishes.over).toEqual([1, 0]);
    expect(r.finishes.xtreme).toEqual([1, 0]);
    expect(r.finishes.spin).toEqual([0, 1]);
    expect(r.finishes.burst).toEqual([0, 0]);
  });
});

describe('CPU 自動對打', () => {
  test('一場對打：同樣的種子結果相同，而且 120 秒內打完', () => {
    const a = buildSpec('blaze', STOCK);
    const b = TOP_SPECS.turtle;
    const opts = { launch: [0.9, 0.85] as [number, number], specialRate: 0.05 };
    const x = simulateDuel(a, b, ARENAS.practice, 7, opts);
    expect(simulateDuel(a, b, ARENAS.practice, 7, opts)).toEqual(x);
    expect(x.time).toBeLessThanOrEqual(120);
    expect(x.finish).not.toBeNull();
  });

  test('分批推進：每次一場，一半交換座位；結果以你的陀螺為主，勝＋敗＋平＝場數', () => {
    const duel = new AutoDuel(CFG, 10, 99);
    expect(duel.progress).toBe(0);
    let steps = 0;
    while (!duel.done) {
      duel.runNext();
      steps++;
    }
    expect(steps).toBe(10);
    expect(duel.progress).toBe(1);
    const s = duel.summary;
    expect(s.games).toBe(10);
    expect(s.wins + s.losses + s.draws).toBe(10);
    expect(s.seats).toEqual([5, 5]);
    const ends = Object.values(s.finishes).reduce((n, [w, l]: [number, number]) => n + w + l, 0);
    expect(ends).toBe(s.wins + s.losses);
    expect(s.avgTime).toBeGreaterThan(0);
    // 同樣的設定與種子結果相同
    const again = new AutoDuel(CFG, 10, 99);
    while (!again.done) again.runNext();
    expect(again.summary).toEqual(s);
  });

  test('雙方的發射力道與必殺頻率都照難度的 CPU 設定（兩邊一樣，比較才公平）', () => {
    const d = DIFFICULTIES.hard;
    const duel = new AutoDuel({ ...CFG, difficulty: 'hard' }, 2, 1);
    duel.runNext();
    const [p, c] = duel.lastLaunch!;
    for (const v of [p, c]) {
      expect(v).toBeGreaterThanOrEqual(d.cpuLaunch[0]);
      expect(v).toBeLessThanOrEqual(d.cpuLaunch[1]);
    }
  });
});
