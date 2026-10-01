import { describe, expect, test } from 'vitest';
import { perspectiveMatch } from '../../src/net/perspective';
import type { ResultRow } from '../../src/net/protocol';

describe('線上對戰的觀點轉換', () => {
  test('自己＝player、對手＝cpu；戰績的勝方與分數對應到 0（自己）／1（對手）', () => {
    const rows: ResultRow[] = [
      { battle: 1, overtime: false, mine: 'blaze', theirs: 'wolf', winner: 'me', finish: 'burst', points: [2, 0] },
      { battle: 2, overtime: false, mine: 'turtle', theirs: 'orion', winner: 'them', finish: 'spin', points: [0, 1] },
    ];
    const m = perspectiveMatch(['blaze', 'turtle', 'gale'], ['orion', 'pegasus', 'wolf'], rows, [2, 1]);
    expect(m.player).toEqual(['blaze', 'turtle', 'gale']);
    expect(m.cpu).toEqual(['orion', 'pegasus', 'wolf']);
    expect(m.score).toEqual([2, 1]);
    expect(m.results).toEqual([
      { battle: 1, overtime: false, player: 'blaze', cpu: 'wolf', winner: 0, finish: 'burst', points: [2, 0] },
      { battle: 2, overtime: false, player: 'turtle', cpu: 'orion', winner: 1, finish: 'spin', points: [0, 1] },
    ]);
  });

  test('結果畫面用：有勝方時標成已結束', () => {
    const m = perspectiveMatch(['a'], ['b'], [], [4, 2], 'me');
    expect(m.phase).toBe('done');
    expect(m.winner).toBe(0);
    expect(perspectiveMatch(['a'], ['b'], [], [2, 4], 'them').winner).toBe(1);
    expect(perspectiveMatch(['a'], ['b'], [], [0, 0]).phase).toBe('regular');
  });
});
