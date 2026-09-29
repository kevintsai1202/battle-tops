import { describe, expect, test } from 'vitest';
import { createRng } from '../src/sim/rng';
import { cpuPickTeam, createMatch, currentPairing, recordResult, setOvertime } from '../src/sim/team';
import type { TopType } from '../src/sim/types';

const P: TopType[] = ['attack', 'defense', 'stamina'];
const C: TopType[] = ['balance', 'stamina', 'attack'];

/** 玩家（0）贏一戰 */
const pWin = (finish: 'spin' | 'over' | 'burst' = 'spin') => ({ finish, loser: 1, winner: 0 as const });
/** CPU（1）贏一戰 */
const cWin = (finish: 'spin' | 'over' | 'burst' = 'spin') => ({ finish, loser: 0, winner: 1 as const });
const draw = { finish: 'spin' as const, loser: 0, winner: null };

describe('建立 3 對 3 對戰', () => {
  test('雙方都必須剛好 3 顆且不重複', () => {
    expect(() => createMatch(['attack', 'defense'], C)).toThrow();
    expect(() => createMatch(['attack', 'attack', 'defense'], C)).toThrow();
    expect(() => createMatch(P, ['balance', 'balance', 'attack'])).toThrow();
    expect(createMatch(P, C).phase).toBe('regular');
  });

  test('第 i 戰是雙方各自的第 i 顆', () => {
    const m = createMatch(P, C);
    expect(currentPairing(m)).toEqual({ battle: 1, overtime: false, player: 'attack', cpu: 'balance' });
    recordResult(m, pWin());
    expect(currentPairing(m)).toEqual({ battle: 2, overtime: false, player: 'defense', cpu: 'stamina' });
  });
});

describe('計分與平手', () => {
  test('依終結方式加分給勝者：停轉 1、出場 2、爆裂 2', () => {
    const m = createMatch(P, C);
    recordResult(m, pWin('burst'));
    recordResult(m, cWin('spin'));
    expect(m.score).toEqual([2, 1]);
    expect(m.results.map((r) => r.points)).toEqual([
      [2, 0],
      [0, 1],
    ]);
  });

  test('同時倒下（平手）不計分，同一組重打', () => {
    const m = createMatch(P, C);
    recordResult(m, draw);
    expect(m.score).toEqual([0, 0]);
    expect(m.results).toHaveLength(0);
    expect(currentPairing(m)?.battle).toBe(1);
  });

  test('三戰打完總分較高者獲勝', () => {
    const m = createMatch(P, C);
    recordResult(m, pWin('over'));
    recordResult(m, cWin('spin'));
    recordResult(m, cWin('spin'));
    expect(m.score).toEqual([2, 2]);
    expect(m.phase).toBe('overtime');

    const m2 = createMatch(P, C);
    recordResult(m2, pWin('burst'));
    recordResult(m2, cWin('spin'));
    recordResult(m2, pWin('spin'));
    expect(m2.phase).toBe('done');
    expect(m2.winner).toBe(0);
    expect(currentPairing(m2)).toBeNull();
  });
});

describe('延長賽', () => {
  /** 做出三戰後總分平手的對戰 */
  function tied() {
    const m = createMatch(P, C);
    recordResult(m, pWin('over'));
    recordResult(m, cWin('spin'));
    recordResult(m, cWin('spin'));
    return m;
  }

  test('總分平手進入延長賽，雙方挑好之前沒有對陣', () => {
    const m = tied();
    expect(m.phase).toBe('overtime');
    expect(currentPairing(m)).toBeNull();
  });

  test('延長賽只能挑自己隊伍裡的陀螺', () => {
    const m = tied();
    expect(() => setOvertime(m, 'balance', 'attack')).toThrow();
    expect(() => setOvertime(m, 'attack', 'defense')).toThrow();
  });

  test('延長賽打一回合決勝，分數也加進總分；平手重打', () => {
    const m = tied();
    setOvertime(m, 'stamina', 'attack');
    expect(currentPairing(m)).toEqual({ battle: 4, overtime: true, player: 'stamina', cpu: 'attack' });
    recordResult(m, draw);
    expect(m.phase).toBe('overtime');
    expect(currentPairing(m)?.overtime).toBe(true);
    recordResult(m, cWin('burst'));
    expect(m.phase).toBe('done');
    expect(m.winner).toBe(1);
    expect(m.score).toEqual([2, 4]);
    expect(m.results).toHaveLength(4);
    expect(m.results[3].overtime).toBe(true);
  });
});

describe('CPU 組隊', () => {
  test('挑 3 顆不重複，同種子結果相同', () => {
    const a = cpuPickTeam(createRng(5));
    expect(new Set(a).size).toBe(3);
    expect(cpuPickTeam(createRng(5))).toEqual(a);
  });

  test('不同種子會有不同陣容或順序', () => {
    const seen = new Set<string>();
    for (let s = 1; s <= 20; s++) seen.add(cpuPickTeam(createRng(s)).join(','));
    expect(seen.size).toBeGreaterThan(3);
  });
});
