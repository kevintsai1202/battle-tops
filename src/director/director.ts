import type { V2 } from '../sim/types';

/** 鏡頭導演參數 */
export interface DirectorConfig {
  /** 撞擊強度超過此值觸發特寫 */
  closeupThreshold: number;
  /** 特寫結束後的冷卻（牆鐘秒），避免連續觸發 */
  cooldown: number;
  /** 特寫長度（牆鐘秒） */
  closeupDuration: number;
  /** 特寫時的時間流速 */
  slowScale: number;
  /** 終結鏡頭慢動作長度（牆鐘秒） */
  finishDuration: number;
  /** 終結鏡頭時間流速 */
  finishScale: number;
  /** 反白衝擊幀長度（牆鐘秒） */
  flashTime: number;
  /** 必殺 cut-in 的凍結長度（牆鐘秒）與這段期間的時間流速倍率（和特寫、終結的流速相乘） */
  specialFreezeTime: number;
  specialFreezeScale: number;
}

const DEFAULTS: DirectorConfig = {
  closeupThreshold: 6,
  cooldown: 2.5,
  closeupDuration: 1.3,
  slowScale: 0.07,
  finishDuration: 2.8,
  finishScale: 0.2,
  flashTime: 0.09,
  specialFreezeTime: 1.1,
  specialFreezeScale: 0.12,
};

export type DirectorMode = 'overview' | 'closeup' | 'finish';

/** 撞擊資訊（取自模擬事件） */
export interface ClashInfo {
  pos: V2;
  normal: V2;
  intensity: number;
}

/**
 * 鏡頭導演：決定現在是全景、撞擊特寫或終結鏡頭，並輸出時間流速、衝擊幀與震動量。
 * 全部以牆鐘時間推進——模擬慢下來時，特寫的鏡頭環繞仍照常進行。
 * 只負責「決策」，實際鏡頭擺位由渲染層依 mode／focus／progress 計算。
 * 線上對戰時伺服器也用同一份邏輯決定時間流速（必殺 cut-in 的凍結也在這裡），客戶端用 force* 照伺服器的事件切換。
 */
export class CameraDirector {
  readonly config: DirectorConfig;
  mode: DirectorMode = 'overview';
  /** 模擬時間流速（1 = 正常） */
  timeScale = 1;
  /** 反白衝擊幀強度 0..1 */
  impactFlash = 0;
  /** 畫面震動量 0..1 */
  shake = 0;
  /** 特寫／終結鏡頭的焦點 */
  focus: V2 = { x: 0, z: 0 };
  /** 撞擊法線（決定特寫從哪個角度看） */
  normal: V2 = { x: 1, z: 0 };
  /** 觸發特寫的撞擊強度 */
  intensity = 0;
  /** 進入目前模式後經過的牆鐘秒數 */
  modeTime = 0;
  /** 本次特寫觸發的累計次數（e2e 觀察用） */
  closeups = 0;
  /** 必殺凍結剩餘的牆鐘秒數（0 = 沒有凍結） */
  specialFreeze = 0;
  private clock = 0;
  private cooldownUntil = -Infinity;

  constructor(config: Partial<DirectorConfig> = {}) {
    this.config = { ...DEFAULTS, ...config };
  }

  /** 通知一次撞擊；若觸發特寫回傳 true */
  notifyClash(c: ClashInfo): boolean {
    this.shake = Math.max(this.shake, Math.min(1, c.intensity / 12));
    if (this.mode !== 'overview') return false;
    if (c.intensity < this.config.closeupThreshold || this.clock < this.cooldownUntil) return false;
    this.startCloseup(c);
    return true;
  }

  /**
   * 直接進入撞擊特寫，不看門檻、冷卻與目前模式（線上對戰的客戶端照伺服器的導演事件切換，
   * 雙方的慢動作才會一致）。
   */
  forceCloseup(c: ClashInfo): void {
    this.shake = Math.max(this.shake, Math.min(1, c.intensity / 12));
    this.startCloseup(c);
  }

  /** 直接進入終結鏡頭（線上對戰的客戶端用，同 notifyFinish） */
  forceFinish(pos: V2): void {
    this.notifyFinish(pos);
  }

  /** 必殺 cut-in：接下來 specialFreezeTime 秒時間流速再乘上 specialFreezeScale */
  notifySpecial(): void {
    this.specialFreeze = this.config.specialFreezeTime;
  }

  /** 切進撞擊特寫 */
  private startCloseup(c: ClashInfo): void {
    this.mode = 'closeup';
    this.modeTime = 0;
    this.focus = { ...c.pos };
    this.normal = { ...c.normal };
    this.intensity = c.intensity;
    this.impactFlash = 1;
    this.closeups++;
  }

  /** 通知回合終結：切到終結鏡頭（優先於特寫） */
  notifyFinish(pos: V2): void {
    this.mode = 'finish';
    this.modeTime = 0;
    this.focus = { ...pos };
    this.impactFlash = 1;
    this.shake = 1;
  }

  /** 回到全景（新回合開始時呼叫） */
  reset(): void {
    this.mode = 'overview';
    this.timeScale = 1;
    this.impactFlash = 0;
    this.shake = 0;
    this.modeTime = 0;
    this.specialFreeze = 0;
    this.cooldownUntil = this.clock + 1;
  }

  /** 目前模式的進度 0..1 */
  get progress(): number {
    if (this.mode === 'closeup') return Math.min(1, this.modeTime / this.config.closeupDuration);
    if (this.mode === 'finish') return Math.min(1, this.modeTime / this.config.finishDuration);
    return 0;
  }

  /** 以牆鐘時間 dt 推進 */
  update(dt: number): void {
    const cfg = this.config;
    this.clock += dt;
    this.modeTime += dt;
    this.shake *= Math.exp(-dt * 4);

    if (this.mode === 'closeup') {
      const t = this.modeTime;
      const D = cfg.closeupDuration;
      this.impactFlash = t < cfg.flashTime ? 1 : 0;
      if (t >= D) {
        this.mode = 'overview';
        this.timeScale = 1;
        this.cooldownUntil = this.clock + cfg.cooldown;
      } else {
        this.timeScale = slowCurve(t, D, cfg.slowScale, 0.35);
      }
    } else if (this.mode === 'finish') {
      const t = this.modeTime;
      this.impactFlash = t < cfg.flashTime ? 1 : 0;
      this.timeScale = t >= cfg.finishDuration ? 1 : slowCurve(t, cfg.finishDuration, cfg.finishScale, 0.6);
    } else {
      this.timeScale = 1;
      this.impactFlash = 0;
    }
    // 必殺凍結：和目前模式的流速相乘
    if (this.specialFreeze > 0) {
      this.specialFreeze = Math.max(0, this.specialFreeze - dt);
      if (this.specialFreeze > 0) this.timeScale *= cfg.specialFreezeScale;
    }
  }
}

/** 慢動作曲線：0.04 秒內急降到 slow，最後 ramp 秒平滑回到 1 */
function slowCurve(t: number, duration: number, slow: number, ramp: number): number {
  const drop = 0.04;
  if (t < drop) return 1 + (slow - 1) * (t / drop);
  if (t < duration - ramp) return slow;
  const k = Math.min(1, (t - (duration - ramp)) / ramp);
  const s = k * k * (3 - 2 * k);
  return slow + (1 - slow) * s;
}
