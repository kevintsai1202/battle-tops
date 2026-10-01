import { ARENA_IDS, ARENAS, type ArenaId, type ArenaSpec } from './arena';
import { BattleSim } from './battle';
import { cpuThink } from './cpu';
import { DIFFICULTIES, DIFFICULTY_IDS, type DifficultyId } from './difficulty';
import { PARTS, type Loadout, type PartSlot } from './parts';
import { createRng } from './rng';
import { buildSpec, TOP_SPECS } from './tops';
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

// ---------------- 存在瀏覽器裡的紀錄（localStorage） ----------------

/** localStorage 的鍵 */
export const TRIAL_STORE_KEY = 'battle-tops.trial';
/**
 * 紀錄的資料版本：調整平衡數值（陀螺屬性、零件、場地、物理）時加一，舊版的紀錄就不再拿來混算
 * （2026-10-02 起為 1：標準戰鬥盤改版、新增雙層戰鬥盤與極限終結之後）。
 */
export const TRIAL_DATA_VERSION = 1;
/** 最多保留幾組設定的紀錄（依最後更新時間） */
export const TRIAL_STORE_MAX = 50;

/** 一組設定的紀錄：設定本身、累計戰績、最近一次自動對打的結果、最後更新時間（毫秒） */
export interface TrialEntry {
  cfg: TrialConfig;
  record: TrialRecord;
  auto?: DuelSummary;
  at: number;
}

/** 存在瀏覽器裡的全部試驗紀錄：資料版本、上次的設定、各組設定的紀錄（key 為 trialKey） */
export interface TrialStore {
  v: number;
  cfg: TrialConfig | null;
  entries: Record<string, TrialEntry>;
}

/** 空的紀錄 */
export function emptyTrialStore(): TrialStore {
  return { v: TRIAL_DATA_VERSION, cfg: null, entries: {} };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
/** 非負整數 */
const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;

/** 一邊的設定合不合法：陀螺存在；零件不是 null 就要存在而且裝在對的欄位 */
function validSide(x: unknown): x is TrialSide {
  if (!isObj(x) || typeof x.top !== 'string' || !TOP_SPECS[x.top] || !isObj(x.loadout)) return false;
  return (['disk', 'driver'] as PartSlot[]).every((slot) => {
    const id = (x.loadout as Record<string, unknown>)[slot];
    return id === null || (typeof id === 'string' && PARTS[id]?.slot === slot);
  });
}

/** 試驗設定合不合法（存在瀏覽器裡的資料可能過期或被改壞，不合法的不能拿去 buildSpec） */
function validConfig(x: unknown): x is TrialConfig {
  return (
    isObj(x) &&
    validSide(x.player) &&
    validSide(x.cpu) &&
    ARENA_IDS.includes(x.arena as ArenaId) &&
    DIFFICULTY_IDS.includes(x.difficulty as DifficultyId)
  );
}

/** 終結方式的統計合不合法：四種都要有 [非負整數, 非負整數] */
function validTally(x: unknown): x is FinishTally {
  return isObj(x) && FINISHES.every((f) => Array.isArray(x[f]) && (x[f] as unknown[]).length === 2 && (x[f] as unknown[]).every(isCount));
}

/** 累計戰績合不合法 */
function validRecord(x: unknown): x is TrialRecord {
  return isObj(x) && isCount(x.games) && isCount(x.wins) && isCount(x.losses) && isCount(x.draws) && validTally(x.finishes);
}

/** 自動對打的結果合不合法 */
function validSummary(x: unknown): x is DuelSummary {
  return (
    isObj(x) &&
    isCount(x.games) &&
    isCount(x.wins) &&
    isCount(x.losses) &&
    isCount(x.draws) &&
    validTally(x.finishes) &&
    typeof x.avgTime === 'number' &&
    Array.isArray(x.seats) &&
    x.seats.length === 2 &&
    x.seats.every(isCount)
  );
}

/**
 * 解析存在瀏覽器裡的紀錄（純函式）：沒有資料、不是 JSON、資料版本不同都當成沒有紀錄；
 * 每一組設定個別檢查，不合法的（陀螺或零件不存在、數字不對、key 和設定對不上）丟掉，其他保留。
 */
export function parseTrialStore(json: string | null): TrialStore {
  let raw: unknown;
  try {
    raw = json ? JSON.parse(json) : null;
  } catch {
    return emptyTrialStore();
  }
  if (!isObj(raw) || raw.v !== TRIAL_DATA_VERSION) return emptyTrialStore();
  const out = emptyTrialStore();
  if (validConfig(raw.cfg)) out.cfg = raw.cfg;
  if (isObj(raw.entries)) {
    for (const [key, e] of Object.entries(raw.entries)) {
      if (!isObj(e) || !validConfig(e.cfg) || trialKey(e.cfg) !== key || !validRecord(e.record) || typeof e.at !== 'number') continue;
      const entry: TrialEntry = { cfg: e.cfg, record: e.record, at: e.at };
      if (validSummary(e.auto)) entry.auto = e.auto;
      out.entries[key] = entry;
    }
  }
  return out;
}

/** 只留最近更新的 max 組設定（純函式，回傳新的紀錄） */
export function pruneTrialStore(s: TrialStore, max = TRIAL_STORE_MAX): TrialStore {
  const keep = Object.entries(s.entries)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, max);
  return { ...s, entries: Object.fromEntries(keep) };
}

