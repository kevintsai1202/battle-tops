import type { TeamMatch } from '../sim/team';
import type { TopId } from '../sim/types';
import type { ResultRow } from './protocol';

/**
 * 把伺服器送來的「自己／對手」觀點戰績轉成 TeamMatch（自己＝player、對手＝cpu），
 * 讓 HUD 的賽況列與結果畫面沿用 CPU 模式的顯示邏輯。對手的隊伍是依名鑑排序的（出場順序保密）。
 * winner 給了表示整場已結束。
 */
export function perspectiveMatch(mine: TopId[], theirs: TopId[], rows: ResultRow[], score: [number, number], winner?: 'me' | 'them'): TeamMatch {
  return {
    player: [...mine],
    cpu: [...theirs],
    results: rows.map((r) => ({
      battle: r.battle,
      overtime: r.overtime,
      player: r.mine,
      cpu: r.theirs,
      winner: r.winner === 'me' ? 0 : 1,
      finish: r.finish,
      points: [r.points[0], r.points[1]],
    })),
    score: [score[0], score[1]],
    phase: winner ? 'done' : 'regular',
    overtimePick: null,
    winner: winner ? (winner === 'me' ? 0 : 1) : null,
  };
}
