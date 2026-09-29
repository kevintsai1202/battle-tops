import type { FinishType } from './types';

/** 各終結方式的得分 */
export const FINISH_POINTS: Record<FinishType, number> = { spin: 1, over: 2, burst: 2 };

/** 發射判定視窗：perfect 秒內滿分，誤差到 worst 秒線性降到最低力道 min */
export interface LaunchWindow {
  perfect: number;
  worst: number;
  min: number;
}

/** 最嚴格的判定（困難難度，也是最初版本的規則） */
export const STRICT_WINDOW: LaunchWindow = { perfect: 0.05, worst: 0.4, min: 0.5 };

/**
 * 發射時機換算初始轉速比例。
 * errorSec 為按下時間與「ゴー」節拍的誤差（秒，提早為負），提早與延遲對稱。
 */
export function launchSpinRatio(errorSec: number, w: LaunchWindow = STRICT_WINDOW): number {
  const e = Math.abs(errorSec);
  if (e <= w.perfect) return 1;
  if (e >= w.worst) return w.min;
  return 1 - (1 - w.min) * ((e - w.perfect) / (w.worst - w.perfect));
}
