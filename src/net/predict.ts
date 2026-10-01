import { BattleSim, type SimSnapshot } from '../sim/battle';
import type { V2 } from '../sim/types';

/** 模擬固定步長 */
const STEP = 1 / 120;
/** 校正跳動超過這個距離就直接跳過去（不慢慢收斂，避免拖著殘影） */
const SNAP_DISTANCE = 1;
/** 畫面偏移每秒衰減的速率（越大收斂越快） */
const DECAY_RATE = 10;

/** 還沒被伺服器確認的動作（必殺、衝刺） */
type Pending = { seq: number; kind: 'special' } | { seq: number; kind: 'dash'; dir: V2 };

/**
 * 客戶端預測（伺服器權威＋客戶端預測，設計見 docs/online-design.md）：
 * - 本機保有一份模擬，每幀用自己目前的操作往前推，自己的陀螺零延遲反應。
 * - 收到快照時還原成伺服器狀態，重新套用伺服器還沒確認的必殺與衝刺，再往前推 ahead 步
 *   （約一個往返時間：畫面上看到的是「伺服器收到自己現在這個操作時」的狀態）；對手沿用快照裡伺服器最後收到的操作。
 * - 還原造成的位置跳動記成畫面偏移，慢慢衰減到 0，看不出跳動。
 * - 預測產生的事件一律丟掉：特效、音效、鏡頭只依伺服器事件觸發，不會重複。
 */
export class Predictor {
  readonly sim: BattleSim;
  private readonly seat: 0 | 1;
  private control: V2 = { x: 0, z: 0 };
  private pending: Pending[] = [];
  /** 還沒推進的模擬時間（秒） */
  private acc = 0;
  /** 兩顆陀螺的畫面偏移（依座位） */
  private readonly offset: [V2, V2] = [
    { x: 0, z: 0 },
    { x: 0, z: 0 },
  ];

  /** snap：開打時的模擬狀態；seat：自己的座位 */
  constructor(snap: SimSnapshot, seat: 0 | 1) {
    this.sim = BattleSim.fromSnapshot(snap);
    this.seat = seat;
  }

  /** 還沒被伺服器確認的動作數 */
  get pendingCount(): number {
    return this.pending.length;
  }

  /** 自己目前的推移（世界座標） */
  setControl(v: V2): void {
    this.control = { x: v.x, z: v.z };
  }

  /** 按下必殺：本機立刻發動並記下，伺服器確認前的校正都會重新套用 */
  special(seq: number): void {
    this.sim.useSpecial(this.seat);
    this.sim.drainEvents();
    this.pending.push({ seq, kind: 'special' });
  }

  /** 衝刺：本機立刻套用並記下 */
  dash(seq: number, dir: V2): void {
    this.sim.dash(this.seat, dir);
    this.sim.drainEvents();
    this.pending.push({ seq, kind: 'dash', dir: { ...dir } });
  }

  /** 往前推 simDt 秒（已套用時間流速） */
  advance(simDt: number): void {
    this.acc += simDt;
    while (this.acc >= STEP) {
      this.stepOnce();
      this.acc -= STEP;
    }
  }

  /**
   * 收到快照：還原成伺服器狀態、丟掉已確認（序號 ≤ ack）的動作、重新套用其餘動作，再往前推 ahead 步。
   * 還原前後的位置差記成畫面偏移。
   */
  reconcile(snap: SimSnapshot, ack: number, ahead: number): void {
    const before = this.sim.tops.map((t) => ({ ...t.pos }));
    this.sim.restore(snap);
    this.pending = this.pending.filter((p) => p.seq > ack);
    for (const p of this.pending) {
      if (p.kind === 'special') this.sim.useSpecial(this.seat);
      else this.sim.dash(this.seat, p.dir);
    }
    this.sim.drainEvents();
    for (let k = 0; k < ahead && !this.sim.result; k++) this.stepOnce();
    this.sim.tops.forEach((t, i) => {
      const o = this.offset[i];
      o.x += before[i].x - t.pos.x;
      o.z += before[i].z - t.pos.z;
      if (Math.hypot(o.x, o.z) > SNAP_DISTANCE) {
        o.x = 0;
        o.z = 0;
      }
    });
  }

  /** 畫面偏移隨時間衰減（每幀以牆鐘時間呼叫） */
  decay(dt: number): void {
    const k = Math.exp(-dt * DECAY_RATE);
    for (const o of this.offset) {
      o.x *= k;
      o.z *= k;
    }
  }

  /** 某個座位的陀螺在畫面上的位置（模擬位置＋畫面偏移） */
  renderPos(seat: 0 | 1): V2 {
    const p = this.sim.tops[seat].pos;
    return { x: p.x + this.offset[seat].x, z: p.z + this.offset[seat].z };
  }

  /** 推進一步：自己用目前的操作，對手沿用快照的操作；事件丟掉 */
  private stepOnce(): void {
    this.sim.setControl(this.seat, this.control);
    this.sim.step(STEP);
    this.sim.drainEvents();
  }
}
