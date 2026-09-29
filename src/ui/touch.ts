/** 搖桿輸出：x 往右為正，y 往前（螢幕上方）為正，長度 ≤ 1 */
export interface StickVector {
  x: number;
  y: number;
}

/**
 * 把手指相對搖桿中心的位移（螢幕像素，dy 往下為正）換算成搖桿向量。
 * 死區內回傳 0；死區外從 0 平滑增加到 1；超出底盤半徑截斷為長度 1。
 */
export function joystickVector(dx: number, dy: number, radius: number, deadzone: number): StickVector {
  const m = Math.hypot(dx, dy) / radius;
  if (m <= deadzone) return { x: 0, y: 0 };
  const strength = Math.min(1, (m - deadzone) / (1 - deadzone));
  const len = Math.hypot(dx, dy);
  return { x: (dx / len) * strength, y: (-dy / len) * strength };
}

/** 必殺按鈕狀態 */
export type SpecialState = 'charging' | 'ready' | 'used';

const DEADZONE = 0.18;

/**
 * 手機觸控操作：左下虛擬搖桿（推移）與右下必殺按鈕。
 * 搖桿自己記錄 pointerId、在 window 上追蹤移動，不用 setPointerCapture：
 * 手指滑出底盤仍能持續操控，合成事件（e2e）也不會因為 capture 失敗而中斷。
 */
export class TouchControls {
  /** 目前的搖桿向量 */
  vector: StickVector = { x: 0, y: 0 };
  private readonly root: HTMLElement;
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly btn: HTMLButtonElement;
  private pointerId: number | null = null;
  private cx = 0;
  private cy = 0;
  private radius = 60;

  constructor(onSpecial: () => void) {
    this.root = document.getElementById('touch')!;
    this.base = this.root.querySelector('.stick')!;
    this.knob = this.root.querySelector('.knob')!;
    this.btn = this.root.querySelector('.special-btn')!;

    this.base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.pointerId !== null) return;
      const r = this.base.getBoundingClientRect();
      this.cx = r.left + r.width / 2;
      this.cy = r.top + r.height / 2;
      this.radius = r.width * 0.42;
      this.pointerId = e.pointerId;
      this.move(e.clientX, e.clientY);
    });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.pointerId) this.move(e.clientX, e.clientY);
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId === this.pointerId) this.reset();
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);

    this.btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      onSpecial();
    });
    // 長按不要跳出系統選單
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** 手指位置更新：換算向量並移動搖桿頭（最多移到底盤邊緣） */
  private move(x: number, y: number): void {
    const dx = x - this.cx;
    const dy = y - this.cy;
    this.vector = joystickVector(dx, dy, this.radius, DEADZONE);
    const d = Math.hypot(dx, dy);
    const k = d > this.radius ? this.radius / d : 1;
    this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  }

  /** 放開：搖桿歸零 */
  reset(): void {
    this.pointerId = null;
    this.vector = { x: 0, y: 0 };
    this.knob.style.transform = '';
  }

  /** 顯示或隱藏觸控操作；隱藏時一併放開搖桿 */
  setVisible(on: boolean): void {
    if (this.root.hidden === !on) return;
    this.root.hidden = !on;
    if (!on) this.reset();
  }

  /** 更新必殺按鈕：fill 為量表 0..1 */
  setSpecial(state: SpecialState, fill: number): void {
    this.btn.style.setProperty('--fill', `${Math.round(Math.min(1, fill) * 100)}%`);
    this.btn.classList.toggle('ready', state === 'ready');
    this.btn.classList.toggle('used', state === 'used');
  }
}
