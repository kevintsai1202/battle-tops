import type { FinishType } from './types';

/** 各終結方式的得分 */
export const FINISH_POINTS: Record<FinishType, number> = { spin: 1, over: 2, burst: 2 };

/** 先拿到幾分獲勝 */
export const WIN_POINTS = 3;

/** 把一次終結的分數加給勝者（loser 的對手），回傳新比分 */
export function awardFinish(score: [number, number], loser: number, finish: FinishType): [number, number] {
  const next: [number, number] = [score[0], score[1]];
  next[loser === 0 ? 1 : 0] += FINISH_POINTS[finish];
  return next;
}

/** 回傳已達勝利分數的一方，還沒分出勝負時為 null */
export function matchWinner(score: [number, number]): 0 | 1 | null {
  if (score[0] >= WIN_POINTS) return 0;
  if (score[1] >= WIN_POINTS) return 1;
  return null;
}

/**
 * 發射時機換算初始轉速比例。
 * errorSec 為按下時間與「ゴー」節拍的誤差（秒，提早為負）；
 * ±0.05 秒內滿分，誤差到 0.4 秒線性降到 0.5，之後維持 0.5。
 */
export function launchSpinRatio(errorSec: number): number {
  const e = Math.abs(errorSec);
  const perfect = 0.05;
  const worst = 0.4;
  if (e <= perfect) return 1;
  if (e >= worst) return 0.5;
  return 1 - 0.5 * ((e - perfect) / (worst - perfect));
}
