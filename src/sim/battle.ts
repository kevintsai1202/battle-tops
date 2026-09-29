import { createTop, integrateTop, resolveCollision, resolveRim, SPIN_FINISH_RATIO } from './physics';
import { createRng, range, type Rng } from './rng';
import type { FinishType, RoundResult, SimEvent, TopSpec, TopState, V2 } from './types';

/** 建立一回合對戰的參數 */
export interface BattleOptions {
  /** 亂數種子（相同種子可重現同一回合） */
  seed: number;
  /** 兩顆陀螺的發射轉速比例（0.5..1，由發射時機換算） */
  launch: [number, number];
}

/**
 * 一回合對戰的模擬器（純邏輯，不碰 three.js 與 DOM）。
 * 固定步長推進；過程中產生的事件用 drainEvents() 取出。
 */
export class BattleSim {
  /** 兩顆陀螺：0 = 玩家，1 = CPU */
  readonly tops: [TopState, TopState];
  /** 已經過的模擬時間（秒） */
  time = 0;
  /** 回合結果；第一次出現終結時寫入，之後不再改變 */
  result: RoundResult | null = null;
  private readonly rng: Rng;
  private events: SimEvent[] = [];

  constructor(specA: TopSpec, specB: TopSpec, opts: BattleOptions) {
    this.rng = createRng(opts.seed);
    const j = () => range(this.rng, -0.25, 0.25);
    // 從場地左右兩側發射，初速斜向切入中心，開場不久就會第一次激突
    this.tops = [
      createTop(0, specA, { x: -2.1 + j(), z: j() }, { x: 2.0 + j(), z: 0.7 + j() }, opts.launch[0], 1),
      createTop(1, specB, { x: 2.1 + j(), z: j() }, { x: -2.0 + j(), z: -0.7 + j() }, opts.launch[1], 1),
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
   * 攻擊：朝對手突進並大幅提升攻擊；防禦：鐵壁（質量與防禦上升、抓地）；
   * 持久：回復轉速並修復爆裂量；平衡：回復一些轉速並突進。
   */
  useSpecial(id: number): boolean {
    const t = this.tops[id];
    const opp = this.tops[id === 0 ? 1 : 0];
    if (!t.alive || this.result || t.specialUsed || t.special < 1) return false;
    t.special = 0;
    t.specialUsed = true;

    const dx = opp.pos.x - t.pos.x;
    const dz = opp.pos.z - t.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const dir: V2 = { x: dx / d, z: dz / d };
    const max = t.spec.maxSpin;

    switch (t.spec.type) {
      case 'attack':
        t.vel = { x: t.vel.x * 0.3 + dir.x * 7.5, z: t.vel.z * 0.3 + dir.z * 7.5 };
        t.buff = { kind: 'rush', time: 1.0 };
        break;
      case 'defense':
        t.vel = { x: t.vel.x * 0.3, z: t.vel.z * 0.3 };
        t.buff = { kind: 'fortress', time: 3.0 };
        break;
      case 'stamina':
        t.spin = Math.min(max, t.spin + max * 0.22);
        t.burst = Math.max(0, t.burst - 0.25);
        t.buff = { kind: 'cyclone', time: 3.0 };
        break;
      case 'balance':
        t.spin = Math.min(max, t.spin + max * 0.15);
        t.vel = { x: t.vel.x * 0.4 + dir.x * 5.5, z: t.vel.z * 0.4 + dir.z * 5.5 };
        t.buff = { kind: 'nova', time: 1.5 };
        break;
    }
    this.events.push({ type: 'special', id, kind: t.spec.type });
    return true;
  }

  /** 以固定步長 dt 推進模擬 */
  step(dt: number): void {
    this.time += dt;
    const [a, b] = this.tops;

    for (const t of this.tops) {
      if (t.alive) {
        integrateTop(t, dt);
      } else {
        this.advanceFinished(t, dt);
      }
    }

    if (a.alive && b.alive) {
      const hit = resolveCollision(a, b, this.rng);
      if (hit) this.events.push({ type: 'clash', a: 0, b: 1, ...hit });
    }

    const finished: TopState[] = [];
    for (const t of this.tops) {
      if (!t.alive) continue;
      const rim = resolveRim(t);
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
