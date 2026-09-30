import * as THREE from 'three';
import { AudioEngine, type Hum } from '../audio/engine';
import { VoicePlayer, type VoiceId } from '../audio/voice';
import { CameraDirector } from '../director/director';
import { CameraRig, type Shot } from '../render/cameraRig';
import { Effects } from '../render/effects';
import { GameRenderer } from '../render/postfx';
import { Showcase } from '../render/showcase';
import { buildLights, buildStadium, type Stadium, type StadiumLights } from '../render/stadium';
import { TopView } from '../render/topView';
import { ARENA_IDS, ARENAS, floorHeight, type ArenaId, type ArenaSpec } from '../sim/arena';
import { BattleSim } from '../sim/battle';
import { cpuThink } from '../sim/cpu';
import { createTop, spinRatio } from '../sim/physics';
import { createRng, type Rng } from '../sim/rng';
import { DIFFICULTIES, type Difficulty, type DifficultyId } from '../sim/difficulty';
import { keyLaunchRatio, measurePull, pullLaunchRatio, pullQuality, trimPullSamples, type PullMetrics, type PullSample } from '../sim/launcher';
import { FINISH_POINTS, launchSpinRatio } from '../sim/rules';
import { STOCK, type TeamLoadouts } from '../sim/parts';
import { cpuPickTeam, createMatch, currentPairing, recordResult, setOvertime, type TeamMatch } from '../sim/team';
import { buildSpec, TOP_IDS, TOP_SPECS } from '../sim/tops';
import type { FinishType, SimEvent, TopId, TopSpec, TopState, V2 } from '../sim/types';
import { css, Hud, type ArenaChoice, type CordView } from '../ui/hud';
import { SwipeControls, type StickVector } from '../ui/touch';

/** 遊戲階段 */
export type GameState = 'title' | 'select' | 'overtime' | 'launch' | 'battle' | 'roundEnd' | 'result';

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

const FINISH_TEXT: Record<FinishType, { en: string; voice: VoiceId }> = {
  spin: { en: 'SPIN FINISH!', voice: 'spin_finish' },
  over: { en: 'OVER FINISH!!', voice: 'over_finish' },
  burst: { en: 'BURST FINISH!!', voice: 'burst_finish' },
};

const CLASH_WORDS = ['ガキィン！', 'ドガッ！', 'バキィッ！', 'ガガッ！', 'ズガッ！'];
const BIG_WORDS = ['ドゴォォン！！', 'ズガァァン！！', 'ドガガガッ！！', 'バゴォォン！！'];
const CLASH_LINES: VoiceId[] = ['clash_1', 'clash_2', 'clash_3', 'clash_4'];

/** 瀏覽器記住難度與場地用的 localStorage 鍵 */
const DIFFICULTY_KEY = 'battle-tops.difficulty';
const ARENA_KEY = 'battle-tops.arena';

/** 原創四顆沿用舊的必殺語音檔（依類型命名），其餘用 p_special_<代號> */
const LEGACY_SPECIAL_VOICE: Record<string, string> = {
  blaze: 'p_special_attack',
  turtle: 'p_special_defense',
  gale: 'p_special_stamina',
  wolf: 'p_special_balance',
};

/** 必殺技台詞 id */
function specialVoice(spec: TopSpec): VoiceId {
  return (LEGACY_SPECIAL_VOICE[spec.id] ?? `p_special_${spec.id}`) as VoiceId;
}

/** 玩家陀螺的發射位置與基準初速方向（BattleSim 的開場配置，瞄準箭頭用） */
const PLAYER_START = { x: -2.1, z: 0 };
const PLAYER_LAUNCH_DIR = { x: 2.0, z: 0.7 };

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
  /** 必殺 cut-in 期間的額外慢動作（牆鐘秒） */
  private specialFreeze = 0;
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

  constructor(container: HTMLElement, opts: GameOptions) {
    this.opts = opts;
    this.difficulty = opts.demo ? DIFFICULTIES.normal : loadDifficulty();
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

    if (opts.demo) {
      document.getElementById('title')!.hidden = true;
      void this.boot().then(() => this.startDemoMatch());
    } else {
      // 不等語音下載完：選角畫面立刻出現，語音在背景載入（選角通常比下載久）
      this.hud.showTitle(() => {
        void this.boot();
        this.enterSelect();
      });
    }
    this.gfx.renderer.setAnimationLoop(() => this.frame());
  }

  /**
   * 建立音訊並開始在背景載入語音；回傳的 Promise 在語音載入完成時結束。
   * 瀏覽器在使用者操作前不允許出聲：沒有手勢時 resume() 會一直等待，
   * 所以不 await；若仍是暫停狀態就顯示「點擊開啟聲音」，等下一次點擊或按鍵再恢復。
   */
  private boot(): Promise<void> {
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
    this.audio.startCrowd();
    this.audio.setMusic(this.musicOn, false);
    return this.voice.load();
  }

  /** 目前總分 [玩家, CPU] */
  get score(): [number, number] {
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

  /** 組隊畫面：CPU 先組好（公開三顆、順序保密），玩家從全部陀螺挑三顆，並選難度與場地 */
  private enterSelect(): void {
    this.setState('select');
    this.hud.hideHud();
    this.hud.clearBanner();
    this.clearArena();
    this.audio?.setMusic(this.musicOn, false);
    this.cpuTeam = cpuPickTeam(this.rng);
    this.hud.showTeamSelect({
      specs: TOP_SPECS,
      cpuTeam: this.cpuTeam,
      difficulty: this.difficulty.id,
      arena: this.arenaChoice,
      onDifficulty: (d) => this.setDifficulty(d),
      onArena: (a) => this.chooseArena(a),
      // 外觀與絕招示範在詳細資料的舞台窗裡播放；主場景的場地中央不再放預覽陀螺（會被名鑑擋住）
      onHover: (sp) => this.ensureShowcase()?.setSpec(sp),
      thumb: (sp, cb) => this.ensureShowcase()?.thumb(sp, cb),
      onConfirm: (team, loadouts) => {
        this.playerTeam = team;
        this.playerLoadouts = loadouts;
        this.setPreview(null);
        this.closeShowcase();
        this.startMatch();
      },
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

  // ---------------- 比賽流程 ----------------

  /** 開始一場 3 對 3：隨機場地在這時抽出，整場（含延長賽）都用同一個場地 */
  private startMatch(): void {
    const choice = this.arenaChoice;
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
    this.clearArena();
    this.round++;
    this.director.reset();
    this.launchBeat = 0;
    this.launchPress = null;
    this.launched = false;
    this.specialFreeze = 0;
    this.roundFlags = { hurt: false, taunt: false };
    this.audio?.setMusic(this.musicOn, true);
    this.hud.showHud(this.playerSpec, this.cpuSpec);
    this.hud.setMatchInfo(m, TOP_SPECS, this.arena.nameZh);
    this.hud.updateHud(
      [createTop(0, this.playerSpec, { x: 0, z: 0 }, { x: 0, z: 0 }, 1), createTop(1, this.cpuSpec, { x: 0, z: 0 }, { x: 0, z: 0 }, 1)],
      m.score,
    );
    this.pull = null;
    this.pullResult = null;
    this.setState('launch');
    const title = pair.overtime ? 'OVERTIME' : pair.battle === 3 ? 'FINAL BATTLE' : `BATTLE ${pair.battle}`;
    this.hud.banner(title, `${this.playerSpec.nameJa}  VS  ${this.cpuSpec.nameJa}${replay ? '（再戦）' : ''}
＠${this.arena.nameZh}`, {
      small: true,
      seconds: 0,
    });
    const line: VoiceId = replay ? 'round_ready' : pair.overtime || pair.battle === 3 ? 'battle_final' : pair.battle === 1 ? 'battle_1' : 'battle_2';
    const spoke = this.voice?.play(line, 2) ?? false;
    // 主播講完才開始倒數，避免「スリー」蓋掉開場介紹
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
        this.hud.banner('ゴー・シュート!!', '', { seconds: 0.9 });
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
    const d = { x: -PLAYER_LAUNCH_DIR.z, z: PLAYER_LAUNCH_DIR.x };
    const sign = d.x * right.x + d.z * right.z >= 0 ? 1 : -1;
    return screenAim * sign;
  }

  /** 拉條時在玩家發射位置顯示瞄準箭頭 */
  private updateAimArrow(): void {
    const view = this.cordView();
    this.aimArrow.visible = view !== null && view.power > 0.02;
    if (!view) return;
    const a = Math.atan2(PLAYER_LAUNCH_DIR.z, PLAYER_LAUNCH_DIR.x) + this.worldAim(view.aim);
    const r = Math.hypot(PLAYER_START.x, PLAYER_START.z);
    this.aimArrow.position.set(PLAYER_START.x, floorHeight(r, this.arena) + 0.05, PLAYER_START.z);
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
    const d = this.difficulty;
    const timing = launchSpinRatio(error, d.launch);
    const pull = this.pullResult;
    const ratio = this.opts.demo ? timing : pull ? pullLaunchRatio(timing, pull, d.pullBase) : keyLaunchRatio(timing);
    const aim = this.opts.demo ? (this.rng() - 0.5) * 0.6 : pull ? this.worldAim(pull.aim) : 0;
    const cpuAim = (this.rng() - 0.5) * 0.7;
    const cpuRatio = d.cpuLaunch[0] + this.rng() * (d.cpuLaunch[1] - d.cpuLaunch[0]);
    const label = ratio >= 0.97 ? 'PERFECT!!' : ratio >= 0.85 ? 'GREAT!' : ratio >= 0.7 ? 'GOOD' : 'WEAK…';
    this.lastLaunch = { ratio, label, cpu: cpuRatio, aim, pull };
    this.sim = new BattleSim(this.playerSpec, this.cpuSpec, {
      seed: Math.floor(this.rng() * 1e9),
      launch: [ratio, cpuRatio],
      arena: this.arena,
      aim: [aim, cpuAim],
    });
    this.views = this.sim.tops.map((t) => new TopView(this.gfx.scene, t.spec, this.arena));
    if (this.audio) {
      this.hums = this.sim.tops.map((t, i) => this.audio!.createHum(this.world(t.pos, 0.2), i === 0 ? 1 : 0.8));
      for (const t of this.sim.tops) this.audio.launch(this.world(t.pos, 0.3));
    }
    this.hud.banner(label, `${Math.round(ratio * 100)}% POWER`, { small: true, seconds: 1 });
    if (ratio >= 0.97) window.setTimeout(() => this.voice?.play('p_launch', 1), 900);
    this.acc = 0;
    this.setState('battle');
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

  /** 玩家發動必殺技（Space 或觸控按鈕） */
  private trySpecial(): void {
    if (this.state === 'battle' && this.sim && !this.opts.demo) this.sim.useSpecial(0);
  }

  /** 手機快甩：螢幕方向換成相對鏡頭的世界方向後衝刺 */
  private tryDash(d: StickVector): void {
    if (this.state !== 'battle' || !this.sim || this.opts.demo) return;
    this.sim.dash(0, this.screenToWorld(d.x, d.y));
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

    this.director.update(wallDt);
    if (this.specialFreeze > 0) this.specialFreeze -= wallDt;
    if (this.cutinLeft > 0) {
      this.cutinLeft -= wallDt;
      if (this.cutinLeft <= 0) this.hud.hideCutin();
    }
    const battleLike = this.state === 'battle' || this.state === 'roundEnd';
    const ts = battleLike ? this.director.timeScale * (this.specialFreeze > 0 ? 0.12 : 1) : 1;
    const simDt = wallDt * ts;

    if (this.state === 'launch') this.updateLaunch();
    if (battleLike && this.sim) this.stepSim(simDt);

    // 特寫結束：時間恢復的音效
    if (this.lastDirectorMode === 'closeup' && this.director.mode !== 'closeup') this.audio?.slowmoOut();
    this.lastDirectorMode = this.director.mode;

    if (this.state === 'roundEnd' && this.stateTime > 3.6) this.afterRound();
    if (this.state === 'result' && this.opts.demo && this.stateTime > 4) {
      this.hud.hideResult();
      this.startDemoMatch();
    }
    // 展示模式的延長賽：稍等一下自動挑選
    if (this.state === 'overtime' && this.opts.demo && this.stateTime > 1.8) {
      this.hud.hideOvertimePick();
      this.pickOvertime(this.match!.player[Math.floor(this.rng() * 3)]);
    }

    // 畫面更新
    const tops = this.sim?.tops ?? [];
    this.views.forEach((v, i) => tops[i] && v.update(tops[i], simDt, this.clock));
    this.showcase?.update(wallDt);
    if (this.preview) {
      this.preview.state.angle += 260 * wallDt;
      this.preview.state.precession += wallDt * 3;
      this.preview.view.update(this.preview.state, wallDt, this.clock);
    }
    this.effects.update(wallDt * Math.max(ts, 0.45), wallDt);
    const shot: Shot =
      this.state === 'title' ? 'title' : this.state === 'select' || this.state === 'overtime' ? 'select' : this.state === 'launch' ? 'launch' : 'battle';
    this.rig.update(shot, this.director, tops, wallDt);

    const excitement = this.audio?.update(wallDt) ?? 0;
    this.stadium.update(this.clock, excitement, this.sim?.time ?? this.clock);
    if (this.audio) {
      this.audio.setListener(this.gfx.camera);
      this.audio.setTimeScale(ts);
      this.hums.forEach((h, i) => tops[i] && h.set(this.world(tops[i].pos, 0.25), spinRatio(tops[i]), tops[i].alive));
    }
    if (battleLike && this.sim) this.hud.updateHud(this.sim.tops, this.score);
    this.updateTouch();

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
        if (this.opts.demo) {
          const ai0 = cpuThink(sim, 0, this.cpuRng);
          sim.setControl(0, ai0.control);
          if (ai0.special) sim.useSpecial(0);
        } else {
          sim.setControl(0, this.playerControl());
        }
        const ai = cpuThink(sim, 1, this.cpuRng, this.difficulty.cpuSpecialRate);
        sim.setControl(1, ai.control);
        if (ai.special) sim.useSpecial(1);
      }
      sim.step(STEP);
      for (const e of sim.drainEvents()) this.onEvent(e);
    }
  }

  /** 模擬事件分派 */
  private onEvent(e: SimEvent): void {
    const sim = this.sim!;
    switch (e.type) {
      case 'clash': {
        this.counters.clashes++;
        const big = this.director.notifyClash(e);
        const [a, b] = sim.tops;
        this.effects.clash(e.pos, e.normal, e.intensity, a.spec.glow, b.spec.glow, big);
        this.views.forEach((v) => v.hit(e.normal, e.intensity));
        this.audio?.clash(this.world(e.pos, 0.25), e.intensity, big, e.sameSpin);
        const scr = this.screenOf(e.pos);
        if (big) {
          this.counters.bigClashes++;
          this.audio?.slowmoIn();
          this.voice?.play(CLASH_LINES[Math.floor(this.rng() * CLASH_LINES.length)], 0);
          this.hud.onomatopoeia(scr.x, scr.y - 40, BIG_WORDS[Math.floor(this.rng() * BIG_WORDS.length)], 96, '#ff3a1a');
        } else if (e.intensity > 3.2) {
          this.hud.onomatopoeia(scr.x, scr.y - 30, CLASH_WORDS[Math.floor(this.rng() * CLASH_WORDS.length)], 40 + e.intensity * 5, '#ff9a1a');
          if (e.intensity > 4.5 && this.rng() < 0.3) {
            const playerAhead = spinRatio(a) >= spinRatio(b);
            if (playerAhead) this.voice?.play('p_hit', 0);
            else if (!this.roundFlags.taunt) {
              this.roundFlags.taunt = this.voice?.play('r_taunt', 0) ?? false;
            }
          }
        }
        if (!this.roundFlags.hurt && a.burst > 0.7 && a.alive) {
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
        const isPlayer = e.id === 0;
        this.hud.cutin(t.spec, isPlayer);
        this.cutinLeft = 1.5;
        this.effects.special(t.pos, t.spec.glow);
        this.audio?.special(this.world(t.pos, 0.3));
        this.voice?.play(isPlayer ? specialVoice(t.spec) : 'r_special', 1);
        this.specialFreeze = 1.1;
        this.director.shake = Math.max(this.director.shake, 0.6);
        break;
      }
      case 'finish': {
        if (this.state !== 'battle') break;
        this.counters.finishes++;
        this.lastFinish = e.finish;
        const loser = sim.tops[e.loser];
        this.director.notifyFinish(e.pos);
        this.effects.finish(e.pos, loser.spec.glow);
        this.audio?.finish(this.world(e.pos, 0.3));
        const res = sim.result;
        const info = FINISH_TEXT[e.finish];
        if (res && res.winner === null) {
          this.hud.banner('DRAW', '引き分け！もう一度！', { seconds: 2.6 });
        } else {
          const winnerIsPlayer = e.loser === 1;
          this.hud.banner(info.en, `${winnerIsPlayer ? 'YOU' : 'CPU'} +${FINISH_POINTS[e.finish]}`, { blue: !winnerIsPlayer, seconds: 2.6 });
          window.setTimeout(() => this.voice?.play(info.voice, 2), 250);
        }
        this.setState('roundEnd');
        break;
      }
    }
  }

  /** 回合結束後：記錄這一戰，決定下一戰、延長賽或比賽結果 */
  private afterRound(): void {
    const m = this.match!;
    const res = this.sim?.result;
    this.counters.rounds++;
    if (res) recordResult(m, res);
    this.hud.updateHud(this.sim?.tops ?? [], m.score);
    this.hud.setMatchInfo(m, TOP_SPECS, this.arena.nameZh);
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
    this.hud.showResult(win, m, TOP_SPECS, `難易度：${this.difficulty.labelZh}・場地：${this.arena.nameZh}`, () => this.enterSelect());
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

  /** sim 座標轉世界座標 */
  private world(p: V2, lift: number): THREE.Vector3 {
    return new THREE.Vector3(p.x, floorHeight(Math.min(Math.hypot(p.x, p.z), this.arena.radius), this.arena) + lift, p.z);
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
    let lines = this.specialFreeze > 0 ? 0.8 : 0;
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
    if (!on) return;
    const me = this.sim?.tops[0];
    const ready = !!me && me.alive && !me.specialUsed && me.special >= 1;
    if (hint.classList.contains('ready') !== ready) {
      hint.classList.toggle('ready', ready);
      hint.textContent = ready ? '必殺 READY！三指觸控發動' : '滑動：推移　快甩：衝刺　三指：必殺';
    } else if (!hint.textContent) {
      hint.textContent = '滑動：推移　快甩：衝刺　三指：必殺';
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
      audioLevel: this.audio?.peakLevel ?? 0,
      audioState: this.audio?.ctx.state ?? 'none',
      voice: { mode: this.voice?.mode ?? 'none', played: this.voice?.played ?? 0, last: this.voice?.last ?? null },
      launch: this.lastLaunch,
      difficulty: this.difficulty.id,
      lastFinish: this.lastFinish,
      arena: this.arena.id,
      arenaChoice: this.arenaChoice,
      pulling: this.pull !== null,
      tops: this.sim?.tops.map((t) => ({ type: t.spec.type, spin: spinRatio(t), burst: t.burst, alive: t.alive, control: t.control })) ?? [],
      touchMode: this.touchMode,
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
