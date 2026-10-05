import * as THREE from 'three';
import { AudioEngine, type Hum } from '../audio/engine';
import { specialVoice, VoicePlayer, type VoiceId } from '../audio/voice';
import { CLASH_WORDS, diffLabel, lang, onLangChange, plainName, serverError, serverReason, topName, tr, type TextKey } from '../i18n';
import { CameraDirector } from '../director/director';
import { CameraRig, type Shot } from '../render/cameraRig';
import { Effects } from '../render/effects';
import { GameRenderer } from '../render/postfx';
import { Showcase } from '../render/showcase';
import { buildLights, buildStadium, type Stadium, type StadiumLights } from '../render/stadium';
import { TopView } from '../render/topView';
import { ARENA_IDS, ARENAS, floorHeight, liftPhase, type ArenaId, type ArenaSpec } from '../sim/arena';
import { BattleSim } from '../sim/battle';
import { cpuThink } from '../sim/cpu';
import { createTop, spinRatio } from '../sim/physics';
import { createRng, type Rng } from '../sim/rng';
import { DIFFICULTIES, type Difficulty, type DifficultyId } from '../sim/difficulty';
import { keyLaunchRatio, measurePull, pullLaunchRatio, pullQuality, trimPullSamples, type PullMetrics, type PullSample } from '../sim/launcher';
import { FINISH_POINTS, launchSpinRatio } from '../sim/rules';
import { STOCK, type TeamLoadouts } from '../sim/parts';
import { cpuPickTeam, createMatch, currentPairing, recordResult, setOvertime, type Pairing, type TeamMatch } from '../sim/team';
import {
  addTrialResult,
  AutoDuel,
  emptyTrialRecord,
  parseTrialStore,
  pruneTrialStore,
  TRIAL_STORE_KEY,
  trialKey,
  type DuelSummary,
  type TrialConfig,
  type TrialEntry,
  type TrialStore,
} from '../sim/trial';
import type { AutoDuelMessage, AutoDuelRequest } from '../sim/autoDuelJob';
import { buildSpec, TOP_IDS, TOP_SPECS } from '../sim/tops';
import type { FinishType, SimEvent, TopId, TopSpec, TopState, V2 } from '../sim/types';
import { css, Hud, type ArenaChoice, type CordView, type TrialBattleStats } from '../ui/hud';
import { rpmOf } from '../ui/common';
import { SwipeControls, type StickVector } from '../ui/touch';
import { partMenu } from '../ui/partMenu';
import { TutorialOverlay, type GuideFrame, type ScreenPoint } from '../ui/tutorial';
import { PULL_MIN, shouldOfferTutorial, STEPS, targetOf, TUTORIAL_KEY, TutorialFlow, type TutorialCtx, type TutorialEvent, type TutorialInput } from '../tutorial/flow';
import type { NetStatus } from '../net/client';
import { perspectiveMatch } from '../net/perspective';
import type { ServerMessage } from '../net/protocol';
import { loadName, OnlineSession, saveName, type Msg } from './online';

/** 遊戲階段（online：線上房間畫面；waiting：線上等待對手組隊或挑延長賽） */
export type GameState = 'title' | 'select' | 'arrange' | 'overtime' | 'launch' | 'battle' | 'roundEnd' | 'result' | 'online' | 'waiting' | 'trial' | 'trialResult';

/** 模擬固定步長 */
const STEP = 1 / 120;
/** 倒數節拍（秒）：3、2、1 各一拍，第四拍是「ゴー・シュート！」 */
const BEAT = 0.9;
const COUNT_START = 0.7;
const GO_AT = COUNT_START + BEAT * 3;

/** 啟動參數（網址查詢字串） */
export interface GameOptions {
  /** 展示模式：CPU 對 CPU 自動對打、不需點擊（e2e 與展示用） */
  demo: boolean;
  seed: number;
  /** 展示模式指定雙方隊伍的前幾顆（其餘隨機補滿 3 顆） */
  player?: TopId[];
  cpu?: TopId[];
  /** 展示模式的場地（省略為練習場） */
  arena?: ArenaId;
}

/** 終結時的大字（字串表的鍵，依語言顯示）與主播台詞 */
const FINISH_TEXT: Record<FinishType, { banner: TextKey; voice: VoiceId }> = {
  spin: { banner: 'banner.spin', voice: 'spin_finish' },
  over: { banner: 'banner.over', voice: 'over_finish' },
  burst: { banner: 'banner.burst', voice: 'burst_finish' },
  xtreme: { banner: 'banner.xtreme', voice: 'xtreme_finish' },
};

/** 發射評價的文字（依語言）：力道比例越高評價越好 */
function rateLabel(ratio: number): string {
  return tr(ratio >= 0.97 ? 'rate.perfect' : ratio >= 0.85 ? 'rate.great' : ratio >= 0.7 ? 'rate.good' : 'rate.weak');
}

const CLASH_LINES: VoiceId[] = ['clash_1', 'clash_2', 'clash_3', 'clash_4'];

/** 瀏覽器記住難度與場地用的 localStorage 鍵 */
const DIFFICULTY_KEY = 'battle-tops.difficulty';
const ARENA_KEY = 'battle-tops.arena';

/** 各座位的發射位置與基準初速方向（BattleSim 的開場配置，瞄準箭頭用；0 號在左、1 號在右） */
const SEAT_START: V2[] = [
  { x: -2.1, z: 0 },
  { x: 2.1, z: 0 },
];
const SEAT_LAUNCH_DIR: V2[] = [
  { x: 2.0, z: 0.7 },
  { x: -2.0, z: -0.7 },
];

/** 讀取上次選的場地（讀不到時用練習場） */
function loadArena(): ArenaChoice {
  try {
    const id = localStorage.getItem(ARENA_KEY);
    if (id === 'random' || (id && id in ARENAS)) return id as ArenaChoice;
  } catch {
    // 儲存空間被封鎖：用預設值
  }
  return 'practice';
}

/** 讀取上次選的難度（無痕模式等讀不到時用普通） */
function loadDifficulty(): Difficulty {
  try {
    const id = localStorage.getItem(DIFFICULTY_KEY) as DifficultyId | null;
    if (id && id in DIFFICULTIES) return DIFFICULTIES[id];
  } catch {
    // 儲存空間被封鎖：用預設值
  }
  return DIFFICULTIES.normal;
}

/** 試驗模式「電腦自動對打」的場數（1000 場時勝率的誤差約 ±3 個百分點，比得出零件的差異） */
const AUTO_DUEL_GAMES = 1000;

/** 讀出存在瀏覽器裡的試驗紀錄（壞掉、過期或被封鎖時當成沒有） */
function loadTrialStore(): TrialStore {
  try {
    return parseTrialStore(localStorage.getItem(TRIAL_STORE_KEY));
  } catch {
    return parseTrialStore(null);
  }
}

/** 讀瀏覽器記住的教學狀態（done 已完成、dismissed 不想看；封鎖儲存空間時當作沒有） */
function readTutorialFlag(): string | null {
  try {
    return localStorage.getItem(TUTORIAL_KEY);
  } catch {
    return null;
  }
}

/** 記住教學狀態 */
function writeTutorialFlag(v: 'done' | 'dismissed'): void {
  try {
    localStorage.setItem(TUTORIAL_KEY, v);
  } catch {
    // 儲存空間被封鎖：這次仍然生效，只是不會記住
  }
}

/**
 * 遊戲主體：狀態機（標題 → 組隊 → 每一戰：倒數發射 → 對戰 → 回合結束 → … → 延長賽選擇 → 結果）與每幀迴圈。
 * 賽制是 3 對 3：雙方各挑三顆依序對戰，三戰總分高者勝，平手打延長賽（規則在 sim/team.ts）。
 * 把模擬事件分派給特效、鏡頭導演、音效、語音與 HUD。
 */
export class Game {
  readonly gfx: GameRenderer;
  readonly director = new CameraDirector();
  readonly hud = new Hud();
  readonly effects: Effects;
  state: GameState = 'title';
  audio: AudioEngine | null = null;
  voice: VoicePlayer | null = null;
  sim: BattleSim | null = null;
  /** 目前的 3 對 3 對戰 */
  match: TeamMatch | null = null;
  /** 玩家與 CPU 的隊伍（順序即出場順序） */
  playerTeam: TopId[] = [];
  cpuTeam: TopId[] = [];
  /** 玩家隊伍換上的備用零件（CPU 一律原廠） */
  playerLoadouts: TeamLoadouts = {};
  /** 組隊畫面選的場地（含隨機）與這場比賽實際使用的場地 */
  arenaChoice: ArenaChoice;
  arena: ArenaSpec = ARENAS.practice;
  /** 已開打的回合數（含平手重打） */
  round = 0;
  /** e2e 觀察用的累計數字 */
  readonly counters = { clashes: 0, bigClashes: 0, finishes: 0, specials: 0, rounds: 0, matches: 0, hazards: 0, dashes: 0 };
  /** 最近一次發射的評價與轉速比例（cpu 為 CPU 的發射力道；aim 為玩家的瞄準角度；pull 為拉條量測，按 Space 發射時為 null） */
  lastLaunch: { ratio: number; label: string; cpu: number; aim: number; pull: PullMetrics | null } = { ratio: 0, label: '', cpu: 0, aim: 0, pull: null };
  /** 目前難度（展示模式固定普通） */
  difficulty: Difficulty;
  /** 最近一次終結方式（e2e 觀察用） */
  lastFinish: FinishType | null = null;

  private readonly opts: GameOptions;
  private readonly rig: CameraRig;
  private stadium: Stadium;
  private readonly lights: StadiumLights;
  /** 拉條中的狀態：按下的指標與取樣點（沒在拉時為 null） */
  private pull: { pointerId: number; samples: PullSample[] } | null = null;
  /** 放手時量測到的拉條（Space 發射時為 null） */
  private pullResult: PullMetrics | null = null;
  /** 瞄準箭頭（拉條時顯示在玩家發射位置） */
  private readonly aimArrow: THREE.Mesh;
  private readonly rng: Rng;
  private readonly keys = new Set<string>();
  private views: TopView[] = [];
  private hums: Hum[] = [];
  private preview: { view: TopView; state: TopState } | null = null;
  /** 組隊畫面的外觀與絕招示範（只在組隊畫面存在） */
  private showcase: Showcase | null = null;
  private playerSpec: TopSpec = TOP_SPECS.blaze;
  private cpuSpec: TopSpec = TOP_SPECS.turtle;
  private cpuRng: Rng;
  private acc = 0;
  private clock = 0;
  private stateTime = 0;
  private last = performance.now();
  /** 發射階段：已播放到第幾拍、玩家按下的時間 */
  private launchBeat = 0;
  private launchPress: number | null = null;
  private launched = false;
  /** cut-in 橫幅剩餘顯示秒數（牆鐘） */
  private cutinLeft = 0;
  private lastDirectorMode = 'overview';
  private musicOn = true;
  private roundFlags = { hurt: false, taunt: false };
  /** 每戰開頭主播介紹的長度：倒數在這之後才開始（秒，牆鐘） */
  private launchLead = COUNT_START;
  /** 上一回合的對陣（用來判斷是不是平手重打） */
  private lastBattle = 0;
  /** 延長賽 CPU 挑的陀螺（選擇畫面開啟時就決定） */
  private overtimeCpu: TopId = 'blaze';
  /** 除錯暫停：畫面照常渲染，但時間不前進（e2e 定格截圖用） */
  paused = false;
  /** 觸控模式：偵測到觸控裝置或第一次觸控後開啟，對戰中用滑動操作 */
  touchMode = false;
  private readonly touch: SwipeControls;
  /** 已渲染的影格數 */
  frames = 0;
  /** 自己在模擬裡的座位（CPU 模式固定 0；線上對戰每一戰輪替） */
  private me: 0 | 1 = 0;
  /** 對手在畫面上的稱呼（CPU 模式為 CPU，線上為對手名稱） */
  private oppLabel = tr('cpu');
  /** 線上對戰（CPU 模式為 null） */
  private online: OnlineSession | null = null;
  /**
   * 操作教學進行中的狀態（沒在教學時為 null）：
   * flow 步驟流程、ui 教學畫面、pushTime 對戰中推移的累計秒數、next「下一步」按鈕的訊號（用一次就清掉）、
   * holdUntil 發射倒數暫停到這個時間（解說講完才開始倒數）、firstOrder 第 2 步一開始的出場順序、
   * narrated 這一步的解說播過了沒、narrateAt 最早何時播（等主播講完）、guideReady 解說音檔載好了沒、
   * restoreDifficulty 教學結束後還原的難度（教學固定用簡單）、
   * demoLaunch 這次倒數暫停時要不要播發射示範（重來的那一次不播）、demoTime 示範播了幾秒、demoShown 發射台目前由示範控制。
   */
  private tut: {
    flow: TutorialFlow;
    ui: TutorialOverlay;
    pushTime: number;
    next: boolean;
    holdUntil: number;
    firstOrder: string | null;
    narrated: boolean;
    narrateAt: number;
    guideReady: boolean;
    restoreDifficulty: Difficulty;
    demoLaunch: boolean;
    demoTime: number;
    demoShown: boolean;
  } | null = null;
  /**
   * 試驗模式（一對一比較陀螺與零件）進行中的一組設定：cfg 設定、key（同一組設定的代號）、
   * clashes／bigClashes 這一戰開始時的撞擊次數（算這一戰的數據）、end 終結當下雙方的轉速與爆裂值；不在試驗中為 null。
   */
  private trial: {
    cfg: TrialConfig;
    key: string;
    clashes: number;
    bigClashes: number;
    end: { rpm: [number, number]; burst: [number, number] } | null;
  } | null = null;
  /** 上一次試驗的設定（回到試驗畫面時沿用；存在瀏覽器裡） */
  private trialCfg: TrialConfig | null = null;
  /** 各組設定的紀錄（累計戰績、最近一次自動對打的結果；存在瀏覽器裡，見 saveTrial） */
  private trialStore: TrialStore;
  /** 電腦自動對打：背景執行的 Worker 與這次工作的編號（舊工作的回報一律忽略）、目前進度 */
  private autoWorker: Worker | null = null;
  private autoJobId = 0;
  private autoProgress: number | null = null;
  /** 沒有 Worker 可用時的退路：在畫面的每幀分批推進 */
  private trialAuto: AutoDuel | null = null;
  /** 最近一次自動對打的結果（e2e 觀察用） */
  lastAutoDuel: DuelSummary | null = null;
  /** 這則快照裡伺服器判定為重擊（觸發特寫）的撞擊位置 */
  private bigClashPos: V2[] = [];

  constructor(container: HTMLElement, opts: GameOptions) {
    this.opts = opts;
    this.difficulty = opts.demo ? DIFFICULTIES.normal : loadDifficulty();
    this.trialStore = loadTrialStore();
    this.trialCfg = this.trialStore.cfg;
    this.arenaChoice = opts.demo ? (opts.arena ?? 'practice') : loadArena();
    this.rng = createRng(opts.seed);
    this.cpuRng = createRng(opts.seed * 31 + 7);
    // 觸控裝置（手機、平板）：開啟觸控操作並降低畫質以維持流暢
    const coarse = window.matchMedia('(any-pointer: coarse)').matches;
    this.gfx = new GameRenderer(container, coarse);
    this.lights = buildLights(this.gfx.scene, coarse);
    this.arena = ARENAS[this.arenaChoice === 'random' ? 'practice' : this.arenaChoice];
    this.stadium = buildStadium(this.gfx.scene, this.arena);
    this.lights.setTheme(this.arena);
    this.aimArrow = buildAimArrow();
    this.aimArrow.visible = false;
    this.gfx.scene.add(this.aimArrow);
    this.touch = new SwipeControls({ onSpecial: () => this.trySpecial(), onFlick: (d) => this.tryDash(d) });
    // 必殺按鈕（手機、必殺集滿時才出現）：按下就發動；事件不往外傳，不會被當成滑動推移或多指觸控
    const specialBtn = document.getElementById('special-btn')!;
    specialBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.trySpecial();
    });
    for (const ev of ['touchstart', 'click'] as const) specialBtn.addEventListener(ev, (e) => e.stopPropagation());
    if (coarse) this.enableTouchMode();
    this.effects = new Effects(this.gfx.scene);
    this.effects.arena = this.arena;
    this.rig = new CameraRig(this.gfx.camera);
    this.rig.arena = this.arena;

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.enableTouchMode();
      this.onPullStart(e);
    });
    window.addEventListener('pointermove', (e) => this.onPullMove(e));
    window.addEventListener('pointerup', (e) => this.onPullEnd(e));
    window.addEventListener('pointercancel', (e) => this.onPullEnd(e));
    window.addEventListener('blur', () => this.keys.clear());
    // 標題畫面切換語言：語音換成那一種語言（還沒載過就在背景載入）
    onLangChange((l) => this.voice?.setLang(l));

    if (opts.demo) {
      document.getElementById('title')!.hidden = true;
      void this.boot().then(() => this.startDemoMatch());
    } else {
      // 不等語音下載完：選角畫面立刻出現，語音在背景載入（選角通常比下載久）
      this.toTitle();
    }
    this.gfx.renderer.setAnimationLoop(() => this.frame());
  }

  /**
   * 建立音訊並開始在背景載入語音；回傳的 Promise 在語音載入完成時結束。
   * 瀏覽器在使用者操作前不允許出聲：沒有手勢時 resume() 會一直等待，
   * 所以不 await；若仍是暫停狀態就顯示「點擊開啟聲音」，等下一次點擊或按鍵再恢復。
   */
  private boot(): Promise<void> {
    // 回到標題再開始時不重複建立音訊
    if (this.audio) return Promise.resolve();
    this.audio = new AudioEngine();
    const audio = this.audio;
    void audio.resume().catch(() => undefined);
    const hint = document.getElementById('audio-hint')!;
    const unlock = () => {
      void audio.resume().then(() => {
        if (audio.ctx.state === 'running') {
          hint.hidden = true;
          for (const ev of ['pointerdown', 'keydown', 'touchend', 'click']) window.removeEventListener(ev, unlock);
        }
      });
    };
    // iOS Safari 過去只在 touchend／click 時允許開聲音，一起監聽
    for (const ev of ['pointerdown', 'keydown', 'touchend', 'click']) window.addEventListener(ev, unlock);
    audio.ctx.addEventListener('statechange', () => (hint.hidden = audio.ctx.state === 'running'));
    // 給瀏覽器一點時間套用剛才的手勢，仍是暫停才顯示提示
    window.setTimeout(() => (hint.hidden = audio.ctx.state === 'running'), 300);
    this.voice = new VoicePlayer(this.audio);
    // 觀眾歡呼的錄音：背景載入，不擋住遊戲；失敗就不歡呼（只記警告，不當成錯誤）
    this.audio.loadCheer(`${import.meta.env.BASE_URL}sfx/cheer.mp3`).catch((e) => console.warn('[audio] cheer', e));
    this.audio.setMusic(this.musicOn, false);
    return this.voice.load();
  }

  /** 目前總分 [玩家, CPU]；試驗模式為這組設定的累計 [勝, 敗] */
  get score(): [number, number] {
    if (this.trial) {
      const r = this.trialStore.entries[this.trial.key]?.record;
      return r ? [r.wins, r.losses] : [0, 0];
    }
    return this.match?.score ?? [0, 0];
  }

  /** 組一支 3 顆不重複的隊伍：先放指定的，其餘隨機補滿 */
  private fillTeam(hint: TopId[] = []): TopId[] {
    const team = [...new Set(hint)].slice(0, 3);
    const rest = TOP_IDS.filter((t) => !team.includes(t));
    while (team.length < 3) team.push(rest.splice(Math.floor(this.rng() * rest.length), 1)[0]);
    return team;
  }

  /** 玩家陀螺的規格（套用換上的零件） */
  playerSpecOf(id: TopId): TopSpec {
    return buildSpec(id, this.playerLoadouts[id] ?? STOCK);
  }

  /** 展示模式：雙方隨機組隊（可用網址參數指定前幾顆）後開打 */
  private startDemoMatch(): void {
    this.playerLoadouts = {};
    this.playerTeam = this.fillTeam(this.opts.player);
    this.cpuTeam = this.fillTeam(this.opts.cpu);
    this.startMatch();
  }

  private setState(s: GameState): void {
    this.state = s;
    this.stateTime = 0;
  }

  // ---------------- 選角 ----------------

  /**
   * 組隊第 1 步：CPU 先組好（公開三顆、順序保密），玩家從全部陀螺挑三顆，並選難度與場地。
   * keep：從第 2 步回上一步時保留的三顆與零件（CPU 的隊伍不重抽）。
   */
  private enterSelect(keep?: { picks: TopId[]; loadouts: TeamLoadouts }): void {
    this.me = 0;
    this.rig.seat = 0;
    this.oppLabel = tr('cpu');
    this.setState('select');
    this.hud.hideHud();
    this.hud.clearBanner();
    this.clearArena();
    this.audio?.setMusic(this.musicOn, false);
    if (!keep) this.cpuTeam = cpuPickTeam(this.rng);
    this.hud.showTeamSelect({
      specs: TOP_SPECS,
      cpuTeam: this.cpuTeam,
      difficulty: this.difficulty.id,
      arena: this.arenaChoice,
      picks: keep?.picks,
      onDifficulty: (d) => this.setDifficulty(d),
      onArena: (a) => this.chooseArena(a),
      // 外觀與絕招示範在詳細資料的舞台窗裡播放；主場景的場地中央不再放預覽陀螺（會被名鑑擋住）
      onHover: (sp) => this.ensureShowcase()?.setSpec(sp),
      thumb: (sp, cb) => this.ensureShowcase()?.thumb(sp, cb),
      onNext: (picks) => {
        // 回上一步後還留在隊伍裡的陀螺保留零件
        const loadouts: TeamLoadouts = {};
        for (const t of picks) if (keep?.loadouts[t]) loadouts[t] = keep.loadouts[t];
        this.closeShowcase();
        this.enterArrange(picks, loadouts);
      },
    });
  }

  /** 組隊第 2 步（CPU）：調整出場順序與零件，不計時；可以回上一步改選的三顆 */
  private enterArrange(picks: TopId[], loadouts: TeamLoadouts): void {
    this.setState('arrange');
    this.hud.showArrange({
      specs: TOP_SPECS,
      order: picks,
      loadouts,
      opponent: { label: tr('select.cpuTeam'), team: TOP_IDS.filter((t) => this.cpuTeam.includes(t)), note: tr('select.cpuNote') },
      arena: this.arenaChoice === 'random' ? tr('arena.randomPick') : plainName(ARENAS[this.arenaChoice]),
      deadline: null,
      readyLabel: tr('arrange.ready'),
      onBack: (order, lo) => {
        this.closeShowcase();
        this.enterSelect({ picks: order, loadouts: lo });
      },
      onReady: (order, lo) => {
        this.hud.hideArrange();
        this.playerTeam = order;
        this.playerLoadouts = lo;
        this.setPreview(null);
        this.closeShowcase();
        this.startMatch();
      },
      onHover: (sp) => this.ensureShowcase()?.setSpec(sp),
      thumb: (sp, cb) => this.ensureShowcase()?.thumb(sp, cb),
    });
  }

  /** 組隊畫面的絕招示範：第一次需要時用詳細資料的畫布建立 */
  private ensureShowcase(): Showcase | null {
    if (!this.showcase) {
      const canvas = this.hud.stageCanvas();
      if (canvas) this.showcase = new Showcase(canvas, (name) => this.hud.stageFlash(name));
    }
    return this.showcase;
  }

  /** 離開組隊畫面：釋放絕招示範的渲染器 */
  private closeShowcase(): void {
    this.showcase?.dispose();
    this.showcase = null;
  }

  /** 組隊畫面切換場地：記在瀏覽器；不是隨機就立刻換上該場地預覽 */
  private chooseArena(choice: ArenaChoice): void {
    this.arenaChoice = choice;
    try {
      localStorage.setItem(ARENA_KEY, choice);
    } catch {
      // 儲存空間被封鎖：這次仍然生效，只是不會記住
    }
    if (choice !== 'random') this.setArena(ARENAS[choice]);
  }

  /** 換場地：重建場館外觀、燈光主題，並通知特效與鏡頭 */
  private setArena(a: ArenaSpec): void {
    if (a === this.arena) return;
    this.arena = a;
    this.stadium.dispose();
    this.stadium = buildStadium(this.gfx.scene, a);
    this.lights.setTheme(a);
    this.effects.arena = a;
    this.rig.arena = a;
    // 預覽中的陀螺要貼到新場地的地面
    if (this.preview) this.setPreview(this.preview.state.spec);
  }

  /** 切換難度並記在瀏覽器 */
  private setDifficulty(id: DifficultyId): void {
    this.difficulty = DIFFICULTIES[id];
    try {
      localStorage.setItem(DIFFICULTY_KEY, id);
    } catch {
      // 儲存空間被封鎖：這次仍然生效，只是不會記住
    }
  }

  /** 選角時在場地中央轉的預覽陀螺 */
  private setPreview(spec: TopSpec | null): void {
    if (this.preview) this.preview.view.dispose();
    this.preview = null;
    if (!spec) return;
    // 火山中央是火山錐：預覽陀螺放在錐頂也沒關係（只是展示）
    const state = createTop(0, spec, { x: 0, z: 0 }, { x: 0, z: 0 }, 1);
    this.preview = { view: new TopView(this.gfx.scene, spec, this.arena), state };
  }

  // ---------------- 試驗模式 ----------------

  /** 試驗模式的設定畫面：一對一，自己挑雙方的陀螺與零件、場地（沒有隨機）與難度 */
  private enterTrial(): void {
    this.me = 0;
    this.rig.seat = 0;
    this.oppLabel = tr('cpu');
    this.trial = null;
    this.stopAutoDuel();
    this.setState('trial');
    this.hud.hideHud();
    this.hud.clearBanner();
    this.hud.hideTrialResult();
    this.clearArena();
    this.audio?.setMusic(this.musicOn, false);
    const cfg: TrialConfig = this.trialCfg ?? {
      player: { top: 'blaze', loadout: { ...STOCK } },
      cpu: { top: 'turtle', loadout: { ...STOCK } },
      arena: this.arenaChoice === 'random' ? 'practice' : this.arenaChoice,
      difficulty: this.difficulty.id,
    };
    this.setArena(ARENAS[cfg.arena]);
    this.hud.showTrial({
      specs: TOP_SPECS,
      config: cfg,
      onDifficulty: (d) => this.setDifficulty(d),
      onArena: (a) => this.setArena(ARENAS[a]),
      onHover: (sp) => this.ensureShowcase()?.setSpec(sp),
      thumb: (sp, cb) => this.ensureShowcase()?.thumb(sp, cb),
      onStart: (c) => {
        this.closeShowcase();
        this.startTrial(c);
      },
      onAuto: (c) => {
        this.closeShowcase();
        this.trialCfg = c;
        this.saveTrial();
        this.setDifficulty(c.difficulty);
        this.showTrialScreen(null);
        this.startAutoDuel(c);
      },
      onBack: () => {
        this.closeShowcase();
        this.toTitle();
      },
    });
  }

  /** 開始試驗的一戰（單戰，不計 3 對 3 的比分）：同一組設定沿用累計戰績 */
  private startTrial(cfg: TrialConfig): void {
    this.trialCfg = cfg;
    this.saveTrial();
    this.trial = { cfg, key: trialKey(cfg), clashes: 0, bigClashes: 0, end: null };
    this.stopAutoDuel();
    this.hud.hideTrialResult();
    this.setDifficulty(cfg.difficulty);
    this.setArena(ARENAS[cfg.arena]);
    this.match = null;
    this.round = 0;
    this.lastBattle = 0;
    this.playerSpec = buildSpec(cfg.player.top, cfg.player.loadout);
    this.cpuSpec = buildSpec(cfg.cpu.top, cfg.cpu.loadout);
    const record = this.trialStore.entries[this.trial.key]?.record;
    this.openRound({
      title: tr('banner.trial'),
      replay: false,
      line: record?.games ? 'round_ready' : 'battle_1',
      score: record ? [record.wins, record.losses] : [0, 0],
      info: () => this.hud.setTrialInfo(this.playerSpec, this.cpuSpec, plainName(this.arena)),
    });
    this.trial.clashes = this.counters.clashes;
    this.trial.bigClashes = this.counters.bigClashes;
  }

  /** 試驗的一戰打完：記上這組設定的累計戰績，顯示這一戰的數據 */
  private finishTrialRound(): void {
    const t = this.trial!;
    const sim = this.sim;
    const res = sim?.result ?? null;
    this.counters.rounds++;
    if (res) {
      const e = this.trialEntry(t.cfg);
      e.record = addTrialResult(e.record, res);
      e.at = Date.now();
      this.saveTrial();
    }
    this.hud.clearBanner();
    this.hud.hideHud();
    this.audio?.setMusic(this.musicOn, false);
    let battle: TrialBattleStats | null = null;
    if (sim) {
      const [p, c] = sim.tops;
      const end = t.end ?? { rpm: [rpmOf(p), rpmOf(c)], burst: [Math.min(1, p.burst), Math.min(1, c.burst)] };
      battle = {
        winner: res?.winner === 0 || res?.winner === 1 ? res.winner : null,
        finish: res?.finish ?? null,
        time: sim.time,
        rpm: end.rpm,
        burst: end.burst,
        launch: [this.lastLaunch.ratio, this.lastLaunch.cpu],
        specials: [p.specialUsed, c.specialUsed],
        clashes: this.counters.clashes - t.clashes,
        bigClashes: this.counters.bigClashes - t.bigClashes,
      };
    }
    this.showTrialScreen(battle);
  }

  /** 試驗模式的結果畫面（battle 為 null 時只看自動對打） */
  private showTrialScreen(battle: TrialBattleStats | null): void {
    const cfg = this.trialCfg!;
    this.setState('trialResult');
    this.hud.showTrialResult({
      player: buildSpec(cfg.player.top, cfg.player.loadout),
      cpu: buildSpec(cfg.cpu.top, cfg.cpu.loadout),
      arenaName: plainName(ARENAS[cfg.arena]),
      difficulty: cfg.difficulty,
      battle,
      record: this.trialStore.entries[trialKey(cfg)]?.record ?? emptyTrialRecord(),
      auto: this.trialStore.entries[trialKey(cfg)]?.auto ?? null,
      onRetry: () => this.startTrial(cfg),
      onChange: () => this.enterTrial(),
      onAuto: () => this.startAutoDuel(cfg),
      onCancelAuto: () => {
        this.stopAutoDuel();
        this.hud.setTrialAuto(null);
      },
      onClear: () => {
        // 清除全部組合的紀錄（累計戰績與自動對打的結果），上次的設定保留
        this.trialStore.entries = {};
        this.saveTrial();
        this.hud.setTrialRecord(emptyTrialRecord());
        this.hud.setTrialAuto(null);
      },
      onTitle: () => this.toTitle(),
    });
  }

  /** 某組設定的紀錄（沒有就建一筆空的） */
  private trialEntry(cfg: TrialConfig): TrialEntry {
    const key = trialKey(cfg);
    return (this.trialStore.entries[key] ??= { cfg, record: emptyTrialRecord(), at: Date.now() });
  }

  /** 把試驗紀錄（上次的設定、各組設定的紀錄，最多 50 組）存進瀏覽器；儲存空間被封鎖時這次照常運作，只是不會記住 */
  private saveTrial(): void {
    this.trialStore = pruneTrialStore({ ...this.trialStore, cfg: this.trialCfg });
    try {
      localStorage.setItem(TRIAL_STORE_KEY, JSON.stringify(this.trialStore));
    } catch {
      // 儲存空間被封鎖或已滿：不影響遊戲
    }
  }

  /**
   * 電腦自動對打 AUTO_DUEL_GAMES 場：在 Web Worker 背景執行（畫面不卡、不受影格速度影響），
   * 每 10 場回報一次進度；不能用 Worker 時退回在畫面的每幀分批推進（見 frame）。
   */
  private startAutoDuel(cfg: TrialConfig): void {
    this.stopAutoDuel();
    const req: AutoDuelRequest = { id: ++this.autoJobId, cfg, total: AUTO_DUEL_GAMES, seed: Math.floor(this.rng() * 1e9) };
    this.autoProgress = 0;
    this.hud.setTrialAuto({ progress: 0 });
    try {
      if (typeof Worker === 'undefined') throw new Error('沒有 Worker');
      const w = new Worker(new URL('../sim/autoDuel.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<AutoDuelMessage>) => {
        const m = e.data;
        if (m.id !== this.autoJobId || this.autoWorker !== w) return;
        if (m.type === 'progress') {
          this.autoProgress = m.progress;
          this.hud.setTrialAuto({ progress: m.progress });
        } else {
          this.finishAutoDuel(cfg, m.summary);
        }
      };
      // Worker 載入或執行失敗：改在畫面上分批算
      w.onerror = () => {
        if (this.autoWorker !== w) return;
        this.stopAutoDuel();
        this.trialAuto = new AutoDuel(cfg, req.total, req.seed);
      };
      this.autoWorker = w;
      w.postMessage(req);
    } catch {
      this.trialAuto = new AutoDuel(cfg, req.total, req.seed);
    }
  }

  /** 自動對打打完：記下結果（存進這組設定的紀錄）並顯示 */
  private finishAutoDuel(cfg: TrialConfig, summary: DuelSummary): void {
    this.stopAutoDuel();
    this.lastAutoDuel = summary;
    const e = this.trialEntry(cfg);
    e.auto = summary;
    e.at = Date.now();
    this.saveTrial();
    this.hud.setTrialAuto({ progress: 1, summary });
  }

  /** 停止進行中的自動對打（關掉 Worker；之後收到的回報都會被忽略） */
  private stopAutoDuel(): void {
    this.autoWorker?.terminate();
    this.autoWorker = null;
    this.trialAuto = null;
    this.autoProgress = null;
    this.autoJobId++;
  }


  // ---------------- 比賽流程 ----------------

  /** 開始一場 3 對 3：隨機場地在這時抽出，整場（含延長賽）都用同一個場地 */
  private startMatch(): void {
    // 教學固定在練習場（沒有機關），不改玩家記住的場地
    const choice = this.tut ? 'practice' : this.arenaChoice;
    this.setArena(ARENAS[choice === 'random' ? ARENA_IDS[Math.floor(this.rng() * ARENA_IDS.length)] : choice]);
    this.match = createMatch(this.playerTeam, this.cpuTeam);
    this.round = 0;
    this.lastBattle = 0;
    this.hud.hideResult();
    this.startRound();
  }

  /** 清掉場上的陀螺、轉動聲與特效 */
  private clearArena(): void {
    for (const v of this.views) v.dispose();
    for (const h of this.hums) h.stop();
    this.views = [];
    this.hums = [];
    this.sim = null;
    this.effects.clear();
  }

  /**
   * 新的一戰：依對陣換上雙方陀螺、揭曉 CPU 出場的陀螺，主播介紹後進入倒數發射。
   * 平手重打時沿用同一組對陣。
   */
  private startRound(): void {
    const m = this.match!;
    const pair = currentPairing(m)!;
    const replay = pair.battle === this.lastBattle;
    this.lastBattle = pair.battle;
    this.playerSpec = this.playerSpecOf(pair.player);
    this.cpuSpec = TOP_SPECS[pair.cpu];
    this.beginRound(pair, replay);
  }

  /**
   * 一戰的開場（CPU 模式與線上共用）：換上雙方陀螺、HUD、大字與主播介紹，進入倒數發射。
   * current：線上時由伺服器告知目前的對陣（對手的出場順序保密，無法從隊伍推算）。
   */
  private beginRound(pair: Pairing, replay: boolean, current?: Pairing): void {
    const m = this.match!;
    const title = pair.overtime ? tr('banner.overtime') : pair.battle === 3 ? tr('banner.final') : tr('banner.battle', { n: pair.battle });
    const line: VoiceId = replay ? 'round_ready' : pair.overtime || pair.battle === 3 ? 'battle_final' : pair.battle === 1 ? 'battle_1' : 'battle_2';
    this.openRound({ title, replay, line, score: m.score, info: () => this.hud.setMatchInfo(m, TOP_SPECS, plainName(this.arena), current) });
  }

  /**
   * 一戰開場的共用部分（3 對 3、線上、試驗模式）：清場、HUD、大字與主播介紹，進入倒數發射。
   * title 大字標題、line 主播介紹的台詞、score HUD 比分、info 填 HUD 賽況列。
   */
  private openRound(o: { title: string; replay: boolean; line: VoiceId; score: [number, number]; info: () => void }): void {
    this.clearArena();
    this.round++;
    this.director.reset();
    this.launchBeat = 0;
    this.launchPress = null;
    this.launched = false;
    this.roundFlags = { hurt: false, taunt: false };
    this.audio?.setMusic(this.musicOn, true);
    this.hud.showHud(this.playerSpec, this.cpuSpec, this.oppLabel);
    o.info();
    this.hud.updateHud(
      [createTop(0, this.playerSpec, { x: 0, z: 0 }, { x: 0, z: 0 }, 1), createTop(1, this.cpuSpec, { x: 0, z: 0 }, { x: 0, z: 0 }, 1)],
      o.score,
    );
    this.pull = null;
    this.pullResult = null;
    this.setState('launch');
    this.hud.banner(o.title, `${topName(this.playerSpec)}  ${tr('vs')}  ${topName(this.cpuSpec)}${o.replay ? tr('banner.replay') : ''}
${tr('banner.at', { arena: plainName(this.arena) })}`, {
      small: true,
      seconds: 0,
    });
    const line = o.line;
    const spoke = this.voice?.play(line, 2) ?? false;
    // 主播講完才開始倒數，避免「スリー」／「三」蓋掉開場介紹
    this.launchLead = Math.max(1.4, (spoke ? this.voice!.duration(line) : 0) + 0.4);
  }

  /** 倒數用的時鐘：主播介紹結束時為 COUNT_START */
  private launchClock(): number {
    return this.stateTime - this.launchLead + COUNT_START;
  }

  /** 倒數與發射（每幀） */
  private updateLaunch(): void {
    const t = this.launchClock();
    if (t < COUNT_START) return;
    const beat = Math.floor((t - COUNT_START) / BEAT) + 1;
    if (beat > this.launchBeat && beat <= 4) {
      this.launchBeat = beat;
      if (beat <= 3) {
        const n = 4 - beat;
        this.hud.banner(String(n), '', { seconds: 0.6 });
        this.audio?.countdown(false);
        this.voice?.play(`countdown_${n}` as VoiceId, 2);
      } else {
        this.hud.banner(tr('banner.go'), '', { seconds: 0.9 });
        this.audio?.countdown(true);
        this.voice?.play('go_shoot', 2);
      }
    }
    const progress = (t - COUNT_START) / (GO_AT - COUNT_START);
    this.hud.launchMeter(!this.opts.demo && !this.launched && t >= COUNT_START, progress, this.cordView());
    this.updateAimArrow();

    // 展示模式：自動在 GO 附近按下
    if (this.opts.demo && this.launchPress === null && t >= GO_AT - 0.03) this.launchPress = t + (this.rng() - 0.5) * 0.12;
    // 拉著不放太久：自動放手
    if (this.pull && t > GO_AT + 0.6) this.releasePull();

    const press = this.launchPress;
    const late = t > GO_AT + 0.4 && !this.pull;
    if (!this.launched && ((press !== null && t >= Math.max(GO_AT, press)) || late)) {
      this.launch(press === null ? 1 : press - GO_AT);
    }
  }

  /** Space 簡易發射：只接受「1」之後的輸入，力道最高 85% */
  private onLaunchPress(): void {
    if (this.state !== 'launch' || this.launched || this.launchPress !== null || this.pull) return;
    const t = this.launchClock();
    if (t < COUNT_START + BEAT * 2) return;
    this.pullResult = null;
    this.launchPress = t;
  }

  /** 按下：倒數開始後在畫面任意處按住，開始拉條 */
  private onPullStart(e: PointerEvent): void {
    if (this.state !== 'launch' || this.launched || this.launchPress !== null || this.pull || this.opts.demo) return;
    if (this.launchClock() < COUNT_START) return;
    this.pull = { pointerId: e.pointerId, samples: [{ t: performance.now() / 1000, x: e.clientX, y: e.clientY }] };
  }

  /** 拉動：記錄取樣點（速度與方向用） */
  private onPullMove(e: PointerEvent): void {
    if (!this.pull || e.pointerId !== this.pull.pointerId) return;
    this.pull.samples.push({ t: performance.now() / 1000, x: e.clientX, y: e.clientY });
    // 只留最近一段（起點一定保留），避免按著不動太久時陣列一直長
    trimPullSamples(this.pull.samples, performance.now() / 1000);
  }

  /** 放手：量測拉條並在這個時間點發射 */
  private onPullEnd(e: PointerEvent): void {
    if (!this.pull || e.pointerId !== this.pull.pointerId) return;
    this.pull.samples.push({ t: performance.now() / 1000, x: e.clientX, y: e.clientY });
    this.releasePull();
  }

  /** 結束拉條：記下量測結果與放手時間（發射時機） */
  private releasePull(): void {
    if (!this.pull) return;
    this.pullResult = measurePull(this.pull.samples, this.pullScale());
    this.pull = null;
    this.launchPress = this.launchClock();
  }

  /** 拉條的尺度：畫面短邊 */
  private pullScale(): number {
    return Math.min(window.innerWidth, window.innerHeight);
  }

  /** 拉條中的畫面資料（沒在拉時為 null） */
  private cordView(): CordView | null {
    if (!this.pull) return null;
    const s = this.pull.samples;
    const m = measurePull(s, this.pullScale());
    return { from: { x: s[0].x, y: s[0].y }, to: { x: s[s.length - 1].x, y: s[s.length - 1].y }, power: pullQuality(m), aim: m.aim };
  }

  /**
   * 螢幕上的瞄準角度（正值 = 往右）換成模擬中的初速旋轉角。
   * 看發射時的鏡頭：把基準方向轉一點點，投影到畫面上是往右還是往左。
   */
  private worldAim(screenAim: number): number {
    const cam = this.gfx.camera;
    const f = cam.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3(-f.z, 0, f.x);
    // 基準方向逆時針（正角度）轉動時的變化方向
    const base = SEAT_LAUNCH_DIR[this.me];
    const d = { x: -base.z, z: base.x };
    const sign = d.x * right.x + d.z * right.z >= 0 ? 1 : -1;
    return screenAim * sign;
  }

  /** 拉條時在玩家發射位置顯示瞄準箭頭 */
  private updateAimArrow(): void {
    const view = this.cordView();
    this.aimArrow.visible = view !== null && view.power > 0.02;
    if (!view) return;
    const base = SEAT_LAUNCH_DIR[this.me];
    const start = SEAT_START[this.me];
    const a = Math.atan2(base.z, base.x) + this.worldAim(view.aim);
    const r = Math.hypot(start.x, start.z);
    this.aimArrow.position.set(start.x, floorHeight(r, this.arena) + 0.05, start.z);
    // 箭頭幾何沿 +x；three.js 的 rotation.y 正值是從 +x 轉向 -z，與模擬的角度方向相反
    this.aimArrow.rotation.y = -a;
    this.aimArrow.scale.set(0.6 + view.power * 1.2, 1, 1);
  }

  /**
   * 發射：依時機誤差與拉條決定轉速、依拉的方向決定發射角度，建立模擬與畫面。
   * 拉條發射：時機分 ×（難度保底 + 拉條品質）；Space 發射：只看時機、最高 85%；展示模式只看時機。
   */
  private launch(error: number): void {
    this.launched = true;
    this.hud.launchMeter(false);
    this.aimArrow.visible = false;
    if (this.online) {
      const pull = this.pullResult;
      const aim = pull ? this.worldAim(pull.aim) : 0;
      this.online.sendLaunch(error, aim, pull);
      this.lastLaunch = { ratio: 0, label: '', cpu: 0, aim, pull };
      this.hud.banner(tr('banner.shoot'), tr('banner.waitLaunch', { name: this.oppLabel }), { small: true, seconds: 1.2 });
      return;
    }
    const d = this.difficulty;
    const timing = launchSpinRatio(error, d.launch);
    const pull = this.pullResult;
    const ratio = this.opts.demo ? timing : pull ? pullLaunchRatio(timing, pull, d.pullBase) : keyLaunchRatio(timing);
    const aim = this.opts.demo ? (this.rng() - 0.5) * 0.6 : pull ? this.worldAim(pull.aim) : 0;
    const cpuAim = (this.rng() - 0.5) * 0.7;
    const cpuRatio = d.cpuLaunch[0] + this.rng() * (d.cpuLaunch[1] - d.cpuLaunch[0]);
    const label = rateLabel(ratio);
    this.lastLaunch = { ratio, label, cpu: cpuRatio, aim, pull };
    this.sim = new BattleSim(this.playerSpec, this.cpuSpec, {
      seed: Math.floor(this.rng() * 1e9),
      launch: [ratio, cpuRatio],
      arena: this.arena,
      aim: [aim, cpuAim],
    });
    this.views = this.sim.tops.map((t) => new TopView(this.gfx.scene, t.spec, this.arena));
    if (this.audio) {
      this.hums = this.sim.tops.map((t, i) => this.audio!.createHum(this.world(t.pos, 0.2), i === this.me ? 1 : 0.8));
      for (const t of this.sim.tops) this.audio.launch(this.world(t.pos, 0.3));
    }
    this.hud.banner(label, tr('rate.power', { p: Math.round(ratio * 100) }), { small: true, seconds: 1 });
    if (ratio >= 0.97) window.setTimeout(() => this.voice?.play('p_launch', 1), 900);
    this.acc = 0;
    this.setState('battle');
  }


  // ---------------- 線上對戰 ----------------

  /** 標題畫面：模式選單（電腦對戰／試驗模式／線上對戰／操作教學）；從分享連結（?room=）進來時，按線上對戰直接進那個房間 */
  private toTitle(): void {
    // 從教學中途回到標題（結束教學、或其他流程）：收起教學畫面並還原難度
    if (this.tut) {
      this.tut.ui.dispose();
      this.difficulty = this.tut.restoreDifficulty;
      this.tut = null;
    }
    this.setState('title');
    this.clearArena();
    this.trial = null;
    this.stopAutoDuel();
    this.hud.hideTrial();
    this.hud.hideTrialResult();
    this.hud.hideTeamSelect();
    this.hud.hideArrange();
    this.hud.hideHud();
    this.hud.clearBanner();
    this.hud.hideResult();
    this.hud.hideOnlineLobby();
    this.hud.hideNetOverlay();
    this.hud.hideOvertimePick();
    document.body.classList.remove('selecting');
    this.audio?.setMusic(this.musicOn, false);
    const room = new URLSearchParams(location.search).get('room') ?? '';
    this.hud.showTitle({
      onCpu: () => {
        void this.boot();
        this.enterSelect();
      },
      onTrial: () => {
        void this.boot();
        this.enterTrial();
      },
      onOnline: () => {
        void this.boot();
        this.enterOnline(room);
      },
      tutorial: {
        offer: shouldOfferTutorial(readTutorialFlag()),
        onStart: () => this.startTutorial(),
        onDismiss: () => writeTutorialFlag('dismissed'),
      },
    });
  }

  // ---------------- 操作教學 ----------------

  /**
   * 開始操作教學：一般的 CPU 對戰流程（組隊兩步 → 發射 → 對戰），教學畫面一步一步提示，
   * 玩家做到了才進下一步（流程在 tutorial/flow.ts）。固定練習場、簡單的發射判定；
   * 從發射開始對手不攻擊，發射到必殺的步驟雙方不會被終結。打完第一戰說明計分後回到標題。
   */
  private startTutorial(): void {
    void this.boot();
    this.tut?.ui.dispose();
    const tut = {
      flow: new TutorialFlow(),
      ui: new TutorialOverlay({
        onReplay: () => this.narrate(),
        onSkip: () => this.onTutorialEvent(this.tut?.flow.skip() ?? null),
        onNext: () => {
          if (this.tut) this.tut.next = true;
        },
        onExit: () => this.endTutorial(false),
      }),
      pushTime: 0,
      next: false,
      holdUntil: 0,
      firstOrder: null,
      narrated: false,
      narrateAt: 0,
      guideReady: false,
      restoreDifficulty: this.difficulty,
      demoLaunch: false,
      demoTime: 0,
      demoShown: false,
    };
    this.tut = tut;
    this.difficulty = DIFFICULTIES.easy;
    this.enterSelect();
    this.showTutorialStep();
    // 解說音檔載好才開始講（載入很快；失敗時用語音合成）
    void this.voice?.loadGuide().then(() => {
      if (this.tut === tut) tut.guideReady = true;
    });
  }

  /** 結束教學：完成（或中途離開）記在瀏覽器，之後標題不再提示，回到標題 */
  private endTutorial(completed: boolean): void {
    if (completed) writeTutorialFlag('done');
    else if (readTutorialFlag() !== 'done') writeTutorialFlag('dismissed');
    this.toTitle();
  }

  /** 目前是電腦（鍵盤、滑鼠）還是手機（觸控）：決定解說、字幕與示範動畫 */
  private tutorialInput(): TutorialInput {
    return this.touchMode ? 'tc' : 'kb';
  }

  /** 顯示目前這一步，並做進入這一步要做的事（集滿必殺、削弱對手、暫停倒數等） */
  private showTutorialStep(): void {
    const t = this.tut;
    if (!t) return;
    const step = t.flow.step;
    t.ui.show(step, this.tutorialInput(), t.flow.index, STEPS.length);
    t.narrated = false;
    t.narrateAt = this.clock;
    const me = this.sim?.tops[this.me];
    const cpu = this.sim?.tops[this.me === 0 ? 1 : 0];
    if (step.id === 'launch') {
      // 解說講完才開始倒數（narrate 依解說長度改成實際的時間）；倒數暫停時先在發射台上示範一次
      t.holdUntil = this.clock + 60;
      this.startLaunchDemo();
    } else if (step.id === 'special' && me) {
      // 讓玩家馬上可以試：必殺量表直接集滿（這一戰已經放過也重新給一次）
      me.special = 1;
      me.specialUsed = false;
    } else if (step.id === 'finish' && cpu) {
      // 對手轉速降到兩成：很快就會停轉（或被撞出場、撞到爆裂），不用等很久
      cpu.spin = Math.min(cpu.spin, cpu.spec.maxSpin * 0.2);
    } else if (step.id === 'points') {
      // 等主播喊完終結方式再講解（終結的大字也是 2.6 秒）
      t.narrateAt = this.clock + 2.6;
    }
  }

  /** 播這一步的解說（重聽也用這裡）；發射那一步講完才開始倒數 */
  private narrate(): void {
    const t = this.tut;
    if (!t || !this.voice) return;
    const id = t.flow.step.voice[this.tutorialInput()];
    this.voice.guide(id);
    t.narrated = true;
    if (t.flow.step.id === 'launch' && this.state === 'launch') {
      t.holdUntil = this.clock + this.voice.guideDuration(id) + 0.3;
      // 重聽時也重播示範
      this.startLaunchDemo();
    }
  }

  /** 發射示範從頭播（開場介紹的大字收起，不和發射台疊在一起） */
  private startLaunchDemo(): void {
    const t = this.tut;
    if (!t) return;
    t.demoLaunch = true;
    t.demoTime = 0;
    this.hud.clearBanner();
  }

  /**
   * 發射示範的一幀（3.2 秒一輪，用真的發射台畫面）：0.3 秒按下 → 往下拉到畫面短邊的 45%，外圈同時收縮 →
   * 2.0 秒外圈對上內圈時放手、跳出 GO SHOOT → 手指回到起點。回傳手指（游標）的位置與狀態。
   * 倒數暫停中 updateLaunch 不會畫發射台（還沒到倒數），這裡獨占 launchMeter。
   */
  private launchDemoFrame(time: number): ScreenPoint & { pressed: boolean; go: boolean } {
    const LOOP = 3.2;
    const PRESS = 0.3;
    const RELEASE = 2.0;
    const k = time % LOOP;
    const from = { x: window.innerWidth / 2, y: window.innerHeight * 0.3 };
    const len = Math.min(window.innerWidth, window.innerHeight) * 0.45;
    const pull = Math.max(0, Math.min(1, (k - PRESS) / (RELEASE - PRESS)));
    const eased = 1 - (1 - pull) * (1 - pull);
    const pressed = k >= PRESS && k < RELEASE;
    const to = { x: from.x, y: from.y + len * eased };
    this.hud.launchMeter(true, k / RELEASE, pressed ? { from, to, power: eased, aim: 0 } : null);
    const hand = k < RELEASE + 0.8 ? to : from;
    return { x: hand.x, y: hand.y, pressed, go: k >= RELEASE && k < RELEASE + 0.8 };
  }

  /** 流程的結果：前進就顯示下一步；發射沒拉條就重來這一戰；全部完成就結束教學 */
  private onTutorialEvent(ev: TutorialEvent | null): void {
    const t = this.tut;
    if (!t || !ev) return;
    if (ev === 'done') this.endTutorial(true);
    else if (ev === 'advanced') this.showTutorialStep();
    else {
      t.ui.toast(tr('tut.toastRetry'));
      this.voice?.guide('tut_retry');
      this.restartTutorialRound(1.6);
    }
  }

  /** 教學中重來這一戰（發射沒拉條、保護中被撞出場）：delay 秒後重新開場，倒數等解說講完 */
  private restartTutorialRound(delay: number): void {
    const t = this.tut;
    if (!t) return;
    // 重來的那一次不再示範（只提示在哪裡按住往下拉）
    t.demoLaunch = false;
    t.holdUntil = this.clock + delay + 4;
    window.setTimeout(() => {
      if (this.tut !== t) return;
      this.startRound();
      t.holdUntil = this.clock + 1.2;
    }, delay * 1000);
  }

  /** 保護中被終結（只會是被撞出場）：不計分、提示後重來這一戰，留在同一步 */
  private tutorialKnockedOut(): void {
    const t = this.tut!;
    this.hud.clearBanner();
    t.ui.toast(tr('tut.toastRestart'));
    this.voice?.guide('tut_restart');
    this.restartTutorialRound(2);
  }

  /** 第 2 步目前的出場順序（判斷玩家有沒有調換過） */
  private arrangeOrderKey(): string {
    return [...document.querySelectorAll<HTMLElement>('#arrange .ar-slot')].map((e) => e.dataset.id).join(',');
  }

  /** 每幀：整理教學需要的狀態給流程判斷，播解說，更新聚光圈與大畫面指引 */
  private updateTutorial(wallDt: number): void {
    const t = this.tut;
    if (!t) return;
    let pushing = false;
    if (this.state === 'battle' && this.sim) {
      const c = this.playerControl();
      pushing = c.x !== 0 || c.z !== 0;
      if (pushing) t.pushTime += wallDt;
    }
    if (this.state === 'arrange' && t.firstOrder === null && document.querySelector('#arrange .ar-slot')) t.firstOrder = this.arrangeOrderKey();
    const ctx: TutorialCtx = {
      state: this.state,
      input: this.tutorialInput(),
      picked: [...document.querySelectorAll<HTMLElement>('#select .card.picked')].map((e) => e.dataset.id ?? ''),
      orderChanged: this.state === 'arrange' && t.firstOrder !== null && this.arrangeOrderKey() !== t.firstOrder,
      partChanged: document.querySelector('#arrange .part-btn.changed') !== null,
      partMenu: partMenu.isOpen,
      pulled: (this.lastLaunch.pull?.length ?? 0) >= PULL_MIN,
      pushTime: t.pushTime,
      dashes: this.counters.dashes,
      specials: this.counters.specials,
      finished: this.state === 'roundEnd',
      next: t.next,
    };
    t.next = false;
    this.onTutorialEvent(t.flow.update(ctx));
    if (this.tut !== t) return;
    if (!t.narrated && t.guideReady && this.clock >= t.narrateAt) this.narrate();
    t.ui.update(wallDt, this.guideFrame(t, ctx, wallDt, pushing));
  }

  /**
   * 大畫面指引需要的資料：要框住的元素、雙方陀螺在螢幕上的位置、發射示範或按住的位置、玩家是否正在操作。
   * 發射那一步：倒數暫停中播示範（真的發射台＋手指），倒數開始後提示在哪裡按住往下拉；示範結束時收起發射台。
   */
  private guideFrame(t: NonNullable<Game['tut']>, ctx: TutorialCtx, wallDt: number, pushing: boolean): GuideFrame {
    const step = t.flow.step;
    const frame: GuideFrame = { target: targetOf(step, ctx), busy: this.pull !== null || pushing };
    if (this.sim && (this.state === 'battle' || this.state === 'roundEnd')) {
      const me = this.screenOf(this.sim.tops[this.me].pos);
      const op = this.screenOf(this.sim.tops[this.me === 0 ? 1 : 0].pos);
      frame.player = { x: me.x, y: me.y };
      frame.opponent = { x: op.x, y: op.y };
    }
    const holding = this.state === 'launch' && this.clock < t.holdUntil;
    if (step.id === 'launch' && holding && t.demoLaunch) {
      t.demoTime += wallDt;
      t.demoShown = true;
      frame.launchDemo = this.launchDemoFrame(t.demoTime);
    } else {
      if (t.demoShown) {
        t.demoShown = false;
        this.hud.launchMeter(false);
      }
      if (step.id === 'launch' && this.state === 'launch' && !holding) frame.pressAt = { x: window.innerWidth / 2, y: window.innerHeight * 0.3 };
    }
    return frame;
  }

  /** 線上房間畫面（message 為要顯示的錯誤訊息）：還沒進房就瀏覽房間列表；房主等人中就顯示房號與分享連結 */
  private enterOnline(code: string, message = ''): void {
    this.setState('online');
    this.me = 0;
    this.rig.seat = 0;
    this.clearArena();
    this.closeShowcase();
    this.hud.hideTeamSelect();
    this.hud.hideArrange();
    this.hud.hideHud();
    this.hud.clearBanner();
    this.hud.hideResult();
    this.hud.hideNetOverlay();
    this.hud.hideOvertimePick();
    this.audio?.setMusic(this.musicOn, false);
    this.hud.showOnlineLobby({
      name: loadName(),
      code,
      onCreate: (name, isPublic) => void this.onlineConnect(name, { kind: 'create', isPublic }),
      onJoin: (c, name) => void this.onlineConnect(name, { kind: 'join', code: c }),
      onQuick: (name) => void this.onlineConnect(name, { kind: 'quick' }),
      onBack: () => this.leaveOnline(),
    });
    if (message) this.hud.setOnlineMessage(message, true);
    const o = this.online;
    if (o?.code) this.hud.setOnlineRoom(o.code, o.shareLink(), this.waitingText(o));
    else this.browseRooms();
  }

  /** 取得線上連線（還沒有就建立，並訂閱伺服器訊息與連線狀態） */
  private ensureOnline(name: string): OnlineSession {
    if (!this.online) {
      const o = new OnlineSession(name);
      o.net.on((m) => this.onServer(m));
      o.net.onStatus((st) => this.onNetStatus(st));
      this.online = o;
    }
    return this.online;
  }

  /** 瀏覽房間列表：連上伺服器並定時查詢（連不上時列表標題顯示狀態，下一輪自動重試） */
  private browseRooms(): void {
    const o = this.ensureOnline(loadName() || 'Player');
    o.startBrowsing();
    this.renderRooms();
  }

  /** 畫房間列表與連線狀態（只在線上房間畫面、還沒進房時） */
  private renderRooms(): void {
    const o = this.online;
    if (!o || this.state !== 'online' || o.code) return;
    const st = o.net.status;
    const note = tr(
      st === 'open'
        ? o.roomsSeen
          ? 'online.autoRefresh'
          : 'net.loading'
        : st === 'reconnecting'
          ? 'net.reconnecting'
          : st === 'closed'
            ? 'net.retrying'
            : 'net.connecting',
    );
    this.hud.setRoomList(o.rooms, note);
  }

  /** 房主等人時的提示（公開房間會列在房間列表） */
  private waitingText(o: OnlineSession): string {
    return tr(o.isPublic ? 'online.waitPublic' : 'online.waitPrivate');
  }

  /** 連上對戰伺服器後建立房間、用房號加入或快速加入（連不上時保留連線，房間列表會自動重試） */
  private async onlineConnect(
    rawName: string,
    action: { kind: 'create'; isPublic: boolean } | { kind: 'join'; code: string } | { kind: 'quick' },
  ): Promise<void> {
    const name = rawName.trim() || 'Player';
    saveName(name);
    const o = this.ensureOnline(name);
    o.name = name;
    this.hud.setOnlineBusy(true);
    this.hud.setOnlineMessage(tr('net.connecting'));
    try {
      await o.connect();
    } catch {
      if (this.online !== o) return;
      this.hud.setOnlineBusy(false);
      this.hud.setOnlineMessage(tr('net.cantConnect'), true);
      return;
    }
    // 連線途中按了「返回」
    if (this.online !== o) return;
    this.hud.setOnlineMessage('');
    if (action.kind === 'join') o.join(action.code);
    else if (action.kind === 'quick') o.quick();
    else o.create(action.isPublic);
  }

  /** 離開線上對戰，回到標題 */
  private leaveOnline(): void {
    this.online?.close();
    this.online = null;
    this.me = 0;
    this.rig.seat = 0;
    this.oppLabel = tr('cpu');
    this.closeShowcase();
    this.setPreview(null);
    this.toTitle();
  }

  /**
   * 連線狀態：還沒進房（瀏覽房間列表）時顯示在列表標題；進房後斷線、重連中顯示覆蓋層，
   * 連回來就收起（伺服器會補送完整狀態；等對手組隊與對手斷線暫停的覆蓋層由各自的流程收起）。
   */
  private onNetStatus(s: NetStatus): void {
    const o = this.online;
    if (!o) return;
    if (!o.code) {
      this.renderRooms();
      return;
    }
    if (s === 'reconnecting') this.hud.showNetOverlay(tr('net.reconnecting'), tr('net.backToRoom'));
    else if (s === 'open' && !o.pausedUntil && this.state !== 'waiting') this.hud.hideNetOverlay();
  }

  /** 伺服器訊息分派 */
  private onServer(m: ServerMessage): void {
    const o = this.online;
    if (!o) return;
    switch (m.t) {
      case 'rooms':
        o.onRooms(m);
        this.renderRooms();
        break;
      case 'room':
        o.onRoom(m);
        if (this.state === 'online') this.hud.setOnlineRoom(m.code, o.shareLink(), m.host ? this.waitingText(o) : tr('online.joined'));
        break;
      case 'lobby':
        this.onLobby(m);
        break;
      case 'reveal':
        o.onReveal(m);
        this.enterOnlineArrange(m);
        break;
      case 'teams':
        // 開打前確定的隊伍：時間到自動開打時也以伺服器的順序與零件為準（延長賽挑選用）
        o.teams = m;
        this.playerTeam = [...m.mine];
        this.playerLoadouts = structuredClone(m.loadouts);
        this.setArena(ARENAS[m.arena]);
        break;
      case 'battle':
        this.startOnlineRound(m);
        break;
      case 'launched':
        this.onlineLaunched(m);
        break;
      case 'snap':
        this.onlineSnap(m);
        break;
      case 'round':
        o.score = m.score;
        if (this.match) this.match.score = [m.score[0], m.score[1]];
        break;
      case 'overtime':
        this.enterOnlineOvertime();
        break;
      case 'result':
        this.onlineResult(m);
        break;
      case 'paused':
        o.pausedUntil = o.toLocal(m.until);
        break;
      case 'resumed':
        o.pausedUntil = null;
        this.hud.hideNetOverlay();
        break;
      case 'closed':
        o.net.close();
        this.online = null;
        this.enterOnline('', tr('online.closed', { reason: serverReason(m.reason) }));
        break;
      case 'error': {
        // 伺服器的訊息是中文：英文版依錯誤碼換成英文
        const text = serverError(m.code, m.message);
        if (m.code === 'RESUME_FAILED') {
          o.net.close();
          this.online = null;
          this.enterOnline('', text);
        } else if (this.state === 'online') {
          this.hud.setOnlineBusy(false);
          this.hud.setOnlineMessage(text, true);
        } else this.hud.banner(tr('banner.error'), text, { small: true, seconds: 2 });
        break;
      }
      default:
        break;
    }
  }

  /** 房間狀態：等人、組隊（對手狀態與房主選的場地）、結果畫面（再來一場） */
  private onLobby(m: Msg<'lobby'>): void {
    const o = this.online!;
    o.lobby = m;
    this.oppLabel = m.opponent?.name ?? tr('opp.default');
    const op = m.opponent;
    if (m.phase === 'lobby') {
      // 還沒有對手，或對手離開了：回到房間畫面等人
      if (this.state !== 'online') this.enterOnline('', op ? '' : this.state === 'title' ? '' : tr('online.oppLeft'));
      this.hud.setOnlineRoom(o.code, o.shareLink(), this.waitingText(o));
    } else if (m.phase === 'picking') {
      if (this.state !== 'select' && this.state !== 'waiting') this.enterOnlineSelect(m);
      else {
        this.hud.updateSelectOnline(
          m.arena,
          op?.name ?? tr('opp.default'),
          tr(!op ? 'opp.left' : !op.connected ? 'opp.disconnected' : op.ready ? 'opp.picked' : 'opp.choosing'),
        );
        if (m.arena !== 'random' && this.state === 'select') this.setArena(ARENAS[m.arena]);
      }
    } else if (m.phase === 'arranging') {
      if (this.state === 'arrange') this.hud.updateArrangeOpponent(this.arrangeOpponentText(op));
    } else if (m.phase === 'result' && this.state === 'result') {
      this.hud.setResultStatus(!op ? tr('result.oppGone') : op.ready ? tr('result.oppWants', { name: op.name }) : m.me.ready ? tr('result.waitOpp') : '');
    }
  }

  /** 線上組隊第 1 步：沒有難度；客人看得到房主選的場地；選好三顆後等對手選完 */
  private enterOnlineSelect(m: Msg<'lobby'>): void {
    const o = this.online!;
    this.hud.hideOnlineLobby();
    this.hud.hideResult();
    this.hud.hideNetOverlay();
    this.setState('select');
    this.hud.hideHud();
    this.hud.clearBanner();
    this.clearArena();
    this.me = 0;
    this.rig.seat = 0;
    this.audio?.setMusic(this.musicOn, false);
    if (m.arena !== 'random') this.setArena(ARENAS[m.arena]);
    this.hud.showTeamSelect({
      specs: TOP_SPECS,
      cpuTeam: [],
      difficulty: this.difficulty.id,
      arena: m.arena,
      online: { host: o.host, opponent: m.opponent?.name ?? tr('opp.default') },
      onDifficulty: () => undefined,
      onArena: (a) => {
        if (!o.host) return;
        o.setArena(a);
        if (a !== 'random') this.setArena(ARENAS[a]);
      },
      onHover: (sp) => this.ensureShowcase()?.setSpec(sp),
      thumb: (sp, cb) => this.ensureShowcase()?.thumb(sp, cb),
      onNext: (picks) => {
        this.closeShowcase();
        o.sendPicks(picks);
        this.setState('waiting');
        this.hud.showNetOverlay(tr('net.waitPick'), tr('opp.label', { name: o.opponentName }));
      },
    });
    const op = m.opponent;
    this.hud.updateSelectOnline(m.arena, op?.name ?? tr('opp.default'), tr(op?.ready ? 'opp.picked' : 'opp.choosing'));
  }

  /**
   * 線上組隊第 2 步：雙方的三顆公開後，限時調整出場順序與零件（每次調整都同步給伺服器）；
   * 按準備完成就鎖定。雙方都準備完成或時間到，伺服器用當下的設定開打（收到 teams／battle）。
   */
  private enterOnlineArrange(m: Msg<'reveal'>): void {
    const o = this.online!;
    this.hud.hideNetOverlay();
    this.hud.hideTeamSelect();
    this.closeShowcase();
    this.setState('arrange');
    const arena = o.lobby?.arena ?? 'random';
    this.hud.showArrange({
      specs: TOP_SPECS,
      order: m.order,
      loadouts: m.loadouts,
      opponent: { label: tr('opp.label', { name: o.opponentName }), team: m.theirs, note: this.arrangeOpponentText(o.lobby?.opponent ?? null) },
      arena: arena === 'random' ? tr('arena.randomPick') : plainName(ARENAS[arena]),
      deadline: o.toLocal(m.deadline),
      readyLabel: tr('arrange.readyOnline'),
      onChange: (order, lo) => o.sendArrange(order, lo),
      onReady: (order, lo) => {
        o.sendReady(order, lo);
        this.hud.lockArrange(tr('arrange.waitOpp'));
      },
      onHover: (sp) => this.ensureShowcase()?.setSpec(sp),
      thumb: (sp, cb) => this.ensureShowcase()?.thumb(sp, cb),
    });
    if (m.ready) this.hud.lockArrange(tr('arrange.waitOpp'));
  }

  /** 第 2 步的對手狀態文字 */
  private arrangeOpponentText(op: { connected: boolean; ready: boolean } | null): string {
    return tr(!op ? 'opp.left' : !op.connected ? 'opp.disconnected' : op.ready ? 'opp.ready' : 'opp.adjusting');
  }

  /** 線上的一戰開場：座位、雙方規格與賽況由伺服器決定；倒數對齊伺服器的「ゴー」 */
  private startOnlineRound(m: Msg<'battle'>): void {
    const o = this.online!;
    o.onBattle(m);
    this.hud.hideArrange();
    this.closeShowcase();
    this.hud.hideNetOverlay();
    this.hud.hideOvertimePick();
    this.hud.hideResult();
    document.body.classList.remove('selecting');
    this.setPreview(null);
    this.me = m.seat;
    this.rig.seat = m.seat;
    const mine = m.specs[m.seat];
    const theirs = m.specs[m.seat === 0 ? 1 : 0];
    this.playerSpec = buildSpec(mine.id, mine.parts);
    this.cpuSpec = buildSpec(theirs.id, theirs.parts);
    this.match = perspectiveMatch(o.teams?.mine ?? [mine.id], o.teams?.theirs ?? [theirs.id], m.results, m.score);
    const pair: Pairing = { battle: m.battle, overtime: m.overtime, player: mine.id, cpu: theirs.id };
    this.beginRound(pair, m.replay, pair);
    // 介紹長度 = 到「ゴー」的剩餘時間 − 倒數三拍：雙方的倒數同時走到「ゴー」
    this.launchLead = Math.max(0.2, (o.toLocal(m.goAt) - Date.now()) / 1000 - (GO_AT - COUNT_START));
  }

  /** 伺服器開打：用初始狀態建立預測與畫面 */
  private onlineLaunched(m: Msg<'launched'>): void {
    const o = this.online!;
    o.onLaunched(m);
    this.clearArena();
    this.launched = true;
    this.hud.launchMeter(false);
    this.aimArrow.visible = false;
    this.sim = o.predictor!.sim;
    this.views = this.sim.tops.map((t) => new TopView(this.gfx.scene, t.spec, this.arena));
    if (this.audio) {
      this.hums = this.sim.tops.map((t, i) => this.audio!.createHum(this.world(t.pos, 0.2), i === this.me ? 1 : 0.8));
      for (const t of this.sim.tops) this.audio.launch(this.world(t.pos, 0.3));
    }
    const ratio = m.launch[this.me];
    const label = rateLabel(ratio);
    this.lastLaunch = { ratio, label, cpu: m.launch[this.me === 0 ? 1 : 0], aim: m.aim[this.me], pull: this.lastLaunch.pull };
    this.hud.banner(label, tr('rate.power', { p: Math.round(ratio * 100) }), { small: true, seconds: 1 });
    if (ratio >= 0.97) window.setTimeout(() => this.voice?.play('p_launch', 1), 900);
    this.acc = 0;
    this.setState('battle');
  }

  /** 快照：校正預測、照伺服器切換鏡頭與慢動作、播放伺服器的事件 */
  private onlineSnap(m: Msg<'snap'>): void {
    const o = this.online!;
    if (!this.sim) return;
    o.onSnap(m);
    this.bigClashPos = [];
    for (const d of m.director) {
      if (d.kind === 'closeup') {
        this.director.forceCloseup(d);
        this.bigClashPos.push(d.pos);
      } else if (d.kind === 'finish') this.director.forceFinish(d.pos);
      else this.director.notifySpecial();
    }
    for (const e of m.events) this.onEvent(e);
  }

  /** 線上對戰中每幀：送出推移、用最新快照校正、預測往前推（對手斷線暫停時凍結） */
  private stepOnline(simDt: number, wallDt: number): void {
    const o = this.online!;
    const p = o.predictor;
    if (!p) return;
    const paused = o.pausedUntil !== null;
    if (this.state === 'battle') o.input(paused ? { x: 0, z: 0 } : this.playerControl(), performance.now());
    o.flushSnap();
    if (!paused) p.advance(simDt);
    p.decay(wallDt);
  }

  /** 畫面用的陀螺狀態：線上時位置加上預測校正的畫面偏移 */
  private renderState(t: TopState, seat: 0 | 1): TopState {
    const p = this.online?.predictor;
    return p ? { ...t, pos: p.renderPos(seat) } : t;
  }

  /** 線上延長賽：從自己的隊伍挑一顆，雙方都挑完才開打 */
  private enterOnlineOvertime(): void {
    const o = this.online!;
    this.setState('overtime');
    this.clearArena();
    this.hud.clearBanner();
    this.hud.hideHud();
    this.audio?.setMusic(this.musicOn, false);
    this.voice?.play('overtime', 2);
    const team = (o.teams?.mine ?? this.playerTeam).map((t) => this.playerSpecOf(t));
    this.hud.showOvertimePick(
      team,
      (t) => this.setPreview(this.playerSpecOf(t)),
      (t) => {
        this.setPreview(null);
        o.sendOvertime(t);
        this.setState('waiting');
        this.hud.showNetOverlay(tr('net.waitOvertime'));
      },
    );
  }

  /** 線上比賽結束：結果畫面（再來一場要雙方都按；可以離開） */
  private onlineResult(m: Msg<'result'>): void {
    const o = this.online!;
    this.counters.matches++;
    this.setState('result');
    this.hud.clearBanner();
    this.hud.hideNetOverlay();
    this.hud.hideOvertimePick();
    o.pausedUntil = null;
    this.audio?.setMusic(this.musicOn, false);
    const win = m.winner === 'me';
    this.voice?.play(win ? 'winner_player' : 'winner_rival', 2);
    window.setTimeout(() => this.voice?.play(win ? 'p_win' : 'r_win', 2), 2700);
    window.setTimeout(() => this.voice?.play(win ? 'r_lose' : 'p_lose', 2), 5600);
    this.match = perspectiveMatch(o.teams?.mine ?? [], o.teams?.theirs ?? [], m.results, m.score, m.winner);
    const forfeit = m.forfeit ? tr(win ? 'result.oppForfeit' : 'result.forfeit') : '';
    this.hud.showResult(
      win,
      this.match,
      TOP_SPECS,
      tr('result.onlineFoot', { code: o.code ?? '', arena: plainName(this.arena), forfeit }),
      () => {
        o.rematch();
        this.hud.setResultStatus(tr('result.waitOpp'));
      },
      { opponent: o.opponentName, keepOpen: true, onLeave: () => this.leaveOnline() },
    );
  }

  // ---------------- 輸入 ----------------

  private onKey(e: KeyboardEvent, down: boolean): void {
    const k = e.key.toLowerCase();
    if (down) this.keys.add(k);
    else this.keys.delete(k);
    if (!down) return;
    if (k === ' ' || k === 'spacebar') {
      e.preventDefault();
      if (this.state === 'launch') this.onLaunchPress();
      else this.trySpecial();
    }
    // Shift＋方向鍵：朝推移方向衝刺（與手機快甩相同）。按一次衝一次：按住 Shift 時系統的自動重複 keydown 不算
    if (k === 'shift' && !e.repeat && this.state === 'battle') {
      const dir = this.playerControl();
      if (dir.x !== 0 || dir.z !== 0) this.dashWorld(dir);
    }
    if (k === 'enter' && this.tut?.flow.step.info) this.tut.next = true;
    if (k === 'm') {
      this.musicOn = !this.musicOn;
      this.audio?.setMusic(this.musicOn, this.state === 'battle');
    }
  }

  /** 開啟觸控模式：切換說明文字（body.touch） */
  private enableTouchMode(): void {
    if (this.touchMode) return;
    this.touchMode = true;
    document.body.classList.add('touch');
  }

  /** 玩家發動必殺技（Space、手機的必殺按鈕或三指觸控） */
  private trySpecial(): void {
    if (this.state !== 'battle' || !this.sim || this.opts.demo) return;
    if (this.online) this.online.special();
    else this.sim.useSpecial(this.me);
  }

  /** 手機快甩：螢幕方向換成相對鏡頭的世界方向後衝刺 */
  private tryDash(d: StickVector): void {
    this.dashWorld(this.screenToWorld(d.x, d.y));
  }

  /** 朝世界座標的方向衝刺（快甩與 Shift 共用） */
  private dashWorld(dir: V2): void {
    if (this.state !== 'battle' || !this.sim || this.opts.demo) return;
    if (this.online) this.online.dash(dir);
    else this.sim.dash(this.me, dir);
  }

  /** 螢幕上的方向（x 往右、y 往前）換成相對鏡頭的世界方向 */
  private screenToWorld(x: number, y: number): V2 {
    const f = this.gfx.camera.getWorldDirection(new THREE.Vector3());
    const len = Math.hypot(f.x, f.z) || 1;
    const fx = f.x / len;
    const fz = f.z / len;
    // 右方向 = 前方向順時針轉 90°
    return { x: -fz * x + fx * y, z: fx * x + fz * y };
  }

  /** 方向鍵與觸控滑動換算成「相對鏡頭」的推移方向 */
  private playerControl(): V2 {
    let x = 0;
    let y = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) y += 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) y -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
    x += this.touch.vector.x;
    y += this.touch.vector.y;
    if (x === 0 && y === 0) return { x: 0, z: 0 };
    return this.screenToWorld(x, y);
  }

  // ---------------- 每幀 ----------------

  private frame(): void {
    const now = performance.now();
    const wallDt = this.paused ? 0 : Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.frames++;
    this.clock += wallDt;
    this.stateTime += wallDt;
    // 教學：發射的解說講完前停在開場介紹，不開始倒數（也不接受拉條與 Space）
    if (this.tut && this.state === 'launch' && this.clock < this.tut.holdUntil) this.stateTime = Math.min(this.stateTime, this.launchLead - 0.05);

    this.director.update(wallDt);
    if (this.cutinLeft > 0) {
      this.cutinLeft -= wallDt;
      if (this.cutinLeft <= 0) this.hud.hideCutin();
    }
    const battleLike = this.state === 'battle' || this.state === 'roundEnd';
    // 時間流速：撞擊特寫、終結鏡頭與必殺 cut-in 凍結都由導演決定（線上對戰時伺服器用同一份邏輯）
    const ts = battleLike ? this.director.timeScale : 1;
    const simDt = wallDt * ts;

    if (this.state === 'launch') this.updateLaunch();
    if (battleLike && this.sim) {
      if (this.online) this.stepOnline(simDt, wallDt);
      else this.stepSim(simDt);
    }
    if (this.online?.pausedUntil) {
      const left = Math.max(0, Math.ceil((this.online.pausedUntil - Date.now()) / 1000));
      this.hud.showNetOverlay(tr('net.oppDropped', { name: this.oppLabel }), tr('net.oppDropSub', { n: left }));
    }

    // 試驗模式的電腦自動對打（沒有 Worker 時的退路）：每幀最多算約 12 毫秒（至少一場）；打完顯示結果
    if (this.trialAuto && this.trialCfg) {
      const duel = this.trialAuto;
      const t0 = performance.now();
      do duel.runNext();
      while (!duel.done && performance.now() - t0 < 12);
      if (duel.done) this.finishAutoDuel(this.trialCfg, duel.summary);
      else this.hud.setTrialAuto({ progress: duel.progress });
    }

    // 特寫結束：時間恢復的音效
    if (this.lastDirectorMode === 'closeup' && this.director.mode !== 'closeup') this.audio?.slowmoOut();
    this.lastDirectorMode = this.director.mode;

    // 教學打完第一戰就停在這裡說明計分（不進下一戰）
    if (this.state === 'roundEnd' && this.stateTime > 3.6 && !this.online && !this.tut) this.afterRound();
    if (this.state === 'result' && this.opts.demo && this.stateTime > 4) {
      this.hud.hideResult();
      this.startDemoMatch();
    }
    // 展示模式的延長賽：稍等一下自動挑選
    if (this.state === 'overtime' && this.opts.demo && this.stateTime > 1.8) {
      this.hud.hideOvertimePick();
      this.pickOvertime(this.match!.player[Math.floor(this.rng() * 3)]);
    }

    // 畫面更新（雙層戰鬥盤：陀螺、特效、鏡頭都貼著中央升降後的地面）
    const tops = this.sim?.tops ?? [];
    const lift = this.liftState();
    this.effects.level = lift.level;
    this.rig.level = lift.level;
    this.views.forEach((v, i) => tops[i] && v.update(this.renderState(tops[i], i as 0 | 1), simDt, this.clock, lift.level));
    this.showcase?.update(wallDt);
    if (this.preview) {
      this.preview.state.angle += 260 * wallDt;
      this.preview.state.precession += wallDt * 3;
      this.preview.view.update(this.preview.state, wallDt, this.clock);
    }
    this.effects.update(wallDt * Math.max(ts, 0.45), wallDt);
    const shot: Shot =
      this.state === 'title' || this.state === 'online'
        ? 'title'
        : this.state === 'select' || this.state === 'arrange' || this.state === 'overtime' || this.state === 'waiting' || this.state === 'trial' || this.state === 'trialResult'
          ? 'select'
          : this.state === 'launch'
            ? 'launch'
            : 'battle';
    this.rig.update(shot, this.director, tops, wallDt);

    const excitement = this.audio?.update(wallDt) ?? 0;
    this.stadium.update(this.clock, excitement, this.sim?.time ?? this.clock, lift);
    if (this.audio) {
      this.audio.setListener(this.gfx.camera);
      this.audio.setTimeScale(ts);
      this.hums.forEach((h, i) => tops[i] && h.set(this.world(tops[i].pos, 0.25), spinRatio(tops[i]), tops[i].alive));
    }
    if (battleLike && this.sim) this.hud.updateHud(this.hudTops(this.sim.tops), this.score);
    this.updateTouch();
    this.updateTutorial(wallDt);

    this.applyPost(ts);
    this.gfx.render();
  }

  /** 以固定步長推進模擬，處理 CPU、玩家輸入與事件 */
  private stepSim(simDt: number): void {
    const sim = this.sim!;
    this.acc += simDt;
    let guard = 0;
    while (this.acc >= STEP && guard++ < 40) {
      this.acc -= STEP;
      if (this.state === 'battle') {
        const me = this.me;
        const cpu = me === 0 ? 1 : 0;
        if (this.opts.demo) {
          const ai0 = cpuThink(sim, me, this.cpuRng);
          sim.setControl(me, ai0.control);
          if (ai0.special) sim.useSpecial(me);
        } else {
          sim.setControl(me, this.playerControl());
        }
        if (this.tut?.flow.cpuPassive) {
          // 教學：對手不動也不放必殺，讓玩家專心練習
          sim.setControl(cpu, { x: 0, z: 0 });
        } else {
          const ai = cpuThink(sim, cpu, this.cpuRng, this.difficulty.cpuSpecialRate);
          sim.setControl(cpu, ai.control);
          if (ai.special) sim.useSpecial(cpu);
        }
      }
      sim.step(STEP);
      if (this.tut?.flow.guard) {
        // 教學保護：轉速與爆裂量維持在安全範圍，練習中不會停轉或爆裂
        for (const t of sim.tops) {
          if (!t.alive) continue;
          t.spin = Math.max(t.spin, t.spec.maxSpin * 0.5);
          t.burst = Math.min(t.burst, 0.5);
        }
      }
      for (const e of sim.drainEvents()) this.onEvent(e);
    }
  }

  /** 模擬事件分派 */
  private onEvent(e: SimEvent): void {
    const sim = this.sim!;
    switch (e.type) {
      case 'clash': {
        this.counters.clashes++;
        const big = this.online ? this.bigClashPos.some((p) => Math.hypot(p.x - e.pos.x, p.z - e.pos.z) < 1e-6) : this.director.notifyClash(e);
        const [a, b] = sim.tops;
        const mine = sim.tops[this.me];
        const theirs = sim.tops[this.me === 0 ? 1 : 0];
        this.effects.clash(e.pos, e.normal, e.intensity, a.spec.glow, b.spec.glow, big);
        this.views.forEach((v) => v.hit(e.normal, e.intensity));
        this.audio?.clash(this.world(e.pos, 0.25), e.intensity, big, e.sameSpin);
        const scr = this.screenOf(e.pos);
        if (big) {
          this.counters.bigClashes++;
          this.audio?.slowmoIn();
          this.voice?.play(CLASH_LINES[Math.floor(this.rng() * CLASH_LINES.length)], 0);
          const words = CLASH_WORDS[lang()].big;
          this.hud.onomatopoeia(scr.x, scr.y - 40, words[Math.floor(this.rng() * words.length)], 96, '#ff3a1a');
        } else if (e.intensity > 3.2) {
          const words = CLASH_WORDS[lang()].small;
          this.hud.onomatopoeia(scr.x, scr.y - 30, words[Math.floor(this.rng() * words.length)], 40 + e.intensity * 5, '#ff9a1a');
          if (e.intensity > 4.5 && this.rng() < 0.3) {
            const playerAhead = spinRatio(mine) >= spinRatio(theirs);
            if (playerAhead) this.voice?.play('p_hit', 0);
            else if (!this.roundFlags.taunt) {
              this.roundFlags.taunt = this.voice?.play('r_taunt', 0) ?? false;
            }
          }
        }
        if (!this.roundFlags.hurt && mine.burst > 0.7 && mine.alive) {
          this.roundFlags.hurt = true;
          this.voice?.play('p_hurt', 1);
        }
        break;
      }
      case 'wall':
        this.effects.wall(e.pos, e.intensity, sim.tops[e.id].spec.glow);
        this.audio?.wall(this.world(e.pos, 0.2), e.intensity);
        break;
      case 'hazard':
        // 場地機關：熔岩噴發（轟到陀螺時畫面震動）、濺水、撞冰柱
        this.counters.hazards++;
        this.effects.hazard(e.kind, e.pos, e.intensity);
        if (e.kind === 'erupt') {
          if (e.intensity > 0) {
            this.director.shake = Math.max(this.director.shake, 0.5);
            this.audio?.finish(this.world(e.pos, 0.2));
          } else {
            this.audio?.wall(this.world(e.pos, 0.2), 2.5);
          }
        } else {
          this.audio?.wall(this.world(e.pos, 0.2), e.kind === 'pillar' ? e.intensity : 1.2);
        }
        break;
      case 'dash':
        // 快甩衝刺：小衝擊波與發射聲
        this.counters.dashes++;
        this.effects.wall(e.pos, 2.2, sim.tops[e.id].spec.glow);
        this.audio?.launch(this.world(e.pos, 0.25));
        break;
      case 'special': {
        this.counters.specials++;
        const t = sim.tops[e.id];
        const isPlayer = e.id === this.me;
        this.hud.cutin(t.spec, isPlayer);
        this.cutinLeft = 1.5;
        this.effects.special(t.pos, t.spec.glow);
        this.audio?.special(this.world(t.pos, 0.3));
        this.voice?.play(isPlayer ? specialVoice(t.spec) : 'r_special', 1);
        if (!this.online) this.director.notifySpecial();
        this.director.shake = Math.max(this.director.shake, 0.6);
        break;
      }
      case 'finish': {
        if (this.state !== 'battle') break;
        if (this.tut?.flow.guard) {
          this.tutorialKnockedOut();
          break;
        }
        this.counters.finishes++;
        // 終結方式與勝負依模擬的判定（同一步雙方都倒下時，先處理到的這則事件不一定是輸的那一顆）
        const res = sim.result;
        const finish = res?.finish ?? e.finish;
        const loserId = res?.loser ?? e.loser;
        this.lastFinish = finish;
        if (this.trial) {
          const [p, c] = sim.tops;
          this.trial.end = { rpm: [rpmOf(p), rpmOf(c)], burst: [Math.min(1, p.burst), Math.min(1, c.burst)] };
        }
        const loser = sim.tops[loserId];
        if (!this.online) this.director.notifyFinish(e.pos);
        this.effects.finish(e.pos, loser.spec.glow);
        this.audio?.finish(this.world(e.pos, 0.3));
        const info = FINISH_TEXT[finish];
        if (res && res.winner === null) {
          this.hud.banner(tr('banner.draw'), tr('banner.drawSub'), { seconds: 2.6 });
        } else {
          const winnerIsPlayer = loserId !== this.me;
          this.hud.banner(tr(info.banner), `${winnerIsPlayer ? tr('you') : this.oppLabel} +${FINISH_POINTS[finish]}`, { blue: !winnerIsPlayer, seconds: 2.6 });
          window.setTimeout(() => this.voice?.play(info.voice, 2), 250);
        }
        this.setState('roundEnd');
        // 教學：不會進下一戰，這一戰的得分直接記上，比分與陣容小圖示馬上更新（說明計分時看得到）
        if (this.tut && res && res.winner !== null) {
          // 賽況仍標示剛打完的這一戰（記分後 currentPairing 會跳到下一戰）
          const pair = currentPairing(this.match!);
          recordResult(this.match!, res);
          this.hud.setMatchInfo(this.match!, TOP_SPECS, plainName(this.arena), pair);
        }
        break;
      }
    }
  }

  /** 回合結束後：記錄這一戰，決定下一戰、延長賽或比賽結果 */
  private afterRound(): void {
    if (this.trial) {
      this.finishTrialRound();
      return;
    }
    const m = this.match!;
    const res = this.sim?.result;
    this.counters.rounds++;
    if (res) recordResult(m, res);
    this.hud.updateHud(this.sim?.tops ?? [], m.score);
    this.hud.setMatchInfo(m, TOP_SPECS, plainName(this.arena));
    if (m.phase === 'done') this.finishMatch();
    else if (m.phase === 'overtime' && !m.overtimePick) this.enterOvertimePick();
    else this.startRound();
  }

  /** 三戰總分平手：延長賽，玩家從自己的隊伍挑一顆（CPU 此時已隨機決定） */
  private enterOvertimePick(): void {
    const m = this.match!;
    this.setState('overtime');
    this.clearArena();
    this.hud.clearBanner();
    this.hud.hideHud();
    this.audio?.setMusic(this.musicOn, false);
    this.overtimeCpu = m.cpu[Math.floor(this.rng() * m.cpu.length)];
    this.voice?.play('overtime', 2);
    if (this.opts.demo) return;
    this.hud.showOvertimePick(
      m.player.map((t) => this.playerSpecOf(t)),
      (t) => this.setPreview(this.playerSpecOf(t)),
      (t) => this.pickOvertime(t),
    );
  }

  /** 延長賽出戰的陀螺決定後開打 */
  private pickOvertime(t: TopId): void {
    this.setPreview(null);
    setOvertime(this.match!, t, this.overtimeCpu);
    this.startRound();
  }

  /** 比賽結束：結果畫面與勝負台詞 */
  private finishMatch(): void {
    const m = this.match!;
    this.counters.matches++;
    this.setState('result');
    this.hud.clearBanner();
    this.audio?.setMusic(this.musicOn, false);
    const win = m.winner === 0;
    // 主播宣布 → 勝者一句 → 敗者一句
    this.voice?.play(win ? 'winner_player' : 'winner_rival', 2);
    window.setTimeout(() => this.voice?.play(win ? 'p_win' : 'r_win', 2), 2700);
    window.setTimeout(() => this.voice?.play(win ? 'r_lose' : 'p_lose', 2), 5600);
    this.hud.showResult(win, m, TOP_SPECS, tr('result.cpuFoot', { diff: diffLabel(this.difficulty), arena: plainName(this.arena) }), () => this.enterSelect());
  }

  /**
   * 除錯用：直接把目前的對戰改成「三戰打完總分平手」並進入延長賽選擇
   * （正常對戰很難剛好打成平手，e2e 用它驗證延長賽畫面）。
   */
  debugForceOvertime(): void {
    const m = createMatch(this.playerTeam, this.cpuTeam);
    recordResult(m, { finish: 'over', loser: 1, winner: 0 });
    recordResult(m, { finish: 'spin', loser: 0, winner: 1 });
    recordResult(m, { finish: 'spin', loser: 0, winner: 1 });
    this.match = m;
    this.hud.hideCutin();
    this.enterOvertimePick();
  }

  // ---------------- 工具 ----------------

  /** HUD 用的順序：[自己, 對手] */
  private hudTops(tops: TopState[]): TopState[] {
    return this.me === 0 ? tops : [tops[1], tops[0]];
  }

  /** 雙層戰鬥盤中央的升降狀態（依對戰的模擬時間；沒在對戰、或場地沒有升降平台時為升起） */
  private liftState(): { level: number; warn: number } {
    return this.sim && this.arena.lift ? liftPhase(this.arena.lift, this.sim.time) : { level: 0, warn: 0 };
  }

  /** sim 座標轉世界座標 */
  private world(p: V2, lift: number): THREE.Vector3 {
    return new THREE.Vector3(p.x, floorHeight(Math.min(Math.hypot(p.x, p.z), this.arena.radius), this.arena, this.liftState().level) + lift, p.z);
  }

  /** sim 座標轉螢幕像素座標 */
  private screenOf(p: V2): { x: number; y: number; ndc: THREE.Vector3 } {
    const v = this.world(p, 0.3).project(this.gfx.camera);
    return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight, ndc: v };
  }

  /** 依導演狀態設定後製：特寫時放射模糊＋色差＋集中線，終結時更誇張 */
  private applyPost(ts: number): void {
    const d = this.director;
    const battleLike = this.state === 'battle' || this.state === 'roundEnd';
    const center = new THREE.Vector2(0.5, 0.5);
    let aberration = d.shake * 0.8;
    let radial = 0;
    let lines = this.director.specialFreeze > 0 ? 0.8 : 0;
    let flash = 0;
    if (battleLike && d.mode !== 'overview') {
      const s = this.screenOf(d.focus).ndc;
      center.set((s.x + 1) / 2, (s.y + 1) / 2);
      const p = d.progress;
      flash = d.impactFlash;
      if (d.mode === 'closeup') {
        aberration = 0.25 + 0.8 * (1 - p);
        radial = 0.9 * Math.max(0, 1 - p * 2.5);
        lines = Math.max(lines, 1 - p * 0.6);
      } else {
        aberration = 0.25 + 0.8 * (1 - p);
        radial = 0.6 * Math.max(0, 1 - p * 3);
        lines = Math.max(lines, 0.9 * (1 - p));
      }
    }
    this.gfx.setImpact(
      { flash, aberration, radial, lines, center, vignette: 0.35 + (ts < 0.5 ? 0.25 : 0) },
      this.clock,
      flash * 0.6 + (d.mode === 'closeup' ? 0.15 : 0),
    );
  }

  /** 觸控操作只在對戰中啟用（發射階段手指要拉發射台；展示模式不啟用），並更新畫面下方的操作提示 */
  private updateTouch(): void {
    const on = this.touchMode && !this.opts.demo && this.state === 'battle';
    this.touch.setEnabled(on);
    const hint = this.touchHint;
    hint.hidden = !on;
    const me = this.sim?.tops[this.me];
    const ready = on && !!me && me.alive && !me.specialUsed && me.special >= 1;
    // 必殺按鈕：手機對戰中、必殺集滿時才出現
    document.getElementById('special-btn')!.hidden = !ready;
    if (!on) return;
    if (hint.classList.contains('ready') !== ready) {
      hint.classList.toggle('ready', ready);
      hint.textContent = ready ? tr('touch.ready') : tr('help.tc');
    } else if (!hint.textContent) {
      hint.textContent = tr('help.tc');
    }
  }

  /** 畫面下方的觸控操作提示 */
  private get touchHint(): HTMLElement {
    return document.getElementById('touch-hint')!;
  }

  /** e2e 用的狀態快照 */
  debug() {
    return {
      state: this.state,
      frames: this.frames,
      clock: this.clock,
      round: this.round,
      score: this.score,
      match: this.match
        ? {
            phase: this.match.phase,
            battle: currentPairing(this.match)?.battle ?? null,
            overtime: currentPairing(this.match)?.overtime ?? false,
            results: this.match.results.length,
            winner: this.match.winner,
            player: this.match.player,
            cpu: this.match.cpu,
            points: this.match.results.map((r) => r.points),
          }
        : null,
      showcase: this.showcase ? { loops: this.showcase.loops, fires: this.showcase.fires } : null,
      director: { mode: this.director.mode, timeScale: this.director.timeScale, closeups: this.director.closeups, progress: this.director.progress },
      counters: { ...this.counters },
      sparks: this.effects.sparksEmitted,
      sfx: this.audio?.sfxCount ?? 0,
      cheers: this.audio?.cheerCount ?? 0,
      audioLevel: this.audio?.peakLevel ?? 0,
      audioState: this.audio?.ctx.state ?? 'none',
      voice: {
        mode: this.voice?.mode ?? 'none',
        lang: this.voice?.lang ?? lang(),
        loaded: this.voice?.loaded ?? 0,
        played: this.voice?.played ?? 0,
        last: this.voice?.last ?? null,
        guidePlayed: this.voice?.guidePlayed ?? 0,
        guideLast: this.voice?.guideLast ?? null,
      },
      tutorial: this.tut
        ? {
            step: this.tut.flow.step.id,
            index: this.tut.flow.index,
            guard: this.tut.flow.guard,
            holding: this.state === 'launch' && this.clock < this.tut.holdUntil,
            demo: this.tut.demoShown,
            pushTime: this.tut.pushTime,
          }
        : null,
      lang: lang(),
      launch: this.lastLaunch,
      difficulty: this.difficulty.id,
      lastFinish: this.lastFinish,
      arena: this.arena.id,
      arenaChoice: this.arenaChoice,
      /** 雙層戰鬥盤中央的升降狀態 */
      lift: this.liftState(),
      /** 試驗模式：目前這組設定與累計戰績、自動對打的進度（沒在跑為 null）與最近一次的結果 */
      trial: this.trial ? { key: this.trial.key, record: this.trialStore.entries[this.trial.key]?.record ?? null } : null,
      trialCfg: this.trialCfg,
      /** 自動對打的進度（沒在跑為 null）與是不是在 Worker 背景執行 */
      trialAuto: this.autoProgress ?? (this.trialAuto ? this.trialAuto.progress : null),
      trialAutoWorker: this.autoWorker !== null,
      /** 存在瀏覽器裡的試驗紀錄有幾組設定 */
      trialStored: Object.keys(this.trialStore.entries).length,
      lastAutoDuel: this.lastAutoDuel,
      pulling: this.pull !== null,
      me: this.me,
      tops: this.sim?.tops.map((t) => ({ id: t.spec.id, type: t.spec.type, spin: spinRatio(t), burst: t.burst, alive: t.alive, control: t.control, special: t.special, specialUsed: t.specialUsed })) ?? [],
      touchMode: this.touchMode,
      online: this.online
        ? {
            code: this.online.code,
            host: this.online.host,
            status: this.online.net.status,
            rtt: this.online.net.clock.rtt,
            predictor: this.online.predictor !== null,
            paused: this.online.pausedUntil !== null,
            phase: this.online.lobby?.phase ?? null,
            opponent: this.online.lobby?.opponent?.name ?? null,
            public: this.online.isPublic,
            browsing: this.online.browsing,
            roomsSeen: this.online.roomsSeen,
            rooms: this.online.rooms,
          }
        : null,
      fov: this.gfx.camera.fov,
      swipe: this.touch.vector,
      flicks: this.touch.flicks,
      loadouts: this.playerLoadouts,
      playerStats: this.playerSpec.stats,
      colors: [css(this.playerSpec.glow), css(this.cpuSpec.glow)],
    };
  }
}

/** 瞄準箭頭：平貼地面的發光箭頭（幾何沿 +x 方向） */
function buildAimArrow(): THREE.Mesh {
  const sh = new THREE.Shape();
  sh.moveTo(0, -0.05);
  sh.lineTo(1.1, -0.05);
  sh.lineTo(1.1, -0.16);
  sh.lineTo(1.45, 0);
  sh.lineTo(1.1, 0.16);
  sh.lineTo(1.1, 0.05);
  sh.lineTo(0, 0.05);
  sh.closePath();
  const geo = new THREE.ShapeGeometry(sh);
  // Shape 在 xy 平面：轉到地面（xz），箭頭仍沿 +x
  geo.rotateX(-Math.PI / 2);
  return new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color: 0xffe35a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
}
