/**
 * 拉發射台（拉條）的判定：純函式，不碰 DOM。
 * 玩家在倒數時按住畫面往下拉，放手的瞬間發射：
 * - 拉得越長、越快，力道越高；
 * - 放手時機越接近「ゴー」，力道越高（沿用難度的發射判定視窗）；
 * - 左右拉的角度決定發射方向（像彈弓：往左拉，陀螺往右飛），最多偏 ±35°。
 */

/** 拉條過程的一個取樣點：時間（秒）與螢幕座標（px，y 往下為正） */
export interface PullSample {
  t: number;
  x: number;
  y: number;
}

/** 拉條的量測結果 */
export interface PullMetrics {
  /** 拉的長度 0..1（拉到畫面短邊的 45% 為滿） */
  length: number;
  /** 拉的速度 0..1（最快的一段達到每秒 3 個畫面短邊為滿） */
  speed: number;
  /** 瞄準角度（弧度，正值 = 螢幕上往右偏），限制在 ±MAX_AIM */
  aim: number;
}

/** 最大瞄準偏角（35°） */
export const MAX_AIM = (35 * Math.PI) / 180;
/** 量測速度的最短時間窗（秒），避免單一抖動取樣造成超高速 */
const SPEED_WINDOW = 0.05;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * 量測一次拉條。scale 為畫面短邊長度（px），讓手機與電腦的手感一致。
 * 往上拉（反方向）不算長度；左右拉只影響角度。
 */
export function measurePull(samples: PullSample[], scale: number): PullMetrics {
  if (samples.length < 2 || scale <= 0) return { length: 0, speed: 0, aim: 0 };
  const a = samples[0];
  const b = samples[samples.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const pull = Math.max(0, dy) + Math.abs(dx) * 0.35;
  const length = clamp01(pull / (scale * 0.45));

  // 最快的一段：任兩個取樣點間隔至少 SPEED_WINDOW 秒，取往下（與總方向一致）的速度最大值
  let peak = 0;
  let j = 0;
  for (let i = 0; i < samples.length; i++) {
    while (j < samples.length && samples[j].t - samples[i].t < SPEED_WINDOW) j++;
    if (j >= samples.length) break;
    const s = samples[i];
    const e = samples[j];
    const d = Math.max(0, e.y - s.y) + Math.abs(e.x - s.x) * 0.35;
    peak = Math.max(peak, d / (e.t - s.t));
  }
  const speed = clamp01(peak / (scale * 3));

  // 彈弓式瞄準：往左下拉 → 往右飛
  const raw = dy > 1 ? Math.atan2(-dx, dy) : 0;
  const aim = Math.max(-MAX_AIM, Math.min(MAX_AIM, raw));
  return { length, speed, aim };
}

/** 拉條品質 0..1：速度佔 55%、長度佔 45% */
export function pullQuality(m: PullMetrics): number {
  return clamp01(0.45 * m.length + 0.55 * m.speed);
}

/**
 * 最終發射力道（轉速比例 0.5..1）＝ 時機分 ×（保底 + 拉條品質加成）。
 * timing 為 launchSpinRatio 算出的時機分；base 為難度的拉條保底（簡單較高）。
 */
export function pullLaunchRatio(timing: number, m: PullMetrics, base: number): number {
  const r = timing * (base + (1 - base) * pullQuality(m));
  return Math.max(0.5, Math.min(1, r));
}

/** Space 鍵的簡易發射：只看時機，最高 85%（鼓勵用拉的） */
export const KEY_LAUNCH_CAP = 0.85;
export function keyLaunchRatio(timing: number): number {
  return Math.max(0.5, Math.min(KEY_LAUNCH_CAP, timing));
}
