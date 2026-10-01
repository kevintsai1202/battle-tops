import type { Chapter, DemoKind, StepDef, TutorialInput } from '../tutorial/flow';
import { el } from './common';

/** 章節名稱 */
const CHAPTER: Record<Chapter, string> = {
  team: '第 1 章　組隊',
  launch: '第 2 章　發射',
  control: '第 3 章　操控',
  score: '第 4 章　計分',
};

/** 面板的位置：畫面下方、上方，或目標旁邊的右側、左側（直欄） */
type Placement = 'bottom' | 'top' | 'right' | 'left';

/** 畫面邊緣的留白（px） */
const MARGIN = 12;
/** 放在側邊時面板的寬度範圍（px）：太窄就不考慮側邊 */
const SIDE_MIN = 220;
const SIDE_MAX = 380;

/** 兩個矩形重疊的面積 */
function overlapArea(a: DOMRect, b: { left: number; top: number; right: number; bottom: number }): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/** 面板按鈕的回呼 */
export interface TutorialUiHandlers {
  /** 再聽一次解說 */
  onReplay: () => void;
  /** 跳過這一步 */
  onSkip: () => void;
  /** 說明型步驟的「下一步／完成」 */
  onNext: () => void;
  /** 結束教學（回到標題） */
  onExit: () => void;
}

/**
 * 操作教學的畫面：
 * - 面板：章節與第幾步、標題、字幕（就是解說語音的台詞）、示範動畫、按鈕（重聽、跳過這步、下一步／完成、結束教學）。
 * - 聚光圈：框住這一步要操作的元素並壓暗其他地方（不擋點擊）；每幀跟著元素的位置移動。
 * - 小提示（toast）：發射沒拉條、被終結重來時跳出一下。
 * 面板放在不會蓋住目標元素的位置：先試目標的另一半邊（目標在下半部就放上面），再試另一邊，
 * 都會蓋到時（例如手機橫向的名鑑幾乎佔滿畫面高度）改放在目標旁邊的右側或左側直欄；都蓋到就選蓋最少的。
 * 只有面板上的按鈕接收指標；面板其他地方點下去、拖過去都直接傳給遊戲（拉發射台、滑動推移）。
 */
export class TutorialOverlay {
  readonly root: HTMLElement;
  private readonly spot: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly chapter: HTMLElement;
  private readonly count: HTMLElement;
  private readonly title: HTMLElement;
  private readonly text: HTMLElement;
  private readonly demo: HTMLElement;
  private readonly next: HTMLButtonElement;
  private readonly toastEl: HTMLElement;
  /** 目前要框住的元素（CSS 選擇器） */
  private target: string | undefined;
  /** 小提示還要顯示幾秒（依畫面實際經過的時間倒數，見 update） */
  private toastLeft = 0;
  /** 上次決定面板位置時的目標位置與畫面大小（沒變就不重新量，避免每幀強制重新排版） */
  private placedKey = '';

  constructor(h: TutorialUiHandlers) {
    this.root = el('div', 'tutorial');
    this.root.id = 'tutorial';
    this.spot = el('div', 'tut-spot');
    this.spot.hidden = true;
    this.panel = el('div', 'tut-panel');
    const head = el('div', 'tut-head');
    this.chapter = el('span', 'tut-chapter');
    this.count = el('span', 'tut-count');
    head.append(this.chapter, this.count);
    this.title = el('div', 'tut-title');
    const body = el('div', 'tut-body');
    this.demo = el('div', 'tut-demo');
    this.text = el('p', 'tut-text');
    body.append(this.demo, this.text);
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
    this.next = button('tut-next', '下一步 ▶', h.onNext);
    actions.append(button('tut-replay', '🔊 重聽', h.onReplay), button('tut-skip', '跳過這步', h.onSkip), this.next, button('tut-exit', '結束教學', h.onExit));
    this.panel.append(head, this.title, body, actions);
    this.toastEl = el('div', 'tut-toast');
    this.toastEl.hidden = true;
    this.root.append(this.spot, this.panel, this.toastEl);
    document.getElementById('overlay')!.append(this.root);
  }

  /** 顯示一步：字幕、示範動畫、聚光圈目標；說明型步驟才有「下一步／完成」 */
  show(step: StepDef, input: TutorialInput, index: number, total: number): void {
    this.root.dataset.step = step.id;
    this.chapter.textContent = CHAPTER[step.chapter];
    this.count.textContent = `${index + 1}／${total}`;
    this.title.textContent = step.title;
    this.text.textContent = step.text[input];
    this.next.hidden = !step.info;
    this.next.textContent = index === total - 1 ? '完成 ✓' : '下一步 ▶';
    this.target = step.target;
    // 換了文字與示範動畫，面板高度會變：重新決定位置
    this.placedKey = '';
    this.setDemo(step.demo[input]);
    this.root.hidden = false;
    this.update();
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

  /** 每幀（dt 為這一幀的秒數，遊戲已限制單幀上限）：小提示倒數；聚光圈跟著目標元素；目標的位置或畫面大小變了就重新決定面板的位置 */
  update(dt = 0): void {
    if (this.toastLeft > 0) {
      this.toastLeft -= dt;
      if (this.toastLeft <= 0) this.toastEl.hidden = true;
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
  }

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
  }

  /** 換示範動畫：每種動畫是一組由 CSS 驅動的元素（見 style.css 的「操作教學」） */
  private setDemo(kind: DemoKind): void {
    this.demo.className = `tut-demo demo-${kind}`;
    this.demo.hidden = kind === 'none';
    this.demo.replaceChildren(...demoParts(kind));
  }
}

/** 示範動畫的元素：手指（圓點）、波紋、鍵帽、發射環、迷你陀螺等，動作由 CSS 動畫負責 */
function demoParts(kind: DemoKind): HTMLElement[] {
  const finger = () => el('i', 'finger');
  const key = (label: string, cls = '') => el('b', `key ${cls}`.trim(), label);
  switch (kind) {
    case 'tap':
      return [el('i', 'ripple'), finger()];
    case 'drag':
      // 發射環（外圈縮到內圈）＋手指按住往下拉、對上時放手
      return [el('i', 'ring-in'), el('i', 'ring-out'), el('i', 'cord'), finger(), el('span', 'go', '發射！')];
    case 'swipe':
      return [el('i', 'origin'), finger()];
    case 'flick':
      return [el('i', 'trail'), finger()];
    case 'keysMove': {
      const pad = el('div', 'keypad');
      pad.append(key('↑', 'k-up'), key('←', 'k-left'), key('↓', 'k-down'), key('→', 'k-right'));
      return [pad, el('small', 'alt', '或 W A S D')];
    }
    case 'keysDash': {
      const row = el('div', 'keyrow');
      row.append(key('↑', 'k-hold'), el('span', 'plus', '＋'), key('Shift', 'k-wide k-press'));
      return [row, el('i', 'dash-line')];
    }
    case 'keySpace':
      return [key('SPACE', 'k-space k-press'), el('i', 'burst')];
    case 'threeTap':
      return [el('i', 'ripple r1'), el('i', 'ripple r2'), el('i', 'ripple r3'), el('i', 'finger f1'), el('i', 'finger f2'), el('i', 'finger f3')];
    case 'finishes': {
      /** 三種終結的小動畫：停轉倒下、飛出場外、爆裂 */
      const card = (cls: string, name: string, pts: string) => {
        const c = el('div', `fin ${cls}`);
        const bowl = el('div', 'bowl');
        bowl.append(el('i', 'mini'), el('i', 'piece p1'), el('i', 'piece p2'), el('i', 'piece p3'));
        c.append(bowl, el('span', 'fin-name', name), el('b', 'fin-pts', pts));
        return c;
      };
      return [card('f-spin', '旋轉終結', '1 分'), card('f-over', '場外終結', '2 分'), card('f-burst', '爆裂終結', '2 分')];
    }
    default:
      return [];
  }
}
