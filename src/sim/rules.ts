import type { FinishType } from './types';

/** 各終結方式的得分 */
export const FINISH_POINTS: Record<FinishType, number> = { spin: 1, over: 2, burst: 2 };

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
