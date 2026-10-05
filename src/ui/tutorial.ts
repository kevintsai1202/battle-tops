import { tr, type TextKey } from '../i18n';
import { caption, type Chapter, type GuideKind, type StepDef, type TutorialInput } from '../tutorial/flow';
import { el } from './common';

/** 章節名稱（字串表的鍵） */
const CHAPTER: Record<Chapter, TextKey> = {
  team: 'tut.ch.team',
  launch: 'tut.ch.launch',
  control: 'tut.ch.control',
  score: 'tut.ch.score',
};

/** 面板的位置：畫面下方、上方，或目標旁邊的右側、左側（直欄） */
type Placement = 'bottom' | 'top' | 'right' | 'left';

/** 畫面邊緣的留白（px） */
const MARGIN = 12;
/** 放在側邊時面板的寬度範圍（px）：太窄就不考慮側邊 */
const SIDE_MIN = 220;
const SIDE_MAX = 380;
/** 手指與游標圖示的大小（px） */
const HAND = 64;

/**
 * 手指（觸控）與滑鼠游標（電腦）的圖示（SVG，白底深色描邊；寫死的常數，用 innerHTML 放進去沒有注入風險）。tip 是指尖（游標尖端）在圖示裡的位置（px），
 * 放置時讓指尖剛好落在要點的地方。
 */
const ICONS: Record<'finger' | 'cursor', { svg: string; tip: [number, number] }> = {
  finger: {
    svg: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M24 4c3.3 0 6 2.7 6 6v17l2.5-1c3.2-1.1 6.5.9 7 4.2l.1.6 1.6-.6c3.3-1.1 6.7 1 7.1 4.4l.1.7c3.4-1 6.8 1.3 7 4.8V52c0 6.6-5.4 12-12 12H34c-4.6 0-8.8-2.6-10.8-6.8L13.6 40c-1.4-2.9-.2-6.4 2.7-7.8 2.6-1.3 5.8-.4 7.3 2.1l.4.7V10c0-3.3 0-6 0-6z" fill="#fff" stroke="#0b1a38" stroke-width="3" stroke-linejoin="round"/></svg>',
    tip: [27, 5],
  },
  cursor: {
    svg: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 4v46l12-11 8 19 9-4-8-18h16z" fill="#fff" stroke="#0b1a38" stroke-width="3" stroke-linejoin="round"/></svg>',
    tip: [10, 4],
  },
};

/** 兩個矩形重疊的面積 */
function overlapArea(a: DOMRect, b: { left: number; top: number; right: number; bottom: number }): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/** 0..1 的緩出曲線 */
const easeOut = (k: number) => 1 - (1 - k) * (1 - k);
/** 夾在 0..1 */
const clamp01 = (k: number) => Math.max(0, Math.min(1, k));

/** 螢幕上的一點（px） */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** 遊戲每幀提供給教學畫面的資料 */
export interface GuideFrame {
  /** 這一步要框住、手指指著的元素（CSS 選擇器）；沒有就不框 */
  target?: string;
  /** 自己與對手的陀螺在螢幕上的位置（對戰中才有） */
  player?: ScreenPoint | null;
  opponent?: ScreenPoint | null;
  /** 發射示範：手指（游標）目前的位置、是否按著、是否顯示「發射！」（遊戲依示範時間軸計算；不在示範時為 null） */
  launchDemo?: (ScreenPoint & { pressed: boolean; go: boolean }) | null;
  /** 倒數中提示在哪裡按住往下拉（不在倒數時為 null） */
  pressAt?: ScreenPoint | null;
  /** 玩家正在操作（拉條中、滑動推移中）：先收起手指，不擋在玩家的手指或滑鼠底下 */
  busy?: boolean;
}

/** 面板按鈕的回呼 */
export interface TutorialUiHandlers {
  /** 再聽一次解說（發射那一步也會重播示範） */
  onReplay: () => void;
  /** 跳過這一步 */
  onSkip: () => void;
  /** 說明型步驟的「下一步／完成」 */
  onNext: () => void;
  /** 結束教學（回到標題） */
  onExit: () => void;
}

/**
 * 操作教學的畫面，指引直接畫在實際的遊戲畫面上：
 * - 聚光圈：只框住這一步要點的那一個元素（一顆陀螺、一個 ▲、零件選單、按鈕、必殺量表），壓暗其他地方；每幀跟著元素移動。
 * - 大畫面指引：大手指（觸控）或滑鼠游標（電腦）移到要點的地方示範點一下；發射時配合發射台示範按住往下拉；
 *   推移、衝刺時在自己的陀螺旁邊示範滑動與快甩（觸控）或顯示要按的大鍵帽（電腦）；必殺時手指點必殺按鈕（觸控）或顯示空白鍵（電腦）；
 *   終結時從自己的陀螺畫箭頭指向對手。動作依每幀的時間推進（不會因主執行緒卡住而跳掉或彼此錯開）。
 * - 面板：章節與第幾步、標題、字幕（就是解說語音的台詞）、按鈕（重聽、跳過這步、下一步／完成、結束教學）；
 *   只有計分那一步放四種終結的說明圖。面板放在不會蓋住目標的位置（上方、下方、右側或左側）。
 * - 小提示（toast）：發射沒拉條、被終結重來時跳出一下。
 * 指引全部不接收指標（點下去直接到底下的遊戲畫面）；只有面板上的按鈕可以點。
 */
export class TutorialOverlay {
  readonly root: HTMLElement;
  private readonly spot: HTMLElement;
  private readonly guide: HTMLElement;
  private readonly hand: HTMLElement;
  private readonly pressHint: HTMLElement;
  private readonly keys: HTMLElement;
  private readonly arrow: SVGSVGElement;
  private readonly arrowLine: SVGLineElement;
  private readonly arrowLabel: SVGTextElement;
  private readonly goText: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly chapter: HTMLElement;
  private readonly count: HTMLElement;
  private readonly title: HTMLElement;
  private readonly text: HTMLElement;
  private readonly illus: HTMLElement;
  private readonly next: HTMLButtonElement;
  private readonly toastEl: HTMLElement;
  /** 目前這一步的指引種類與輸入方式 */
  private kind: GuideKind = 'none';
  /** 目前框住的元素（CSS 選擇器）；換了就捲到看得見的地方 */
  private target: string | undefined;
  /** 指引動畫的時間（秒，每幀累加；換步驟或換目標時歸零） */
  private phase = 0;
  /** 上一幀手指是否按著（剛按下時放一圈波紋） */
  private wasPressed = false;
  /** 小提示還要顯示幾秒（依畫面實際經過的時間倒數，見 update） */
  private toastLeft = 0;
  /** 上次決定面板位置時的目標位置與畫面大小（沒變就不重新量，避免每幀強制重新排版） */
  private placedKey = '';
  /** 系統設定「減少動態效果」：手指停在要點的地方，不做移動與波紋 */
  private readonly reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(h: TutorialUiHandlers) {
    this.root = el('div', 'tutorial');
    this.root.id = 'tutorial';
    this.spot = el('div', 'tut-spot');
    this.spot.hidden = true;

    // 大畫面指引：容器放在要點的位置（data-x、data-y），手指在容器裡移動
    this.guide = el('div', 'tut-guide');
    this.hand = el('div', 'tut-hand');
    this.pressHint = el('div', 'tut-press-hint', tr('tut.press'));
    this.guide.append(this.hand, this.pressHint);
    this.keys = el('div', 'tut-keys');
    this.arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.arrow.classList.add('tut-arrow');
    this.arrow.innerHTML =
      '<defs><marker id="tut-arrowhead" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#ffd23a"/></marker></defs><line marker-end="url(#tut-arrowhead)"/><text text-anchor="middle"></text>';
    this.arrowLine = this.arrow.querySelector('line')!;
    this.arrowLabel = this.arrow.querySelector('text')!;
    this.arrowLabel.textContent = tr('tut.ram');
    this.goText = el('div', 'tut-go', 'GO SHOOT!');

    this.panel = el('div', 'tut-panel');
    const head = el('div', 'tut-head');
    this.chapter = el('span', 'tut-chapter');
    this.count = el('span', 'tut-count');
    head.append(this.chapter, this.count);
    this.title = el('div', 'tut-title');
    const body = el('div', 'tut-body');
    this.illus = el('div', 'tut-demo demo-finishes');
    this.text = el('p', 'tut-text');
    body.append(this.illus, this.text);
    const actions = el('div', 'tut-actions');
    /**
     * 面板按鈕：按下與點擊的事件不往外傳（拉發射台、滑動推移、標題的「點任意處開始」都掛在 window 或外層）。
     * 面板其他地方不接收指標（CSS 的 pointer-events: none），拉發射台時從面板上拖過去也不受影響。
     */
    const button = (cls: string, label: string, fn: () => void) => {
      const b = el('button', cls, label);
      b.type = 'button';
      for (const ev of ['pointerdown', 'touchstart'] as const) b.addEventListener(ev, (e) => e.stopPropagation());
      b.onclick = (e) => {
        e.stopPropagation();
        b.blur();
        fn();
      };
      return b;
    };
    this.next = button('tut-next', tr('tut.next'), h.onNext);
    actions.append(button('tut-replay', tr('tut.replay'), h.onReplay), button('tut-skip', tr('tut.skip'), h.onSkip), this.next, button('tut-exit', tr('tut.exit'), h.onExit));
    this.panel.append(head, this.title, body, actions);
    this.toastEl = el('div', 'tut-toast');
    this.toastEl.hidden = true;
    // 疊放順序：聚光圈（壓暗）→ 指引（手指、鍵帽、箭頭）→ 面板 → 小提示
    this.root.append(this.spot, this.arrow, this.keys, this.goText, this.guide, this.panel, this.toastEl);
    document.getElementById('overlay')!.append(this.root);
    // 教學中：遊戲本身的發射台說明字收起（教學面板已經說明，兩段字疊在一起很亂）
    document.body.classList.add('tutoring');
  }

  /** 顯示一步：字幕、大畫面指引的種類、說明圖；說明型步驟才有「下一步／完成」 */
  show(step: StepDef, input: TutorialInput, index: number, total: number): void {
    this.root.dataset.step = step.id;
    this.chapter.textContent = tr(CHAPTER[step.chapter]);
    this.count.textContent = tr('tut.count', { i: index + 1, n: total });
    this.title.textContent = tr(step.title);
    this.text.textContent = caption(step, input);
    this.next.hidden = !step.info;
    this.next.textContent = tr(index === total - 1 ? 'tut.done' : 'tut.next');
    this.kind = step.guide[input];
    this.guide.dataset.kind = this.kind;
    this.setIcon(input === 'tc' ? 'finger' : 'cursor');
    this.setKeys(this.kind);
    this.illus.hidden = step.illustration !== 'finishes';
    this.illus.replaceChildren(...(step.illustration === 'finishes' ? finishCards() : []));
    this.phase = 0;
    // 換了文字，面板高度會變：重新決定位置
    this.placedKey = '';
    this.root.hidden = false;
    this.update(0, {});
  }

  /**
   * 跳出一則小提示，畫面實際播放 seconds 秒後收起。
   * 用每幀的時間倒數而不是 setTimeout：開打時建立場景會卡住主執行緒好幾秒（慢的手機、軟體渲染），
   * 用 setTimeout 的話卡住的時間也算進去，提示一出現就收起，玩家看不到。
   */
  toast(text: string, seconds = 2.4): void {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    this.toastLeft = seconds;
  }

  /**
   * 每幀（dt 為這一幀的秒數，遊戲已限制單幀上限）：小提示倒數、聚光圈與面板跟著目標、推進大畫面指引的動作。
   */
  update(dt: number, frame: GuideFrame): void {
    if (this.toastLeft > 0) {
      this.toastLeft -= dt;
      if (this.toastLeft <= 0) this.toastEl.hidden = true;
    }
    this.phase += dt;
    if (frame.target !== this.target) {
      this.target = frame.target;
      this.phase = 0;
      // 目標在可以捲動的區塊裡（手機的零件選單、名鑑）：捲到看得見的地方
      const t = this.target ? document.querySelector<HTMLElement>(this.target) : null;
      t?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    const t = this.target ? document.querySelector<HTMLElement>(this.target) : null;
    const r = t && t.offsetParent !== null ? t.getBoundingClientRect() : null;
    const visible = !!r && r.width > 0 && r.height > 0;
    this.spot.hidden = !visible;
    if (visible) {
      const pad = 6;
      Object.assign(this.spot.style, {
        left: `${r.left - pad}px`,
        top: `${r.top - pad}px`,
        width: `${r.width + pad * 2}px`,
        height: `${r.height + pad * 2}px`,
      });
    }
    const key = visible
      ? `${this.target}|${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}|${window.innerWidth}x${window.innerHeight}`
      : `none|${window.innerWidth}x${window.innerHeight}`;
    if (key !== this.placedKey) {
      this.placedKey = key;
      this.place(visible ? r : null);
    }
    this.animate(frame, visible ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null);
  }

  /** 收起教學畫面 */
  hide(): void {
    this.root.hidden = true;
    this.spot.hidden = true;
    this.toastEl.hidden = true;
    this.toastLeft = 0;
  }

  /** 移除教學畫面（教學結束） */
  dispose(): void {
    this.hide();
    this.root.remove();
    document.body.classList.remove('tutoring');
  }

  // ---------------- 大畫面指引 ----------------

  /**
   * 依指引種類算出手指的位置與動作（這一幀）：
   * anchor 是要點的地方（目標元素中心）；對戰中用自己陀螺的位置；發射用遊戲給的示範位置或按住位置。
   */
  private animate(f: GuideFrame, targetCenter: ScreenPoint | null): void {
    let at: ScreenPoint | null = null;
    /** 手指相對 at 的位移、縮放（按下時縮小）、透明度、是否按著 */
    let dx = 0;
    let dy = 0;
    let opacity = 1;
    let pressed = false;
    let hint = false;
    let keysAt: ScreenPoint | null = null;
    let arrow: [ScreenPoint, ScreenPoint] | null = null;
    let go = false;
    const p = this.phase;
    switch (this.kind) {
      case 'tap': {
        at = targetCenter;
        // 1.6 秒一輪：從右下方移過來（0～0.45）→ 按下（0.45～0.75）→ 停一下 → 淡出
        const k = p % 1.6;
        const m = 1 - easeOut(clamp01(k / 0.45));
        dx = 36 * m;
        dy = 46 * m;
        pressed = k >= 0.45 && k < 0.75;
        opacity = k < 1.15 ? clamp01(k / 0.2) : 1 - clamp01((k - 1.15) / 0.4);
        break;
      }
      case 'drag':
        if (f.launchDemo) {
          at = f.launchDemo;
          pressed = f.launchDemo.pressed;
          go = f.launchDemo.go;
        } else if (f.pressAt && !f.busy) {
          // 倒數中：手指停在按住的位置，下面提示「按住往下拉」
          at = f.pressAt;
          dy = 6 * Math.sin(p * 5);
          hint = true;
        }
        break;
      case 'swipe': {
        // 2.4 秒一輪：按下 → 往右上拖 → 按住 → 放開淡出
        at = f.busy ? null : (f.player ?? null);
        const k = p % 2.4;
        const m = easeOut(clamp01((k - 0.3) / 1.0));
        dx = 70 * m;
        dy = -60 * m;
        pressed = k >= 0.3 && k < 1.8;
        opacity = k < 1.8 ? clamp01(k / 0.2) : 1 - clamp01((k - 1.8) / 0.4);
        break;
      }
      case 'flick': {
        // 1.8 秒一輪：按下 → 0.15 秒快速往右甩 → 放開淡出
        at = f.player ?? null;
        const k = p % 1.8;
        dx = 130 * easeOut(clamp01((k - 0.3) / 0.15));
        pressed = k >= 0.3 && k < 0.45;
        opacity = k < 0.45 ? clamp01(k / 0.15) : 1 - clamp01((k - 0.45) / 0.3);
        break;
      }
      case 'keysMove':
      case 'keysDash':
      case 'keySpace':
        // 鍵帽放在自己的陀螺下方（夾在畫面內）；沒有陀螺時放在畫面中央偏下
        keysAt = f.player ?? { x: window.innerWidth / 2, y: window.innerHeight * 0.55 };
        this.lightKeys(p);
        break;
      case 'arrow':
        if (f.player && f.opponent) arrow = [f.player, f.opponent];
        break;
      default:
        break;
    }
    if (this.reduced) {
      // 減少動態效果：手指停在要點的地方
      dx = 0;
      dy = 0;
      opacity = 1;
      pressed = false;
    }

    // 手指（游標）
    const show = at !== null;
    this.guide.hidden = !show;
    if (at) {
      this.guide.style.left = `${at.x}px`;
      this.guide.style.top = `${at.y}px`;
      this.guide.dataset.x = String(Math.round(at.x));
      this.guide.dataset.y = String(Math.round(at.y));
      const s = pressed ? 0.86 : 1;
      this.hand.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
      this.hand.style.opacity = String(opacity);
      this.hand.classList.toggle('pressed', pressed);
      this.pressHint.hidden = !hint;
      if (pressed && !this.wasPressed && !this.reduced) this.ripple(dx, dy);
    }
    this.wasPressed = pressed;

    // 鍵帽：先試陀螺下方，會被面板蓋到或超出畫面就放上方
    this.keys.hidden = keysAt === null;
    if (keysAt) {
      const kw = this.keys.offsetWidth;
      const kh = this.keys.offsetHeight;
      const x = Math.max(MARGIN + kw / 2, Math.min(window.innerWidth - MARGIN - kw / 2, keysAt.x));
      const pr = this.panel.getBoundingClientRect();
      const fits = (top: number) =>
        top >= MARGIN &&
        top + kh <= window.innerHeight - MARGIN &&
        (top + kh <= pr.top - 8 || top >= pr.bottom + 8 || x + kw / 2 <= pr.left || x - kw / 2 >= pr.right);
      const below = keysAt.y + 56;
      const above = keysAt.y - 56 - kh;
      const y = fits(below) ? below : fits(above) ? above : Math.max(MARGIN, Math.min(pr.top - 8 - kh, below));
      this.keys.style.left = `${x}px`;
      this.keys.style.top = `${y}px`;
      this.guide.dataset.x = String(Math.round(x));
      this.guide.dataset.y = String(Math.round(y));
    }

    // 箭頭：從自己的陀螺指向對手（兩端各縮一點，不蓋住陀螺）
    this.arrow.style.display = arrow ? '' : 'none';
    if (arrow) {
      const [a, b] = arrow;
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const ux = (b.x - a.x) / len;
      const uy = (b.y - a.y) / len;
      const cut = Math.min(40, len * 0.25);
      this.arrowLine.setAttribute('x1', String(a.x + ux * cut));
      this.arrowLine.setAttribute('y1', String(a.y + uy * cut));
      this.arrowLine.setAttribute('x2', String(b.x - ux * cut));
      this.arrowLine.setAttribute('y2', String(b.y - uy * cut));
      this.arrowLabel.setAttribute('x', String((a.x + b.x) / 2));
      this.arrowLabel.setAttribute('y', String((a.y + b.y) / 2 - 18));
    }

    // 發射示範：放手的瞬間在發射台中央跳出「GO SHOOT!」
    this.goText.hidden = !go;
  }

  /** 剛按下時，在指尖的位置放一圈波紋（自己播完就移除） */
  private ripple(dx: number, dy: number): void {
    const r = el('i', 'tut-ripple');
    r.style.left = `${dx}px`;
    r.style.top = `${dy}px`;
    this.guide.append(r);
    window.setTimeout(() => r.remove(), 800);
  }

  /** 換手指或游標圖示（指尖對準容器的原點） */
  private setIcon(kind: 'finger' | 'cursor'): void {
    const icon = ICONS[kind];
    const h = this.hand;
    h.innerHTML = icon.svg;
    h.style.left = `${-icon.tip[0] * (HAND / 64)}px`;
    h.style.top = `${-icon.tip[1] * (HAND / 64)}px`;
    h.style.transformOrigin = `${icon.tip[0] * (HAND / 64)}px ${icon.tip[1] * (HAND / 64)}px`;
    h.dataset.icon = kind;
  }

  /** 換鍵帽：推移是四個方向鍵、衝刺是方向鍵＋Shift、必殺是空白鍵 */
  private setKeys(kind: GuideKind): void {
    const key = (label: string, cls = '') => el('b', `tut-key ${cls}`.trim(), label);
    const parts: HTMLElement[] = [];
    if (kind === 'keysMove') {
      const pad = el('div', 'tut-keypad');
      pad.append(key('↑', 'k-up'), key('←', 'k-left'), key('↓', 'k-down'), key('→', 'k-right'));
      parts.push(pad, el('small', 'tut-keys-alt', tr('tut.orWasd')));
    } else if (kind === 'keysDash') {
      const row = el('div', 'tut-keyrow');
      row.append(key('↑', 'k-hold on'), el('span', 'tut-plus', tr('tut.plus')), key('Shift', 'k-wide k-shift'));
      parts.push(row, el('small', 'tut-keys-alt', tr('tut.dashKeys')));
    } else if (kind === 'keySpace') {
      parts.push(key('SPACE', 'k-space'), el('small', 'tut-keys-alt', tr('tut.space')));
    }
    this.keys.replaceChildren(...parts);
    this.keys.dataset.kind = kind;
  }

  /** 鍵帽依時間亮起：方向鍵依序（上、右、下、左），Shift 與空白鍵一閃一閃 */
  private lightKeys(p: number): void {
    const on = (sel: string, v: boolean) => this.keys.querySelector(sel)?.classList.toggle('on', v);
    const k = p % 2;
    on('.k-up', k < 0.5);
    on('.k-right', k >= 0.5 && k < 1);
    on('.k-down', k >= 1 && k < 1.5);
    on('.k-left', k >= 1.5);
    const b = p % 1.4;
    on('.k-shift', b >= 0.6 && b < 0.95);
    on('.k-space', b >= 0.6 && b < 0.95);
  }

  // ---------------- 面板位置 ----------------

  /**
   * 決定面板的位置：依序試各個位置，量實際大小，選第一個不蓋到目標（含聚光圈的留白）的；
   * 都會蓋到就選蓋到最少的。沒有目標時放在畫面下方。
   */
  private place(r: DOMRect | null): void {
    if (!r) {
      this.setPlacement('bottom', 0);
      return;
    }
    const zone = { left: r.left - 8, top: r.top - 8, right: r.right + 8, bottom: r.bottom + 8 };
    const lowerHalf = r.top + r.height / 2 > window.innerHeight / 2;
    const order: Placement[] = lowerHalf ? ['top', 'bottom', 'right', 'left'] : ['bottom', 'top', 'right', 'left'];
    let best: { at: Placement; width: number; area: number } = { at: order[0], width: 0, area: Infinity };
    for (const at of order) {
      const free = at === 'right' ? window.innerWidth - zone.right - MARGIN * 2 : at === 'left' ? zone.left - MARGIN * 2 : 0;
      const width = Math.min(SIDE_MAX, free);
      if ((at === 'right' || at === 'left') && width < SIDE_MIN) continue;
      this.setPlacement(at, width);
      const area = overlapArea(this.panel.getBoundingClientRect(), zone);
      if (area < best.area) best = { at, width, area };
      if (area === 0) break;
    }
    this.setPlacement(best.at, best.width);
    this.panel.dataset.at = best.at;
  }

  /** 套用面板位置（CSS class），側邊時另外設寬度 */
  private setPlacement(at: Placement, width: number): void {
    const p = this.panel;
    p.classList.toggle('top', at === 'top');
    p.classList.toggle('side', at === 'right' || at === 'left');
    p.classList.toggle('left', at === 'left');
    p.style.width = at === 'right' || at === 'left' ? `${width}px` : '';
  }
}

/** 計分那一步的說明圖：四種終結的小動畫（停轉倒下、飛出場外、爆裂、撞進實體戰鬥盤中間的寬口）與得分 */
function finishCards(): HTMLElement[] {
  const card = (cls: string, name: TextKey, pts: number) => {
    const c = el('div', `fin ${cls}`);
    const bowl = el('div', 'bowl');
    bowl.append(el('i', 'mini'), el('i', 'piece p1'), el('i', 'piece p2'), el('i', 'piece p3'));
    c.append(bowl, el('span', 'fin-name', tr(name)), el('b', 'fin-pts', tr(pts === 1 ? 'tut.pt' : 'tut.pts', { n: pts })));
    return c;
  };
  return [card('f-spin', 'tut.fin.spin', 1), card('f-over', 'tut.fin.over', 2), card('f-burst', 'tut.fin.burst', 2), card('f-xtreme', 'tut.fin.xtreme', 3)];
}
