import { ARENA, inCircle, ventPhase, type ArenaSpec } from './arena';
import { applyAura, createTop, eruptPush, integrateTop, resolveCollision, resolvePillars, resolveRim, SPIN_FINISH_RATIO } from './physics';
import { createRng, range, type Rng } from './rng';
import { runSpecial } from './specials';
import type { FinishType, RoundResult, SimEvent, TopSpec, TopState, V2 } from './types';

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

/** 濺水事件的最短間隔（秒），避免每一步都發 */
const SPLASH_GAP = 0.35;

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
  private readonly rng: Rng;
  private events: SimEvent[] = [];
  /** 各熔岩噴口上一次噴發所在的週期編號（每個週期只轟一次） */
  private readonly ventCycle: number[];
  /** 各陀螺上一次濺水事件的時間 */
  private readonly lastSplash = [-9, -9];

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

  /** 以固定步長 dt 推進模擬 */
  step(dt: number): void {
    this.time += dt;
    const [a, b] = this.tops;

    for (const t of this.tops) {
      if (t.alive) {
        const hit = integrateTop(t, dt, this.arena);
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
      if (rim.ringOut) {
        this.finishTop(t, 'over');
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
      const loser = finished[0];
      const other = this.tops[loser.id === 0 ? 1 : 0];
      this.result = {
        finish: loser.finish!,
        loser: loser.id,
        winner: finished.length > 1 || !other.alive ? null : other.id,
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
    const damp = t.finish === 'over' ? 0.4 : 3;
    const k = Math.max(0, 1 - damp * dt);
    t.vel.x *= k;
    t.vel.z *= k;
    t.pos.x += t.vel.x * dt;
    t.pos.z += t.vel.z * dt;
    t.spin = Math.max(0, t.spin - t.spec.maxSpin * 0.6 * dt);
    t.angle += t.spinDir * t.spin * dt;
  }
}
