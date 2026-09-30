/** 推移向量（螢幕座標系）：x 往右為正，y 往前（螢幕上方）為正，長度 ≤ 1 */
export interface StickVector {
  x: number;
  y: number;
}

/** 螢幕座標點（px） */
interface Pt {
  x: number;
  y: number;
}

/**
 * 把手指相對浮動原點的位移（螢幕像素，dy 往下為正）換算成推移向量。
 * 死區內回傳 0；死區外從 0 平滑增加到 1；超出半徑截斷為長度 1。
 */
export function dragVector(dx: number, dy: number, radius: number, deadzone: number): StickVector {
  const m = Math.hypot(dx, dy) / radius;
  if (m <= deadzone) return { x: 0, y: 0 };
  const strength = Math.min(1, (m - deadzone) / (1 - deadzone));
  const len = Math.hypot(dx, dy);
  return { x: (dx / len) * strength, y: (-dy / len) * strength };
}

/**
 * 浮動原點跟隨：手指離原點超過半徑時，原點沿著手指方向被拖過去，保持剛好半徑的距離。
 * 這樣手指往回拉一點點方向就會反轉，不必拉回原本按下的位置。
 */
export function followOrigin(origin: Pt, finger: Pt, radius: number): Pt {
  const dx = finger.x - origin.x;
  const dy = finger.y - origin.y;
  const d = Math.hypot(dx, dy);
  if (d <= radius) return origin;
  const k = (d - radius) / d;
  return { x: origin.x + dx * k, y: origin.y + dy * k };
}

/** 手勢事件：三指觸控發動必殺、快甩衝刺（dir 為螢幕方向的單位向量，y 往前為正） */
export type GestureEvent = { type: 'special' } | { type: 'flick'; dir: StickVector };

/** 手勢追蹤器的參數 */
export interface GestureOptions {
  /** 拖曳半徑（px）：拖到這麼遠為全力推移 */
  radius: number;
  /** 死區（佔半徑的比例） */
  deadzone: number;
  /** 尺度（畫面短邊 px）：快甩的距離與速度門檻以它為基準 */
  scale: number;
}

/** 快甩：看放手前這麼多秒內的移動 */
const FLICK_WINDOW = 0.1;
/** 快甩的最小距離（佔畫面短邊） */
const FLICK_MIN_DIST = 0.1;
/** 快甩的最小速度（每秒幾個畫面短邊） */
const FLICK_MIN_SPEED = 2;
/** 同時幾隻手指算三指觸控 */
const SPECIAL_FINGERS = 3;

/**
 * 手勢追蹤（純邏輯，不碰 DOM，方便單元測試）：
 * - 單指按住拖曳：按下的位置是浮動原點，往哪拖就往哪推，拖越遠越用力，放開停止。
 * - 快甩：放手前 0.1 秒內甩得夠快夠遠 → 衝刺（看放手前的速度，不看拖了多久）。
 * - 三指觸控：第三隻手指按下的瞬間發動必殺（不等放開），直到全部手指放開前只發一次。
 * 規則：只有「畫面上沒有其他手指時按下的那一指」會變成拖曳手指；拖曳期間只要出現過第二指，
 * 放手就不算快甩（避免三指必殺或雙指操作時誤觸衝刺）。
 */
export class GestureTracker {
  private readonly opts: GestureOptions;
  /** 按著的手指（pointerId → 目前位置） */
  private readonly fingers = new Map<number, Pt>();
  /** 拖曳手指（沒有時為 null） */
  private dragId: number | null = null;
  /** 浮動原點與拖曳手指目前的位置 */
  private origin: Pt = { x: 0, y: 0 };
  private finger: Pt = { x: 0, y: 0 };
  /** 拖曳手指最近的取樣點（快甩判定用） */
  private samples: { t: number; x: number; y: number }[] = [];
  /** 這次拖曳期間出現過第二隻手指 */
  private multi = false;
  /** 這一輪（從第一指按下到全部放開）已經發動過三指必殺 */
  private specialFired = false;

  constructor(opts: GestureOptions) {
    this.opts = opts;
  }

  /** 是否正在拖曳 */
  get dragging(): boolean {
    return this.dragId !== null;
  }

  /** 浮動原點與拖曳手指的位置（畫面指示用；沒在拖時為 null） */
  get handle(): { origin: Pt; finger: Pt } | null {
    return this.dragId === null ? null : { origin: this.origin, finger: this.finger };
  }

  /** 更新尺度（畫面大小改變時） */
  setScale(scale: number, radius: number): void {
    this.opts.scale = scale;
    this.opts.radius = radius;
  }

  /** 手指按下 */
  down(id: number, x: number, y: number, t: number): GestureEvent[] {
    const out: GestureEvent[] = [];
    this.fingers.set(id, { x, y });
    if (this.fingers.size === 1 && this.dragId === null) {
      this.dragId = id;
      this.origin = { x, y };
      this.finger = { x, y };
      this.samples = [{ t, x, y }];
      this.multi = false;
    } else if (this.dragId !== null) {
      this.multi = true;
    }
    if (this.fingers.size >= SPECIAL_FINGERS && !this.specialFired) {
      this.specialFired = true;
      out.push({ type: 'special' });
    }
    return out;
  }

  /** 手指移動 */
  move(id: number, x: number, y: number, t: number): void {
    if (!this.fingers.has(id)) return;
    this.fingers.set(id, { x, y });
    if (id !== this.dragId) return;
    this.finger = { x, y };
    this.origin = followOrigin(this.origin, this.finger, this.opts.radius);
    this.samples.push({ t, x, y });
    // 只留最近一小段（快甩只看放手前 FLICK_WINDOW 秒）
    while (this.samples.length > 2 && this.samples[1].t < t - FLICK_WINDOW * 2) this.samples.shift();
  }

  /** 手指放開；拖曳手指放開時判定是否快甩 */
  up(id: number, x: number, y: number, t: number): GestureEvent[] {
    const out: GestureEvent[] = [];
    if (!this.fingers.has(id)) return out;
    this.fingers.delete(id);
    if (id === this.dragId) {
      // 放手的位置和最後一次移動相同時不另外記（放手事件可能晚一點才送到，不該把速度算低）
      const prev = this.samples[this.samples.length - 1];
      if (!prev || prev.x !== x || prev.y !== y) this.samples.push({ t, x, y });
      const dir = this.multi ? null : this.flickDir(t);
      if (dir) out.push({ type: 'flick', dir });
      this.dragId = null;
      this.samples = [];
    }
    if (this.fingers.size === 0) this.specialFired = false;
    return out;
  }

  /** 手指被系統取消（來電、手勢被瀏覽器接手）：當作放開，但不判定快甩 */
  cancel(id: number): void {
    this.fingers.delete(id);
    if (id === this.dragId) {
      this.dragId = null;
      this.samples = [];
    }
    if (this.fingers.size === 0) this.specialFired = false;
  }

  /** 清空所有手指（離開對戰畫面時） */
  reset(): void {
    this.fingers.clear();
    this.dragId = null;
    this.samples = [];
    this.multi = false;
    this.specialFired = false;
  }

  /** 目前的推移向量（沒在拖時為 0） */
  vector(): StickVector {
    if (this.dragId === null) return { x: 0, y: 0 };
    return dragVector(this.finger.x - this.origin.x, this.finger.y - this.origin.y, this.opts.radius, this.opts.deadzone);
  }

  /**
   * 快甩判定：最後一次移動必須在放手前 FLICK_WINDOW 秒內（甩完停住再放不算），
   * 並看最後一次移動之前 FLICK_WINDOW 秒內的移動夠快夠遠 → 回傳方向（螢幕 y 往下轉成往前為正），否則 null。
   */
  private flickDir(now: number): StickVector | null {
    const s = this.samples;
    const last = s[s.length - 1];
    if (!last || now - last.t > FLICK_WINDOW) return null;
    // 取窗口內最早的取樣點；窗口內只有最後一點時，用窗口前最後一點
    let first = last;
    for (let i = s.length - 2; i >= 0; i--) {
      if (s[i].t < last.t - FLICK_WINDOW) {
        if (first === last) first = s[i];
        break;
      }
      first = s[i];
    }
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const dist = Math.hypot(dx, dy);
    const dt = Math.max(1e-3, last.t - first.t);
    const { scale } = this.opts;
    if (dist < FLICK_MIN_DIST * scale || dist / dt < FLICK_MIN_SPEED * scale) return null;
    return { x: dx / dist, y: -dy / dist };
  }
}

/** 拖曳死區 */
const DEADZONE = 0.18;

/** 事件處理：三指必殺、快甩衝刺（dir 為螢幕方向） */
export interface SwipeHandlers {
  onSpecial: () => void;
  onFlick: (dir: StickVector) => void;
}

/**
 * 手機觸控操作（取代原本的虛擬搖桿與必殺按鈕）：在畫面任意處滑動控制方向、快甩衝刺、三指觸控發動必殺。
 * 只處理觸控（pointerType === 'touch'），只在對戰中啟用；畫面上用淡淡的圓圈標出浮動原點與手指。
 * 手指自己記 pointerId，不用 setPointerCapture（合成事件的 pointerId 不一定有效，會拋錯）。
 */
export class SwipeControls {
  private readonly tracker: GestureTracker;
  private enabled = false;
  private readonly root: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly dot: HTMLElement;
  /** 發動過的快甩次數（e2e 觀察用） */
  flicks = 0;

  constructor(h: SwipeHandlers) {
    this.root = document.getElementById('swipe')!;
    this.ring = this.root.querySelector('.ring')!;
    this.dot = this.root.querySelector('.dot')!;
    this.tracker = new GestureTracker({ radius: 70, deadzone: DEADZONE, scale: 400 });
    const now = () => performance.now() / 1000;
    const handle = (events: { type: string; dir?: StickVector }[]) => {
      for (const e of events) {
        if (e.type === 'special') h.onSpecial();
        else if (e.type === 'flick' && e.dir) {
          this.flicks++;
          h.onFlick(e.dir);
        }
      }
    };
    window.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.pointerType !== 'touch') return;
      this.fit();
      handle(this.tracker.down(e.pointerId, e.clientX, e.clientY, now()));
      this.draw();
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.enabled || e.pointerType !== 'touch') return;
      this.tracker.move(e.pointerId, e.clientX, e.clientY, now());
      this.draw();
    });
    window.addEventListener('pointerup', (e) => {
      if (!this.enabled || e.pointerType !== 'touch') return;
      handle(this.tracker.up(e.pointerId, e.clientX, e.clientY, now()));
      this.draw();
    });
    window.addEventListener('pointercancel', (e) => {
      if (e.pointerType !== 'touch') return;
      this.tracker.cancel(e.pointerId);
      this.draw();
    });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /**
   * 多指觸控時擋掉瀏覽器預設手勢（縮放、捲動）；系統層級的三指手勢（部分手機的三指截圖）擋不掉。
   * 非 passive 的 touchstart 會讓瀏覽器每次觸控都等主執行緒，所以只在啟用（對戰中）時掛上，
   * 不拖慢發射台的拉條。
   */
  private readonly blockMulti = (e: TouchEvent) => {
    if (e.touches.length >= 2) e.preventDefault();
  };

  /** 依畫面大小設定拖曳半徑與快甩尺度 */
  private fit(): void {
    const s = Math.min(window.innerWidth, window.innerHeight);
    this.tracker.setScale(s, Math.max(40, Math.min(90, s * 0.16)));
  }

  /** 目前的推移向量（沒啟用或沒在拖時為 0） */
  get vector(): StickVector {
    return this.enabled ? this.tracker.vector() : { x: 0, y: 0 };
  }

  /** 啟用或停用（只在對戰中啟用）；停用時放掉所有手指 */
  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    if (on) window.addEventListener('touchstart', this.blockMulti, { passive: false });
    else {
      window.removeEventListener('touchstart', this.blockMulti);
      this.tracker.reset();
    }
    this.draw();
  }

  /** 畫浮動原點（圓圈）與手指位置（圓點） */
  private draw(): void {
    const hd = this.enabled ? this.tracker.handle : null;
    this.root.hidden = hd === null;
    if (!hd) return;
    this.ring.style.transform = `translate(${hd.origin.x}px, ${hd.origin.y}px)`;
    this.dot.style.transform = `translate(${hd.finger.x}px, ${hd.finger.y}px)`;
  }
}
