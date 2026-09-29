import * as THREE from 'three';
import { AudioEngine, type Hum } from '../audio/engine';
import { VoicePlayer, type VoiceId } from '../audio/voice';
import { CameraDirector } from '../director/director';
import { CameraRig, type Shot } from '../render/cameraRig';
import { Effects } from '../render/effects';
import { GameRenderer } from '../render/postfx';
import { buildStadium, type Stadium } from '../render/stadium';
import { TopView } from '../render/topView';
import { floorHeight } from '../sim/arena';
import { BattleSim } from '../sim/battle';
import { cpuThink } from '../sim/cpu';
import { createTop, spinRatio } from '../sim/physics';
import { createRng, type Rng } from '../sim/rng';
import { awardFinish, FINISH_POINTS, launchSpinRatio, matchWinner } from '../sim/rules';
import { TOP_SPECS, TOP_TYPES } from '../sim/tops';
import type { FinishType, SimEvent, TopSpec, TopState, TopType, V2 } from '../sim/types';
import { css, Hud } from '../ui/hud';

/** 遊戲階段 */
export type GameState = 'title' | 'select' | 'launch' | 'battle' | 'roundEnd' | 'result';

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
  /** 指定雙方陀螺（展示模式用） */
  player?: TopType;
  cpu?: TopType;
}

const FINISH_TEXT: Record<FinishType, { en: string; voice: VoiceId }> = {
  spin: { en: 'SPIN FINISH!', voice: 'spin_finish' },
  over: { en: 'OVER FINISH!!', voice: 'over_finish' },
  burst: { en: 'BURST FINISH!!', voice: 'burst_finish' },
};

const CLASH_WORDS = ['ガキィン！', 'ドガッ！', 'バキィッ！', 'ガガッ！', 'ズガッ！'];
const BIG_WORDS = ['ドゴォォン！！', 'ズガァァン！！', 'ドガガガッ！！', 'バゴォォン！！'];
const CLASH_LINES: VoiceId[] = ['clash_1', 'clash_2', 'clash_3', 'clash_4'];

/**
 * 遊戲主體：狀態機（標題 → 選角 → 倒數發射 → 對戰 → 回合結束 → 結果）與每幀迴圈。
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
  score: [number, number] = [0, 0];
  round = 0;
  /** e2e 觀察用的累計數字 */
  readonly counters = { clashes: 0, bigClashes: 0, finishes: 0, specials: 0, rounds: 0, matches: 0 };
  /** 最近一次發射的評價與轉速比例 */
  lastLaunch = { ratio: 0, label: '' };
  /** 最近一次終結方式（e2e 觀察用） */
  lastFinish: FinishType | null = null;

  private readonly opts: GameOptions;
  private readonly rig: CameraRig;
  private readonly stadium: Stadium;
  private readonly rng: Rng;
  private readonly keys = new Set<string>();
  private views: TopView[] = [];
  private hums: Hum[] = [];
  private preview: { view: TopView; state: TopState } | null = null;
  private playerSpec: TopSpec = TOP_SPECS.attack;
  private cpuSpec: TopSpec = TOP_SPECS.defense;
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
  private roundFlags = { hurt: false, taunt: false, matchPointSaid: false };
  /** 除錯暫停：畫面照常渲染，但時間不前進（e2e 定格截圖用） */
  paused = false;
  /** 已渲染的影格數 */
  frames = 0;

  constructor(container: HTMLElement, opts: GameOptions) {
    this.opts = opts;
    this.rng = createRng(opts.seed);
    this.cpuRng = createRng(opts.seed * 31 + 7);
    this.gfx = new GameRenderer(container);
    this.stadium = buildStadium(this.gfx.scene);
    this.effects = new Effects(this.gfx.scene);
    this.rig = new CameraRig(this.gfx.camera);

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('pointerdown', () => this.onLaunchPress());
    window.addEventListener('blur', () => this.keys.clear());

    if (opts.demo) {
      document.getElementById('title')!.hidden = true;
      void this.boot().then(() => {
        this.playerSpec = TOP_SPECS[opts.player ?? TOP_TYPES[Math.floor(this.rng() * 4)]];
        this.cpuSpec = TOP_SPECS[opts.cpu ?? this.pickCpu(this.playerSpec.type)];
        this.startMatch();
      });
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
          window.removeEventListener('pointerdown', unlock);
          window.removeEventListener('keydown', unlock);
        }
      });
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    audio.ctx.addEventListener('statechange', () => (hint.hidden = audio.ctx.state === 'running'));
    // 給瀏覽器一點時間套用剛才的手勢，仍是暫停才顯示提示
    window.setTimeout(() => (hint.hidden = audio.ctx.state === 'running'), 300);
    this.voice = new VoicePlayer(this.audio);
    this.audio.startCrowd();
    this.audio.setMusic(this.musicOn, false);
    return this.voice.load();
  }

  /** CPU 選一個和玩家不同類型的陀螺 */
  private pickCpu(player: TopType): TopType {
    const others = TOP_TYPES.filter((t) => t !== player);
    return others[Math.floor(this.rng() * others.length)];
  }

  private setState(s: GameState): void {
    this.state = s;
    this.stateTime = 0;
  }

  // ---------------- 選角 ----------------

  private enterSelect(): void {
    this.setState('select');
    this.hud.hideHud();
    this.hud.clearBanner();
    this.clearArena();
    this.audio?.setMusic(this.musicOn, false);
    this.hud.showSelect(
      TOP_SPECS,
      this.playerSpec.type,
      (t) => this.setPreview(TOP_SPECS[t]),
      (t) => {
        this.playerSpec = TOP_SPECS[t];
        this.cpuSpec = TOP_SPECS[this.pickCpu(t)];
        this.setPreview(null);
        this.startMatch();
      },
    );
  }

  /** 選角時在場地中央轉的預覽陀螺 */
  private setPreview(spec: TopSpec | null): void {
    if (this.preview) this.preview.view.dispose();
    this.preview = null;
    if (!spec) return;
    const state = createTop(0, spec, { x: 0, z: 0 }, { x: 0, z: 0 }, 1, 1);
    this.preview = { view: new TopView(this.gfx.scene, spec), state };
  }

  // ---------------- 比賽流程 ----------------

  private startMatch(): void {
    this.score = [0, 0];
    this.round = 0;
    this.hud.hideResult();
    this.hud.showHud(this.playerSpec, this.cpuSpec);
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

  /** 新回合：進入倒數發射 */
  private startRound(): void {
    this.clearArena();
    this.round++;
    this.director.reset();
    this.launchBeat = 0;
    this.launchPress = null;
    this.launched = false;
    this.specialFreeze = 0;
    this.roundFlags = { hurt: false, taunt: false, matchPointSaid: false };
    this.audio?.setMusic(this.musicOn, true);
    this.hud.updateHud(
      [createTop(0, this.playerSpec, { x: 0, z: 0 }, { x: 0, z: 0 }, 1, 1), createTop(1, this.cpuSpec, { x: 0, z: 0 }, { x: 0, z: 0 }, 1, 1)],
      this.score,
    );
    this.setState('launch');
    const mp = this.score[0] === 2 || this.score[1] === 2;
    this.hud.banner(`ROUND ${this.round}`, mp ? 'マッチポイント！' : 'スタンバイ…', { small: true, seconds: 0.6 });
    if (this.round > 1) this.voice?.play(mp ? 'match_point' : 'round_ready', 2);
  }

  /** 倒數與發射（每幀） */
  private updateLaunch(): void {
    const t = this.stateTime;
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
    this.hud.launchMeter(!this.opts.demo && !this.launched, progress);

    // 展示模式：自動在 GO 附近按下
    if (this.opts.demo && this.launchPress === null && t >= GO_AT - 0.03) this.launchPress = t + (this.rng() - 0.5) * 0.12;

    const press = this.launchPress;
    const late = t > GO_AT + 0.4;
    if (!this.launched && ((press !== null && t >= Math.max(GO_AT, press)) || late)) {
      this.launch(press === null ? 1 : press - GO_AT);
    }
  }

  /** 玩家按下發射（Space 或點擊）：只接受「1」之後的輸入 */
  private onLaunchPress(): void {
    if (this.state !== 'launch' || this.launched || this.launchPress !== null) return;
    if (this.stateTime < COUNT_START + BEAT * 2) return;
    this.launchPress = this.stateTime;
  }

  /** 發射：依時機誤差決定轉速，建立模擬與畫面 */
  private launch(error: number): void {
    this.launched = true;
    this.hud.launchMeter(false);
    const ratio = launchSpinRatio(error);
    const cpuRatio = 0.72 + this.rng() * 0.26;
    const label = ratio >= 0.97 ? 'PERFECT!!' : ratio >= 0.85 ? 'GREAT!' : ratio >= 0.7 ? 'GOOD' : 'WEAK…';
    this.lastLaunch = { ratio, label };
    this.sim = new BattleSim(this.playerSpec, this.cpuSpec, {
      seed: Math.floor(this.rng() * 1e9),
      launch: [ratio, cpuRatio],
    });
    this.views = this.sim.tops.map((t) => new TopView(this.gfx.scene, t.spec));
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
      else if (this.state === 'battle' && this.sim && !this.opts.demo) this.sim.useSpecial(0);
    }
    if (k === 'm') {
      this.musicOn = !this.musicOn;
      this.audio?.setMusic(this.musicOn, this.state === 'battle');
    }
  }

  /** 方向鍵換算成「相對鏡頭」的推移方向 */
  private playerControl(): V2 {
    let x = 0;
    let y = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) y += 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) y -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
    if (x === 0 && y === 0) return { x: 0, z: 0 };
    const f = this.gfx.camera.getWorldDirection(new THREE.Vector3());
    const len = Math.hypot(f.x, f.z) || 1;
    const fx = f.x / len;
    const fz = f.z / len;
    // 右方向 = 前方向順時針轉 90°
    return { x: -fz * x + fx * y, z: fx * x + fz * y };
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
      this.startMatch();
    }

    // 畫面更新
    const tops = this.sim?.tops ?? [];
    this.views.forEach((v, i) => tops[i] && v.update(tops[i], simDt, this.clock));
    if (this.preview) {
      this.preview.state.angle += 260 * wallDt;
      this.preview.state.precession += wallDt * 3;
      this.preview.view.update(this.preview.state, wallDt, this.clock);
    }
    this.effects.update(wallDt * Math.max(ts, 0.45), wallDt);
    const shot: Shot = this.state === 'title' ? 'title' : this.state === 'select' ? 'select' : this.state === 'launch' ? 'launch' : 'battle';
    this.rig.update(shot, this.director, tops, wallDt);

    const excitement = this.audio?.update(wallDt) ?? 0;
    this.stadium.update(this.clock, excitement);
    if (this.audio) {
      this.audio.setListener(this.gfx.camera);
      this.audio.setTimeScale(ts);
      this.hums.forEach((h, i) => tops[i] && h.set(this.world(tops[i].pos, 0.25), spinRatio(tops[i]), tops[i].alive));
    }
    if (battleLike && this.sim) this.hud.updateHud(this.sim.tops, this.score);

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
        const ai = cpuThink(sim, 1, this.cpuRng);
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
      case 'special': {
        this.counters.specials++;
        const t = sim.tops[e.id];
        const isPlayer = e.id === 0;
        this.hud.cutin(t.spec, isPlayer);
        this.cutinLeft = 1.5;
        this.effects.special(t.pos, t.spec.glow);
        this.audio?.special(this.world(t.pos, 0.3));
        this.voice?.play(isPlayer ? (`p_special_${t.spec.type}` as VoiceId) : 'r_special', 1);
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

  /** 回合結束後：計分，決定下一回合或比賽結果 */
  private afterRound(): void {
    const res = this.sim?.result;
    this.counters.rounds++;
    if (res && res.winner !== null) this.score = awardFinish(this.score, res.loser, res.finish);
    this.hud.updateHud(this.sim?.tops ?? [], this.score);
    const w = matchWinner(this.score);
    if (w === null) {
      this.startRound();
      return;
    }
    this.counters.matches++;
    this.setState('result');
    this.hud.clearBanner();
    this.audio?.setMusic(this.musicOn, false);
    const win = w === 0;
    // 主播宣布 → 勝者一句 → 敗者一句
    this.voice?.play(win ? 'winner_player' : 'winner_rival', 2);
    window.setTimeout(() => this.voice?.play(win ? 'p_win' : 'r_win', 2), 2700);
    window.setTimeout(() => this.voice?.play(win ? 'r_lose' : 'p_lose', 2), 5600);
    this.hud.showResult(win, this.score, () => this.enterSelect());
  }

  // ---------------- 工具 ----------------

  /** sim 座標轉世界座標 */
  private world(p: V2, lift: number): THREE.Vector3 {
    return new THREE.Vector3(p.x, floorHeight(Math.min(Math.hypot(p.x, p.z), 3.2)) + lift, p.z);
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

  /** e2e 用的狀態快照 */
  debug() {
    return {
      state: this.state,
      frames: this.frames,
      clock: this.clock,
      round: this.round,
      score: this.score,
      director: { mode: this.director.mode, timeScale: this.director.timeScale, closeups: this.director.closeups, progress: this.director.progress },
      counters: { ...this.counters },
      sparks: this.effects.sparksEmitted,
      sfx: this.audio?.sfxCount ?? 0,
      audioLevel: this.audio?.peakLevel ?? 0,
      audioState: this.audio?.ctx.state ?? 'none',
      voice: { mode: this.voice?.mode ?? 'none', played: this.voice?.played ?? 0, last: this.voice?.last ?? null },
      launch: this.lastLaunch,
      lastFinish: this.lastFinish,
      tops: this.sim?.tops.map((t) => ({ type: t.spec.type, spin: spinRatio(t), burst: t.burst, alive: t.alive })) ?? [],
      colors: [css(this.playerSpec.glow), css(this.cpuSpec.glow)],
    };
  }
}
