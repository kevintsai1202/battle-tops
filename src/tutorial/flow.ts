import lines from '../audio/tutorial-lines.json';

/**
 * 操作教學的步驟流程（純邏輯，不碰 DOM 與 three.js，可單元測試）。
 * 四章十二步：組隊兩步 → 拉發射台 → 推移、衝刺、必殺 → 計分與終結方式。
 * 遊戲每幀把目前狀態（TutorialCtx）餵給 update，玩家真的做到了才進下一步；
 * 說明型的步驟（info）要按「下一步／完成」。發射沒有拉條時要求重來（回傳 'retry'）。
 */

/** 輸入方式：電腦（鍵盤、滑鼠）或手機（觸控）；解說語音、字幕與示範動畫依此切換 */
export type TutorialInput = 'kb' | 'tc';

/** 解說語音的台詞 id（src/audio/tutorial-lines.json） */
export type GuideId = keyof typeof lines.lines;

/** 章節 */
export type Chapter = 'team' | 'launch' | 'control' | 'score';

/** 示範動畫的種類（src/ui/tutorial.ts 畫出來） */
export type DemoKind = 'tap' | 'drag' | 'swipe' | 'flick' | 'keysMove' | 'keysDash' | 'keySpace' | 'threeTap' | 'finishes' | 'none';

/** 遊戲每幀提供的狀態（數字是累計值，流程自己記每一步開始時的基準） */
export interface TutorialCtx {
  /** 遊戲狀態（select、arrange、launch、battle、roundEnd…） */
  state: string;
  /** 組隊第 1 步已選幾顆 */
  picks: number;
  /** 第 2 步調換過出場順序、換過零件 */
  orderChanged: boolean;
  partChanged: boolean;
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
  /** 面板上的小標題 */
  title: string;
  /** 解說語音與字幕（電腦版、手機版） */
  voice: Record<TutorialInput, GuideId>;
  text: Record<TutorialInput, string>;
  /** 示範動畫 */
  demo: Record<TutorialInput, DemoKind>;
  /** 要用聚光圈標出的元素（CSS 選擇器） */
  target?: string;
  /** 說明型：要按按鈕才前進 */
  info?: boolean;
  /** 做到了沒：ctx 是目前狀態，base 是進入這一步時的狀態 */
  done(ctx: TutorialCtx, base: TutorialCtx): boolean;
}

/** 台詞去掉方括號的語氣標記，當字幕 */
const say = (id: GuideId) => lines.lines[id].text.replace(/\[[^\]]*\]/g, '').trim();

/** 建立一步：電腦版與手機版用同一句時 kb、tc 給同一個 id */
function step(
  id: string,
  chapter: Chapter,
  title: string,
  voice: GuideId | Record<TutorialInput, GuideId>,
  demo: DemoKind | Record<TutorialInput, DemoKind>,
  done: StepDef['done'],
  extra: Partial<Pick<StepDef, 'target' | 'info'>> = {},
): StepDef {
  const v = typeof voice === 'string' ? { kb: voice, tc: voice } : voice;
  const d = typeof demo === 'string' ? { kb: demo, tc: demo } : demo;
  return { id, chapter, title, voice: v, text: { kb: say(v.kb), tc: say(v.tc) }, demo: d, done, ...extra };
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
  step('pick', 'team', '組隊：選三顆陀螺', 'tut_pick', 'tap', (c) => c.picks >= 3, { target: '#select .cards' }),
  step('next', 'team', '組隊：下一步', 'tut_next', 'tap', (c) => c.state === 'arrange', { target: '#select .go' }),
  step('order', 'team', '調整出場順序', 'tut_order', 'tap', (c) => c.orderChanged, { target: '#arrange .ar-slots' }),
  step('parts', 'team', '換盤與軸', 'tut_parts', 'tap', (c) => c.partChanged, { target: '#arrange .ar-detail .d-parts' }),
  step('ready', 'team', '出陣', 'tut_ready', 'tap', (c) => c.state === 'launch', { target: '#arrange .ar-ready' }),
  step('launch', 'launch', '拉發射台', { kb: 'tut_launch_kb', tc: 'tut_launch_tc' }, 'drag', (c) => c.state === 'battle' && c.pulled),
  step('push', 'control', '推移陀螺', { kb: 'tut_push_kb', tc: 'tut_push_tc' }, { kb: 'keysMove', tc: 'swipe' }, (c, b) => c.pushTime - b.pushTime >= PUSH_GOAL),
  step('dash', 'control', '衝刺', { kb: 'tut_dash_kb', tc: 'tut_dash_tc' }, { kb: 'keysDash', tc: 'flick' }, (c, b) => c.dashes > b.dashes),
  step('special', 'control', '必殺技', { kb: 'tut_special_kb', tc: 'tut_special_tc' }, { kb: 'keySpace', tc: 'threeTap' }, (c, b) => c.specials > b.specials, {
    target: '#hud .panel[data-side="0"] .special',
  }),
  step('finish', 'score', '終結對手', 'tut_finish', 'finishes', (c) => c.finished),
  step('points', 'score', '終結方式與得分', 'tut_points', 'finishes', (c) => c.next, { info: true, target: '#hud .score' }),
  step('match', 'score', '三對三賽制', 'tut_match', 'none', (c) => c.next, { info: true, target: '#hud .lineup' }),
];

/** 空白狀態（還沒開始） */
export function emptyCtx(): TutorialCtx {
  return { state: '', picks: 0, orderChanged: false, partChanged: false, pulled: false, pushTime: 0, dashes: 0, specials: 0, finished: false, next: false };
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
