import { ARENAS, type ArenaId, type ArenaSpec } from './arena';
import { BattleSim } from './battle';
import { cpuThink } from './cpu';
import { DIFFICULTIES, type DifficultyId } from './difficulty';
import type { Loadout } from './parts';
import { createRng } from './rng';
import { buildSpec } from './tops';
import type { FinishType, RoundResult, TopId, TopSpec } from './types';

/**
 * 試驗模式（一對一，自己指定雙方的陀螺與零件，用來比較搭配的效果）的純邏輯：
 * 設定的 key、同一組設定的累計戰績，以及「電腦自動對打 N 場」（兩邊都交給 CPU、交換座位各半）。
 */

/** 一邊的陀螺與零件 */
export interface TrialSide {
  top: TopId;
  loadout: Loadout;
}

/** 試驗的設定：你的陀螺、電腦的陀螺、場地與難度（難度決定發射判定與電腦的發射力道、必殺頻率） */
export interface TrialConfig {
  player: TrialSide;
  cpu: TrialSide;
  arena: ArenaId;
  difficulty: DifficultyId;
}

/** 同一組設定的 key（換了任何一項就是新的一組，累計戰績重新算） */
export function trialKey(c: TrialConfig): string {
  const side = (s: TrialSide) => `${s.top}:${s.loadout.disk ?? '-'}:${s.loadout.driver ?? '-'}`;
  return `${side(c.player)}|${side(c.cpu)}|${c.arena}|${c.difficulty}`;
}

/** 終結方式的統計：每一種 [你的陀螺終結對手的次數, 被對手終結的次數] */
export type FinishTally = Record<FinishType, [number, number]>;

/** 累計戰績（以你的陀螺為主） */
export interface TrialRecord {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  finishes: FinishTally;
}

const FINISHES: FinishType[] = ['spin', 'over', 'burst', 'xtreme'];
const emptyTally = (): FinishTally => Object.fromEntries(FINISHES.map((f) => [f, [0, 0]])) as FinishTally;

/** 還沒打過的戰績 */
export function emptyTrialRecord(): TrialRecord {
  return { games: 0, wins: 0, losses: 0, draws: 0, finishes: emptyTally() };
}

/** 記上一戰（res.winner：0 = 你的陀螺、1 = 電腦、null = 平手）；回傳新的戰績，不改原本的 */
export function addTrialResult(r: TrialRecord, res: RoundResult): TrialRecord {
  const out: TrialRecord = { ...r, finishes: structuredClone(r.finishes), games: r.games + 1 };
  if (res.winner === null) out.draws++;
  else if (res.winner === 0) {
    out.wins++;
    out.finishes[res.finish][0]++;
  } else {
    out.losses++;
    out.finishes[res.finish][1]++;
  }
  return out;
}

/** 一場 CPU 對打的結果 */
export interface DuelResult {
  /** 0 = a、1 = b、null = 平手或 120 秒時間到 */
  winner: 0 | 1 | null;
  finish: FinishType | null;
  /** 模擬秒數 */
  time: number;
}

/** 對打的上限秒數（耐久測試保證所有組合都在這之前分出勝負） */
const MAX_SECONDS = 120;

/**
 * 兩顆陀螺交給 CPU 對打一場（a 在 0 號座位、b 在 1 號）：同樣的種子結果相同。
 * launch 為雙方的發射力道，specialRate 為 CPU 每次思考時放必殺的機率（兩邊一樣）。
 */
export function simulateDuel(a: TopSpec, b: TopSpec, arena: ArenaSpec, seed: number, opts: { launch: [number, number]; specialRate: number }): DuelResult {
  const sim = new BattleSim(a, b, { seed, launch: opts.launch, arena });
  const rng = createRng(seed * 7 + 3);
  while (!sim.result && sim.time < MAX_SECONDS) {
    for (const id of [0, 1] as const) {
      const ai = cpuThink(sim, id, rng, opts.specialRate);
      sim.setControl(id, ai.control);
      if (ai.special) sim.useSpecial(id);
    }
    sim.step(1 / 120);
    sim.drainEvents();
  }
  return { winner: sim.result?.winner === 0 || sim.result?.winner === 1 ? sim.result.winner : null, finish: sim.result?.finish ?? null, time: sim.time };
}

/** 自動對打的統計（以你的陀螺為主） */
export interface DuelSummary {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  finishes: FinishTally;
  /** 平均回合秒數 */
  avgTime: number;
  /** 你的陀螺在 0 號、1 號座位各打了幾場（座位有偏差，所以各半） */
  seats: [number, number];
}

/**
 * 電腦自動對打 N 場（試驗模式的「自動對打 100 場」）：兩邊都交給 CPU，雙方的發射力道與必殺頻率都照難度的 CPU 設定；
 * 偶數場你的陀螺坐 0 號、奇數場坐 1 號。runNext() 一次打一場，畫面可以分批呼叫（不會卡住）。
 */
export class AutoDuel {
  readonly total: number;
  private readonly a: TopSpec;
  private readonly b: TopSpec;
  private readonly arena: ArenaSpec;
  private readonly launchRange: [number, number];
  private readonly specialRate: number;
  private readonly rng: ReturnType<typeof createRng>;
  private played = 0;
  private time = 0;
  private result: Omit<DuelSummary, 'avgTime' | 'games'> = { wins: 0, losses: 0, draws: 0, finishes: emptyTally(), seats: [0, 0] };
  /** 最近一場的發射力道 [你的陀螺, 電腦的陀螺]（測試用） */
  lastLaunch: [number, number] | null = null;

  constructor(cfg: TrialConfig, total: number, seed: number) {
    this.total = total;
    this.a = buildSpec(cfg.player.top, cfg.player.loadout);
    this.b = buildSpec(cfg.cpu.top, cfg.cpu.loadout);
    this.arena = ARENAS[cfg.arena];
    const d = DIFFICULTIES[cfg.difficulty];
    this.launchRange = d.cpuLaunch;
    this.specialRate = d.cpuSpecialRate;
    this.rng = createRng(seed);
  }

  /** 打完了沒 */
  get done(): boolean {
    return this.played >= this.total;
  }

  /** 進度 0..1 */
  get progress(): number {
    return this.total ? this.played / this.total : 1;
  }

  /** 打下一場；全部打完時回傳 false */
  runNext(): boolean {
    if (this.done) return false;
    const [lo, hi] = this.launchRange;
    const mine = lo + this.rng() * (hi - lo);
    const theirs = lo + this.rng() * (hi - lo);
    this.lastLaunch = [mine, theirs];
    const seed = Math.floor(this.rng() * 1e9);
    const seat = (this.played % 2) as 0 | 1;
    const r = seat === 0
      ? simulateDuel(this.a, this.b, this.arena, seed, { launch: [mine, theirs], specialRate: this.specialRate })
      : simulateDuel(this.b, this.a, this.arena, seed, { launch: [theirs, mine], specialRate: this.specialRate });
    this.result.seats[seat]++;
    this.time += r.time;
    this.played++;
    if (r.winner === null || r.finish === null) this.result.draws++;
    else if (r.winner === seat) {
      this.result.wins++;
      this.result.finishes[r.finish][0]++;
    } else {
      this.result.losses++;
      this.result.finishes[r.finish][1]++;
    }
    return !this.done;
  }

  /** 目前為止的統計 */
  get summary(): DuelSummary {
    return { ...structuredClone(this.result), games: this.played, avgTime: this.played ? this.time / this.played : 0 };
  }
}
