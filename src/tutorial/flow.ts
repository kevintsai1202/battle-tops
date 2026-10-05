import enLines from '../audio/tutorial-lines.en.json';
import lines from '../audio/tutorial-lines.json';
import { lang, type Lang, type TextKey } from '../i18n';

/**
 * 操作教學的步驟流程（純邏輯，不碰 DOM 與 three.js，可單元測試）。
 * 四章十二步：組隊兩步 → 拉發射台 → 推移、衝刺、必殺 → 計分與終結方式。
 * 每一步在實際的遊戲畫面上指引：聚光圈框住要點的那一個元素，大手指（觸控）或滑鼠游標（電腦）
 * 在那個位置示範點按、往下拉、滑動等動作（畫面在 src/ui/tutorial.ts）。
 * 遊戲每幀把目前狀態（TutorialCtx）餵給 update，玩家真的做到了才進下一步；
 * 說明型的步驟（info）要按「下一步／完成」。發射沒有拉條時要求重來（回傳 'retry'）。
 */

/** 輸入方式：電腦（鍵盤、滑鼠）或手機（觸控）；解說語音、字幕與示範動畫依此切換 */
export type TutorialInput = 'kb' | 'tc';

/** 解說語音的台詞 id（src/audio/tutorial-lines.json） */
export type GuideId = keyof typeof lines.lines;

/** 章節 */
export type Chapter = 'team' | 'launch' | 'control' | 'score';

/**
 * 大畫面上的指引（src/ui/tutorial.ts 畫出來）：
 * - tap：手指或游標移到目標上點一下
 * - drag：拉發射台（先示範一次，倒數開始後提示在哪裡按住往下拉）
 * - swipe／flick：在自己的陀螺旁邊示範滑動推移／快甩衝刺（觸控）
 * - keysMove／keysDash／keySpace：在自己的陀螺旁邊顯示要按的大鍵帽（電腦）
 * - arrow：從自己的陀螺指向對手的箭頭（撞過去）
 * - none：只有面板說明
 */
export const GUIDE_KINDS = ['tap', 'drag', 'swipe', 'flick', 'keysMove', 'keysDash', 'keySpace', 'arrow', 'none'] as const;
export type GuideKind = (typeof GUIDE_KINDS)[number];

/** 選陀螺那一步依序指的推薦三顆（攻擊、防禦、持久各一顆，都在名鑑第一排）；玩家選別顆也算 */
export const RECOMMENDED = ['blaze', 'turtle', 'gale'] as const;

/** 遊戲每幀提供的狀態（數字是累計值，流程自己記每一步開始時的基準） */
export interface TutorialCtx {
  /** 遊戲狀態（select、arrange、launch、battle、roundEnd…） */
  state: string;
  /** 輸入方式（電腦或手機）：有些步驟兩邊要指的地方不同（例如必殺：電腦框量表、手機指必殺按鈕） */
  input: TutorialInput;
  /** 組隊第 1 步已選的陀螺代號 */
  picked: string[];
  /** 第 2 步調換過出場順序、換過零件 */
  orderChanged: boolean;
  partChanged: boolean;
  /** 零件清單開著（換零件那一步：清單打開後改指清單裡的零件） */
  partMenu: boolean;
  /** 最近一次發射有沒有拉條（按 Space 或只點一下為 false） */
  pulled: boolean;
  /** 對戰中推移的累計秒數 */
  pushTime: number;
  /** 玩家衝刺、放必殺的累計次數 */
  dashes: number;
  specials: number;
  /** 這一戰已經分出勝負（出現終結） */
  finished: boolean;
  /** 按了「下一步／完成」（遊戲只在按下的那一幀給 true） */
  next: boolean;
}

/** 一步的定義 */
export interface StepDef {
  id: string;
  chapter: Chapter;
  /** 面板上的小標題（字串表 src/text.ts 的鍵） */
  title: TextKey;
  /** 解說語音（電腦版、手機版）；字幕就是這句台詞的文字（見 caption） */
  voice: Record<TutorialInput, GuideId>;
  /** 大畫面上的指引 */
  guide: Record<TutorialInput, GuideKind>;
  /** 面板裡的說明圖（只有計分那一步：四種終結的小動畫） */
  illustration?: 'finishes';
  /** 要用聚光圈框住、手指指著的元素（CSS 選擇器）；依狀態決定時給函式（見 targetOf） */
  target?: string | ((ctx: TutorialCtx) => string | undefined);
  /** 說明型：要按按鈕才前進 */
  info?: boolean;
  /** 做到了沒：ctx 是目前狀態，base 是進入這一步時的狀態 */
  done(ctx: TutorialCtx, base: TutorialCtx): boolean;
}

/**
 * 字幕：這一步解說台詞去掉方括號語氣標記的文字。英文版用英文台詞，日文版與中文版用中文台詞（和解說語音一致）。
 */
export function caption(s: StepDef, input: TutorialInput, l: Lang = lang()): string {
  const table = l === 'en' ? enLines.lines : lines.lines;
  return table[s.voice[input]].text.replace(/\[[^\]]*\]/g, '').trim();
}

/** 建立一步：電腦版與手機版用同一句（或同一種指引）時直接給一個值 */
function step(
  id: string,
  chapter: Chapter,
  title: TextKey,
  voice: GuideId | Record<TutorialInput, GuideId>,
  guide: GuideKind | Record<TutorialInput, GuideKind>,
  done: StepDef['done'],
  extra: Partial<Pick<StepDef, 'target' | 'info' | 'illustration'>> = {},
): StepDef {
  const v = typeof voice === 'string' ? { kb: voice, tc: voice } : voice;
  const g = typeof guide === 'string' ? { kb: guide, tc: guide } : guide;
  return { id, chapter, title, voice: v, guide: g, done, ...extra };
}

/** 選陀螺：推薦的三顆裡還沒選的第一顆（都選了就沒有目標） */
function nextRecommended(ctx: TutorialCtx): string | undefined {
  const id = RECOMMENDED.find((t) => !ctx.picked.includes(t));
  return id ? `#select .card[data-id="${id}"]` : undefined;
}

/** 這一步現在要框住、指著的元素 */
export function targetOf(s: StepDef, ctx: TutorialCtx): string | undefined {
  return typeof s.target === 'function' ? s.target(ctx) : s.target;
}

/** 對戰中推移多久才算學會（秒） */
export const PUSH_GOAL = 1.2;
/**
 * 拉條長度至少多少才算「有拉條」（1 = 拉到畫面短邊的 45%）：
 * 只點一下也會量到一筆長度 0 的拉條，按 Space 則沒有拉條。
 */
export const PULL_MIN = 0.25;

/** 全部步驟（依序） */
export const STEPS: StepDef[] = [
  step('pick', 'team', 'tut.t.pick', 'tut_pick', 'tap', (c) => c.picked.length >= 3, { target: nextRecommended }),
  step('next', 'team', 'tut.t.next', 'tut_next', 'tap', (c) => c.state === 'arrange', { target: '#select .go' }),
  step('order', 'team', 'tut.t.order', 'tut_order', 'tap', (c) => c.orderChanged, { target: '#arrange .ar-slot:nth-child(2) .ar-up' }),
  step('parts', 'team', 'tut.t.parts', 'tut_parts', 'tap', (c) => c.partChanged, {
    // 先指選到那一顆的「軸」按鈕；清單打開後指第一件還沒裝上的零件
    target: (c) => (c.partMenu ? '#part-menu .pm-opt:not(.current):not(:disabled)' : '#arrange .ar-slot.on .part-btn[data-slot="driver"]'),
  }),
  step('ready', 'team', 'tut.t.ready', 'tut_ready', 'tap', (c) => c.state === 'launch', { target: '#arrange .ar-ready' }),
  step('launch', 'launch', 'tut.t.launch', { kb: 'tut_launch_kb', tc: 'tut_launch_tc' }, 'drag', (c) => c.state === 'battle' && c.pulled),
  step('push', 'control', 'tut.t.push', { kb: 'tut_push_kb', tc: 'tut_push_tc' }, { kb: 'keysMove', tc: 'swipe' }, (c, b) => c.pushTime - b.pushTime >= PUSH_GOAL),
  step('dash', 'control', 'tut.t.dash', { kb: 'tut_dash_kb', tc: 'tut_dash_tc' }, { kb: 'keysDash', tc: 'flick' }, (c, b) => c.dashes > b.dashes),
  step('special', 'control', 'tut.t.special', { kb: 'tut_special_kb', tc: 'tut_special_tc' }, { kb: 'keySpace', tc: 'tap' }, (c, b) => c.specials > b.specials, {
    // 電腦框住必殺量表；手機指著集滿時右下角出現的必殺按鈕
    target: (c) => (c.input === 'tc' ? '#special-btn' : '#hud .panel[data-side="0"] .special'),
  }),
  step('finish', 'score', 'tut.t.finish', 'tut_finish', 'arrow', (c) => c.finished),
  step('points', 'score', 'tut.t.points', 'tut_points', 'none', (c) => c.next, { info: true, target: '#hud .score', illustration: 'finishes' }),
  step('match', 'score', 'tut.t.match', 'tut_match', 'none', (c) => c.next, { info: true, target: '#hud .lineup' }),
];

/** 空白狀態（還沒開始） */
export function emptyCtx(): TutorialCtx {
  return { state: '', input: 'kb', picked: [], orderChanged: false, partChanged: false, partMenu: false, pulled: false, pushTime: 0, dashes: 0, specials: 0, finished: false, next: false };
}

/** update 的結果：前進到下一步、發射沒拉條要重來、全部完成 */
export type TutorialEvent = 'advanced' | 'retry' | 'done';

/** 教學流程：目前在第幾步，做到了就前進 */
export class TutorialFlow {
  /** 目前第幾步（0 起算；等於步驟數表示完成） */
  index: number;
  /** 進入目前這一步時的狀態（累計數字的基準）；第一次 update 時記下 */
  private base: TutorialCtx | null = null;
  /** 這次發射已經要求過重來（回到發射階段前不再要求） */
  private retrying = false;

  constructor(start = 0) {
    this.index = start;
  }

  /** 目前的步驟 */
  get step(): StepDef {
    return STEPS[Math.min(this.index, STEPS.length - 1)];
  }

  /** 全部完成 */
  get done(): boolean {
    return this.index >= STEPS.length;
  }

  /** 保護雙方不被終結（發射到必殺的步驟：讓玩家慢慢練，不會打到一半結束） */
  get guard(): boolean {
    return !this.done && ['launch', 'control'].includes(this.step.chapter);
  }

  /** 對手不攻擊（從發射開始到教學結束） */
  get cpuPassive(): boolean {
    return !this.done && this.index >= STEPS.findIndex((s) => s.id === 'launch');
  }

  /** 每幀呼叫：檢查目前這一步做到了沒；一次最多前進一步 */
  update(ctx: TutorialCtx): TutorialEvent | null {
    if (this.done) return null;
    if (!this.base) this.base = { ...ctx };
    const s = this.step;
    if (s.id === 'launch') {
      if (ctx.state === 'launch') this.retrying = false;
      else if (ctx.state === 'battle' && !ctx.pulled) {
        if (this.retrying) return null;
        this.retrying = true;
        return 'retry';
      }
    }
    if (!s.done(ctx, this.base)) return null;
    return this.advance(ctx);
  }

  /** 跳過目前這一步 */
  skip(): TutorialEvent | null {
    if (this.done) return null;
    return this.advance(null);
  }

  /** 前進一步：新步驟的基準從下一次 update（或這一幀的狀態）開始算 */
  private advance(ctx: TutorialCtx | null): TutorialEvent {
    this.index++;
    this.base = ctx ? { ...ctx, next: false } : null;
    this.retrying = false;
    return this.done ? 'done' : 'advanced';
  }
}

/** localStorage 記錄教學狀態的鍵與值：done 已完成、dismissed 不想看 */
export const TUTORIAL_KEY = 'battle-tops.tutorial';

/** 標題畫面要不要提示「第一次玩？建議先看教學」：沒完成也沒拒絕過才提示 */
export function shouldOfferTutorial(stored: string | null): boolean {
  return stored !== 'done' && stored !== 'dismissed';
}
