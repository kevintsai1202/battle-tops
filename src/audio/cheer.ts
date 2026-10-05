/**
 * 觀眾歡呼的規則（純邏輯，音效引擎 src/audio/engine.ts 用；單元測試 tests/cheer.test.ts）。
 * 歡呼是真實錄音（public/sfx/cheer.mp3，CC0），只在關鍵時刻播：終結最大聲、必殺中等、重擊最小聲。
 * 同一段時間內只播一聲：冷卻中更小或一樣大的丟掉，更大的取代正在播的那一聲。
 */

/** 各種時刻的歡呼強度（1 = 完整大小、播完整段） */
export const CHEER_LEVEL = { finish: 1, special: 0.6, bigClash: 0.35 } as const;

/** 冷卻秒數：這段時間內只接受更大聲的歡呼 */
export const CHEER_COOLDOWN = 2.5;

/** 最小聲時也至少播這麼久（秒），不然聽起來像被切掉 */
const MIN_LENGTH = 1.2;

/** 依強度決定播多長（秒）：最大聲播完整段（full 為錄音長度），越小聲越早收尾 */
export function cheerLength(level: number, full: number): number {
  if (full <= MIN_LENGTH) return full;
  return Math.min(full, MIN_LENGTH + (full - MIN_LENGTH) * level);
}

/** 歡呼的閘門：決定這一聲要播、取代正在播的，還是丟掉 */
export class CheerGate {
  /** 上一聲開始的時間（秒）與強度 */
  private last = -Infinity;
  private lastLevel = 0;

  /** now 為現在的時間（秒）；回傳 'play' 播、'replace' 先停掉正在播的再播、null 丟掉 */
  request(now: number, level: number): 'play' | 'replace' | null {
    const cooling = now - this.last < CHEER_COOLDOWN;
    if (cooling && level <= this.lastLevel) return null;
    this.last = now;
    this.lastLevel = level;
    return cooling ? 'replace' : 'play';
  }
}
