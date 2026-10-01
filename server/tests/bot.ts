import WebSocket from 'ws';
import type { ClientMessage, ServerMessage } from '../../src/net/protocol';
import type { TeamLoadouts } from '../../src/sim/parts';
import { BattleSim } from '../../src/sim/battle';
import { cpuThink } from '../../src/sim/cpu';
import { createRng } from '../../src/sim/rng';
import type { TopId } from '../../src/sim/types';

/**
 * 用 CPU 邏輯自動對戰的機器人（WebSocket 客戶端）：第 2 步收到公開陣容就照 plan 送出順序與零件並準備完成、
 * 收到開戰就送發射、每幾則快照用 CPU 邏輯送一次推移與必殺、延長賽挑隊伍第一顆。
 * 給伺服器整合測試、e2e 與線上伺服器檢查（scripts/live-server-report.test.ts）共用。
 */
export class Bot {
  readonly ws: WebSocket;
  readonly msgs: ServerMessage[] = [];
  /** 第 2 步要送出的出場順序與零件（沒給順序就照第 1 步選的順序）；autoReady 為 false 時不自動準備完成 */
  plan: { order?: TopId[]; loadouts?: TeamLoadouts; autoReady?: boolean } = {};
  /** 每則訊息收到的時間（performance.now，毫秒；和 msgs 一一對應） */
  readonly at: number[] = [];
  private seat: 0 | 1 = 0;
  private sim: BattleSim | null = null;
  private seq = 0;
  private snaps = 0;
  private team: TopId[] = [];
  private readonly rng;
  private readonly waiters: { test: (m: ServerMessage) => boolean; done: (m: ServerMessage) => void }[] = [];

  constructor(url: string, seed: number, origin?: string) {
    this.rng = createRng(seed);
    this.ws = new WebSocket(url, origin ? { origin } : undefined);
    this.ws.on('message', (d) => this.onMessage(JSON.parse(String(d)) as ServerMessage));
  }

  /** 等連線打開 */
  open(): Promise<void> {
    return new Promise((ok, fail) => {
      this.ws.once('open', () => ok());
      this.ws.once('error', fail);
    });
  }

  send(m: ClientMessage): void {
    this.ws.send(JSON.stringify(m));
  }

  /** 等到收到某類型（且符合條件）的訊息 */
  waitFor<T extends ServerMessage['t']>(t: T, pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true, ms = 60_000): Promise<Extract<ServerMessage, { t: T }>> {
    const hit = this.msgs.find((m) => m.t === t && pred(m as Extract<ServerMessage, { t: T }>));
    if (hit) return Promise.resolve(hit as Extract<ServerMessage, { t: T }>);
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => fail(new Error(`等不到 ${t}`)), ms);
      this.waiters.push({
        test: (m) => m.t === t && pred(m as Extract<ServerMessage, { t: T }>),
        done: (m) => {
          clearTimeout(timer);
          ok(m as Extract<ServerMessage, { t: T }>);
        },
      });
    });
  }

  /** 收到的某類型訊息 */
  all<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }>[] {
    return this.msgs.filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[];
  }

  close(): void {
    this.ws.terminate();
  }

  private onMessage(m: ServerMessage): void {
    this.msgs.push(m);
    this.at.push(performance.now());
    switch (m.t) {
      case 'reveal':
        if (this.plan.autoReady !== false) this.send({ t: 'ready', order: this.plan.order ?? m.mine, loadouts: this.plan.loadouts ?? {} });
        break;
      case 'teams':
        this.team = m.mine;
        break;
      case 'battle':
        this.seat = m.seat;
        this.sim = null;
        this.send({ t: 'launch', error: (this.rng() - 0.5) * 0.1, aim: 0, pull: { length: 1, speed: 0.8, aim: 0 } });
        break;
      case 'launched':
        this.sim = BattleSim.fromSnapshot(m.snap);
        break;
      case 'snap': {
        if (!this.sim) this.sim = BattleSim.fromSnapshot(m.snap);
        else this.sim.restore(m.snap);
        // 20 倍速時快照很密集：每 5 則才送一次操作，避免觸發伺服器的流量限制
        if (m.snap.result || ++this.snaps % 5 !== 0) break;
        const d = cpuThink(this.sim, this.seat, this.rng);
        this.send({ t: 'input', seq: ++this.seq, x: d.control.x, z: d.control.z });
        const me = this.sim.tops[this.seat];
        if (d.special && me.special >= 1 && !me.specialUsed) this.send({ t: 'special', seq: ++this.seq });
        break;
      }
      case 'overtime':
        this.send({ t: 'overtime', top: this.team[0] });
        break;
      default:
        break;
    }
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      if (this.waiters[i].test(m)) {
        this.waiters[i].done(m);
        this.waiters.splice(i, 1);
      }
    }
  }
}
