import { ARENA, ARENAS, inCircle, liftPhase, ventPhase, type ArenaId, type ArenaSpec } from './arena';
import { applyAura, createTop, eruptPush, integrateTop, mobility, resolveCollision, resolvePillars, resolveRim, SPIN_FINISH_RATIO } from './physics';
import type { StockParts } from './parts';
import { createRng, range, type SeededRng } from './rng';
import { runSpecial } from './specials';
import { buildSpec } from './tops';
import type { FinishType, RoundResult, SimEvent, TopId, TopSpec, TopState, V2 } from './types';

/** 建立一回合對戰的參數 */
export interface BattleOptions {
  /** 亂數種子（相同種子可重現同一回合） */
  seed: number;
  /** 兩顆陀螺的發射轉速比例（0.5..1，由發射力道換算） */
  launch: [number, number];
  /** 場地（省略時為練習場） */
  arena?: ArenaSpec;
  /** 兩顆陀螺的發射角度偏移（弧度，正值 = 從上方看逆時針轉），由拉發射台的方向決定；省略為 0 */
  aim?: [number, number];
}

/** 一顆陀螺在快照裡的狀態：規格不放進來，只記代號與零件，還原時重建 */
export interface TopSnapshot extends Omit<TopState, 'spec'> {
  specId: TopId;
  parts: StockParts;
}

/**
 * 模擬的完整狀態（可以 JSON 化）：還原後繼續推進的結果與原本相同。
 * 線上對戰時伺服器定期送出，客戶端用來校正自己的預測。事件佇列不在快照裡（每一步都會取出）。
 */
export interface SimSnapshot {
  arena: ArenaId;
  time: number;
  result: RoundResult | null;
  /** 亂數產生器的內部狀態 */
  rng: number;
  ventCycle: number[];
  lastSplash: number[];
  lastDash: number[];
  tops: [TopSnapshot, TopSnapshot];
}

/** 濺水事件的最短間隔（秒），避免每一步都發 */
const SPLASH_GAP = 0.35;
/** 快甩衝刺：加上的速度（再乘機動倍率）、消耗的轉速（佔最高轉速）、冷卻秒數 */
const DASH_SPEED = 3.2;
const DASH_SPIN_COST = 0.03;
export const DASH_COOLDOWN = 0.9;

/** 把向量 v 旋轉 a 弧度 */
function rotate(v: V2, a: number): V2 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x * c - v.z * s, z: v.x * s + v.z * c };
}

/**
 * 一回合對戰的模擬器（純邏輯，不碰 three.js 與 DOM）。
 * 固定步長推進；過程中產生的事件用 drainEvents() 取出。
 */
export class BattleSim {
  /** 兩顆陀螺：0 = 玩家，1 = CPU */
  readonly tops: [TopState, TopState];
  readonly arena: ArenaSpec;
  /** 已經過的模擬時間（秒） */
  time = 0;
  /** 回合結果；第一次出現終結時寫入，之後不再改變 */
  result: RoundResult | null = null;
  private readonly rng: SeededRng;
  private events: SimEvent[] = [];
  /** 各熔岩噴口上一次噴發所在的週期編號（每個週期只轟一次） */
  private readonly ventCycle: number[];
  /** 各陀螺上一次濺水事件的時間 */
  private readonly lastSplash = [-9, -9];
  /** 各陀螺上一次快甩衝刺的時間 */
  private readonly lastDash = [-9, -9];

  constructor(specA: TopSpec, specB: TopSpec, opts: BattleOptions) {
    this.rng = createRng(opts.seed);
    this.arena = opts.arena ?? ARENA;
    this.ventCycle = this.arena.vents.map(() => -1);
    const j = () => range(this.rng, -0.25, 0.25);
    const aim = opts.aim ?? [0, 0];
    // 從場地左右兩側發射，初速斜向切入中心，開場不久就會第一次激突；拉發射台的方向會轉動初速方向
    this.tops = [
      createTop(0, specA, { x: -2.1 + j(), z: j() }, rotate({ x: 2.0 + j(), z: 0.7 + j() }, aim[0]), opts.launch[0]),
      createTop(1, specB, { x: 2.1 + j(), z: j() }, rotate({ x: -2.0 + j(), z: -0.7 + j() }, aim[1]), opts.launch[1]),
    ];
  }

  /** 目前狀態的快照（獨立的深複本，之後修改兩邊互不影響） */
  snapshot(): SimSnapshot {
    return {
      arena: this.arena.id,
      time: this.time,
      result: this.result ? { ...this.result } : null,
      rng: this.rng.state(),
      ventCycle: [...this.ventCycle],
      lastSplash: [...this.lastSplash],
      lastDash: [...this.lastDash],
      tops: this.tops.map((t) => {
        const { spec, ...rest } = t;
        return { ...structuredClone(rest), specId: spec.id, parts: { ...spec.parts } };
      }) as [TopSnapshot, TopSnapshot],
    };
  }

  /**
   * 把狀態覆寫成快照的內容（同一個場地）。陀螺物件沿用原本的參照（畫面層持有的參照不失效），
   * 規格依代號與零件重建（沒變時沿用）。未取出的事件一併清空。
   */
  restore(s: SimSnapshot): void {
    if (s.arena !== this.arena.id) throw new Error(`快照的場地 ${s.arena} 與這場模擬 ${this.arena.id} 不同`);
    this.time = s.time;
    this.result = s.result ? { ...s.result } : null;
    this.rng.setState(s.rng);
    this.ventCycle.splice(0, this.ventCycle.length, ...s.ventCycle);
    this.lastSplash.splice(0, 2, ...s.lastSplash);
    this.lastDash.splice(0, 2, ...s.lastDash);
    s.tops.forEach((snap, i) => {
      const { specId, parts, ...rest } = snap;
      const t = this.tops[i];
      const same = t.spec.id === specId && t.spec.parts.disk === parts.disk && t.spec.parts.driver === parts.driver;
      Object.assign(t, structuredClone(rest), { spec: same ? t.spec : buildSpec(specId, parts) });
    });
    this.events = [];
  }

  /** 雙層戰鬥盤中央降下的程度（0 = 升起、1 = 降下；依模擬時間算出，其他場地為 0） */
  get level(): number {
    return this.arena.lift ? liftPhase(this.arena.lift, this.time).level : 0;
  }

  /** 從快照建立一場模擬（線上對戰的客戶端與測試用） */
  static fromSnapshot(s: SimSnapshot): BattleSim {
    const [a, b] = s.tops.map((t) => buildSpec(t.specId, t.parts));
    const sim = new BattleSim(a, b, { seed: 0, launch: [1, 1], arena: ARENAS[s.arena] });
    sim.restore(s);
    return sim;
  }

  /** 設定推移方向（長度超過 1 會被截斷） */
  setControl(id: number, v: V2): void {
    const len = Math.hypot(v.x, v.z);
    const k = len > 1 ? 1 / len : 1;
    this.tops[id].control = { x: v.x * k, z: v.z * k };
  }

  /**
   * 發動必殺技（每回合限一次）；量表未滿、已用過、已被終結或回合已結束時回傳 false。
   * 效果依各陀螺的 special.steps 執行（見 sim/specials.ts）。
   */
  useSpecial(id: number): boolean {
    const t = this.tops[id];
    const opp = this.tops[id === 0 ? 1 : 0];
    if (!t.alive || this.result || t.specialUsed || t.special < 1) return false;
    t.special = 0;
    t.specialUsed = true;
    runSpecial(t, opp, this.arena);
    this.events.push({ type: 'special', id, top: t.spec.id });
    return true;
  }

  /**
   * 快甩衝刺（手機快甩手勢）：朝 dir 方向（世界座標，會正規化）加速，消耗一點轉速，有冷卻時間。
   * 速度乘上機動倍率：低機動的軸心衝得比較慢。成功時回傳 true 並發出 dash 事件。
   */
  dash(id: number, dir: V2): boolean {
    const t = this.tops[id];
    const len = Math.hypot(dir.x, dir.z);
    if (!t.alive || this.result || len < 1e-6 || this.time - this.lastDash[id] < DASH_COOLDOWN) return false;
    this.lastDash[id] = this.time;
    const v = DASH_SPEED * mobility(t);
    t.vel = { x: t.vel.x + (dir.x / len) * v, z: t.vel.z + (dir.z / len) * v };
    t.spin = Math.max(0, t.spin - t.spec.maxSpin * DASH_SPIN_COST);
    this.events.push({ type: 'dash', id, pos: { ...t.pos }, dir: { x: dir.x / len, z: dir.z / len } });
    return true;
  }

  /** 以固定步長 dt 推進模擬 */
  step(dt: number): void {
    this.time += dt;
    const [a, b] = this.tops;
    const level = this.level;

    for (const t of this.tops) {
      if (t.alive) {
        const hit = integrateTop(t, dt, this.arena, level);
        if (hit?.kind === 'splash' && this.time - this.lastSplash[t.id] > SPLASH_GAP) {
          this.lastSplash[t.id] = this.time;
          this.events.push({ type: 'hazard', kind: 'splash', pos: hit.pos, intensity: hit.intensity });
        }
      } else {
        this.advanceFinished(t, dt);
      }
    }
    this.updateVents();

    // 力場型必殺（吸引／推開）
    applyAura(a, b, dt);
    applyAura(b, a, dt);

    if (a.alive && b.alive) {
      const hit = resolveCollision(a, b, this.rng);
      if (hit) this.events.push({ type: 'clash', a: 0, b: 1, ...hit });
    }

    const finished: TopState[] = [];
    for (const t of this.tops) {
      if (!t.alive) continue;
      const pillar = resolvePillars(t, this.arena);
      if (pillar && pillar.hit > 1) this.events.push({ type: 'hazard', kind: 'pillar', pos: pillar.pos, intensity: pillar.hit });
      const rim = resolveRim(t, this.arena);
      if (rim.out) {
        // 從哪一種出場口飛出：兩角是場外終結、實體戰鬥盤中間的寬口是極限終結
        this.finishTop(t, rim.out);
        finished.push(t);
        continue;
      }
      if (rim.hit > 1.5) this.events.push({ type: 'wall', pos: { ...t.pos }, intensity: rim.hit, id: t.id });
      if (t.burst >= 1) {
        this.finishTop(t, 'burst');
        finished.push(t);
      } else if (t.spin < t.spec.maxSpin * SPIN_FINISH_RATIO) {
        this.finishTop(t, 'spin');
        finished.push(t);
      }
    }

    if (!this.result && finished.length > 0) {
      // 同一步雙方都倒下：只有一顆爆裂時，是另一顆撞爆了它 → 撞爆對方的那一顆獲勝（爆裂終結）；
      // 兩顆都爆裂、或都沒爆裂（例如同時停轉）才是平手
      const bursted = finished.length > 1 ? finished.filter((t) => t.finish === 'burst') : [];
      const loser = bursted.length === 1 ? bursted[0] : finished[0];
      const other = this.tops[loser.id === 0 ? 1 : 0];
      const draw = finished.length > 1 && bursted.length !== 1;
      this.result = {
        finish: loser.finish!,
        loser: loser.id,
        winner: draw || (!other.alive && bursted.length !== 1) ? null : other.id,
      };
    }
  }

  /** 熔岩噴口：每個週期噴發一次，把噴口內的陀螺轟開並發出事件 */
  private updateVents(): void {
    this.arena.vents.forEach((v, i) => {
      const ph = ventPhase(v, this.time);
      if (ph.erupt < 0) return;
      const cycle = Math.floor((this.time + v.phase) / v.period);
      if (cycle === this.ventCycle[i]) return;
      this.ventCycle[i] = cycle;
      let hits = 0;
      for (const t of this.tops) {
        if (t.alive && inCircle(t.pos, v.x, v.z, v.r + t.spec.radius * 0.5)) {
          eruptPush(t, v.x, v.z);
          hits++;
        }
      }
      this.events.push({ type: 'hazard', kind: 'erupt', pos: { x: v.x, z: v.z }, intensity: hits });
    });
  }

  /** 取出並清空累積的事件 */
  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** 標記陀螺被終結並發出事件 */
  private finishTop(t: TopState, finish: FinishType): void {
    t.alive = false;
    t.finish = finish;
    t.finishTime = 0;
    t.control = { x: 0, z: 0 };
    t.buff = null;
    t.hex = null;
    this.events.push({ type: 'finish', finish, loser: t.id, pos: { ...t.pos } });
  }

  /** 被終結的陀螺：出場的繼續飛出去，其他的滑行減速 */
  private advanceFinished(t: TopState, dt: number): void {
    t.finishTime += dt;
    const damp = t.finish === 'over' || t.finish === 'xtreme' ? 0.4 : 3;
    const k = Math.max(0, 1 - damp * dt);
    t.vel.x *= k;
    t.vel.z *= k;
    t.pos.x += t.vel.x * dt;
    t.pos.z += t.vel.z * dt;
    t.spin = Math.max(0, t.spin - t.spec.maxSpin * 0.6 * dt);
    t.angle += t.spinDir * t.spin * dt;
  }
}
