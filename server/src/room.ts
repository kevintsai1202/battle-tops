import { CameraDirector } from '../../src/director/director';
import type { ArenaChoice, ClientMessage, DirectorEvent, PlayerInfo, ResultRow, RoomPhase, ServerMessage, SpecRef } from '../../src/net/protocol';
import { ARENA_IDS, ARENAS, type ArenaSpec } from '../../src/sim/arena';
import { BattleSim } from '../../src/sim/battle';
import { DIFFICULTIES } from '../../src/sim/difficulty';
import { keyLaunchRatio, pullLaunchRatio, type PullMetrics } from '../../src/sim/launcher';
import { STOCK, type TeamLoadouts } from '../../src/sim/parts';
import type { Rng } from '../../src/sim/rng';
import { launchSpinRatio } from '../../src/sim/rules';
import { createMatch, currentPairing, recordResult, setOvertime, type Pairing, type TeamMatch } from '../../src/sim/team';
import { buildSpec, TOP_IDS } from '../../src/sim/tops';
import type { SimEvent, TopId, V2 } from '../../src/sim/types';

/**
 * 一個對戰房間（純邏輯：時鐘、亂數、token 由外部注入，連線只透過 Conn 介面，方便單元測試）。
 * 陣營（side）：0 = 房主、1 = 客人，對應 TeamMatch 的 player／cpu 兩邊。
 * 座位（seat）：模擬裡的 0／1 號（0 號在左），每一戰輪替；所有「模擬 ↔ 賽制」的換算只經過 sideOf／seatOf。
 * 設計見 docs/online-design.md。
 */

/** 開場介紹的長度：主播介紹最長約 2.1 秒，留足時間讓「スリー」不會蓋掉介紹（毫秒） */
export const INTRO_LEAD_MS = 2600;
/** 倒數：3、2、1 各一拍（0.9 秒），「ゴー」在介紹結束後 2.7 秒 */
export const COUNTDOWN_MS = 2700;
/** 「ゴー」後多久還沒發射就自動發射（客戶端「ゴー」後 0.6 秒自動放手，再留網路延遲的餘裕） */
export const LAUNCH_TIMEOUT_MS = 1400;
/** 一戰結束後停留多久才進下一戰（和 CPU 模式相同） */
export const ROUND_END_MS = 3600;
/** 快照間隔（每秒 20 次） */
export const SNAP_INTERVAL_MS = 50;
/** 斷線後保留座位的時間 */
export const RECONNECT_MS = 30_000;

/** 模擬固定步長 */
const STEP = 1 / 120;
/** 每次推進最多幾步（主機卡住時不要一次追太多，丟掉落後的時間並記錄） */
const MAX_STEPS = 60;
/** 每則快照最多帶幾個撞擊事件（貼身互磨時每一步都有接觸；保留最強的幾個給特效與音效） */
const MAX_CLASHES = 6;

/** 陣營：0 = 房主、1 = 客人 */
export type Side = 0 | 1;
/** 座位：模擬裡的 0／1 號 */
export type Seat = 0 | 1;

/** 送訊息給一位玩家的連線 */
export interface Conn {
  send(msg: ServerMessage): void;
  close(): void;
}

/** 房間需要的外部依賴 */
export interface RoomDeps {
  /** 伺服器時間（毫秒） */
  now(): number;
  rng: Rng;
  /** 產生重連用 token */
  makeToken(): string;
  log?(msg: string): void;
}

/** 房主這一戰坐幾號：第 1、3 戰坐 0 號，第 2 戰與延長賽坐 1 號（抵銷座位偏差） */
export function hostSeatFor(battle: number, overtime: boolean): Seat {
  if (overtime) return 1;
  return battle % 2 === 1 ? 0 : 1;
}

/** 座位 → 陣營 */
export function sideOf(seat: Seat, hostSeat: Seat): Side {
  return seat === hostSeat ? 0 : 1;
}

/** 陣營 → 座位 */
export function seatOf(side: Side, hostSeat: Seat): Seat {
  return (side === 0 ? hostSeat : 1 - hostSeat) as Seat;
}

/** 一位玩家 */
interface Player {
  name: string;
  token: string;
  conn: Conn | null;
  /** 隊伍（出場順序）；組隊時還沒送出為 null */
  team: TopId[] | null;
  loadouts: TeamLoadouts;
  /** 結果畫面：要再來一場 */
  ready: boolean;
  /** 延長賽挑的陀螺 */
  overtime: TopId | null;
  /** 目前的推移（世界座標）與收到的最大操作序號 */
  input: V2;
  seq: number;
  /** 已經套用到模擬的操作序號（快照回報這個，客戶端才知道哪些預測過的必殺、衝刺已經生效） */
  applied: number;
  /** 等待套用的必殺與衝刺 */
  special: boolean;
  dash: V2 | null;
  /** 這一戰的發射資料（還沒送出為 null） */
  launch: { error: number; aim: number; pull: PullMetrics | null } | null;
  /** 斷線的時間（連線中為 null） */
  goneAt: number | null;
}

/** 進行中的一戰 */
interface Battle {
  pairing: Pairing;
  hostSeat: Seat;
  replay: boolean;
  /** 發射（倒數中）→ 對戰 → 終結後的停留 */
  stage: 'launch' | 'fight' | 'end';
  goAt: number;
  sim: BattleSim | null;
  director: CameraDirector;
  /** 還沒推進的模擬時間（秒） */
  acc: number;
  tick: number;
  nextSnapAt: number;
  /** 上次快照後的事件與導演切換 */
  events: SimEvent[];
  dir: DirectorEvent[];
  endAt: number;
  /** 發射力道與瞄準（依座位） */
  launch: [number, number];
  aim: [number, number];
}

export class Room {
  readonly code: string;
  private readonly deps: RoomDeps;
  phase: RoomPhase = 'lobby';
  private arenaChoice: ArenaChoice = 'practice';
  private arena: ArenaSpec = ARENAS.practice;
  private readonly players: [Player | null, Player | null] = [null, null];
  private match: TeamMatch | null = null;
  private battle: Battle | null = null;
  /** 上一戰的編號（判斷是不是平手重打） */
  private lastBattleNo = 0;
  /** 斷線暫停：開始時間、判負時間、斷線的陣營 */
  private paused: { since: number; until: number; side: Side } | null = null;
  /** 最後一次有人連著的時間（房間清理用） */
  lastActive: number;
  private isClosed = false;

  constructor(code: string, deps: RoomDeps) {
    this.code = code;
    this.deps = deps;
    this.lastActive = deps.now();
  }

  /** 房間已關閉（可以移除） */
  get closed(): boolean {
    return this.isClosed;
  }

  /** 目前連線中的人數 */
  get connected(): number {
    return this.players.filter((p) => p?.conn).length;
  }

  /** 測試用：立刻送出快照（模擬「還沒推進就到了送快照的時間」） */
  debugSendSnaps(): void {
    if (this.battle?.sim) this.sendSnaps(this.battle);
  }

  /** 測試與除錯用的內部狀態 */
  get debug() {
    return { sim: this.battle?.sim ?? null, phase: this.phase, stage: this.battle?.stage ?? null, tick: this.battle?.tick ?? 0, paused: this.paused !== null };
  }

  // ------------------------------------------------------------ 進出房間

  /** 加入房間：第一位是房主。滿了或已關閉回傳 null */
  addPlayer(conn: Conn, name: string): Side | null {
    if (this.isClosed) return null;
    const side: Side | null = !this.players[0] ? 0 : !this.players[1] ? 1 : null;
    if (side === null) return null;
    this.players[side] = {
      name,
      token: this.deps.makeToken(),
      conn,
      team: null,
      loadouts: {},
      ready: false,
      overtime: null,
      input: { x: 0, z: 0 },
      seq: 0,
      applied: 0,
      special: false,
      dash: null,
      launch: null,
      goneAt: null,
    };
    this.send(side, { t: 'room', code: this.code, token: this.players[side]!.token, host: side === 0 });
    if (side === 1 && this.phase === 'lobby') this.phase = 'picking';
    this.broadcastLobby();
    return side;
  }

  /** 用 token 重連；成功回傳陣營並補送完整狀態 */
  resume(conn: Conn, token: string): Side | null {
    if (this.isClosed) return null;
    const side = this.players.findIndex((p) => p?.token === token);
    if (side < 0) return null;
    const s = side as Side;
    const p = this.players[s]!;
    if (p.conn && p.conn !== conn) p.conn.close();
    p.conn = conn;
    p.goneAt = null;
    if (this.paused && this.players.every((q) => q?.conn)) this.unpause();
    this.sendState(s);
    this.broadcastLobby();
    return s;
  }

  /** 連線斷了（不是主動離開）：比賽中暫停等待重連 */
  disconnect(side: Side): void {
    const p = this.players[side];
    if (!p || !p.conn) return;
    p.conn = null;
    p.goneAt = this.deps.now();
    if ((this.phase === 'match' || this.phase === 'overtimePick') && !this.paused) {
      const now = this.deps.now();
      this.paused = { since: now, until: now + RECONNECT_MS, side };
      this.send(this.other(side), { t: 'paused', until: this.paused.until });
    }
    this.broadcastLobby();
  }

  /** 主動離開：比賽中判對方勝；房主離開會關閉房間 */
  private leave(side: Side): void {
    if (this.phase === 'match' || this.phase === 'overtimePick') this.forfeit(side);
    const p = this.players[side];
    if (!p) return;
    this.players[side] = null;
    if (side === 0) {
      this.send(1, { t: 'closed', reason: '房主離開了房間' });
      this.close();
      return;
    }
    // 客人離開：房主回到等人的狀態
    if (this.phase === 'picking') {
      this.phase = 'lobby';
      if (this.players[0]) this.players[0].team = null;
    }
    this.broadcastLobby();
  }

  /** 由外部關閉房間（閒置逾時等）：通知還連著的人 */
  shutdown(reason: string): void {
    for (const side of [0, 1] as const) this.send(side, { t: 'closed', reason });
    this.close();
  }

  /** 關閉房間 */
  private close(): void {
    this.isClosed = true;
    for (const p of this.players) p?.conn?.close();
  }

  // ------------------------------------------------------------ 訊息

  /** 處理玩家訊息（create／join／resume／ping 由外層處理） */
  handle(side: Side, msg: ClientMessage): void {
    const p = this.players[side];
    if (!p || this.isClosed) return;
    switch (msg.t) {
      case 'arena':
        if (side !== 0) return this.error(side, 'NOT_HOST', '只有房主能選場地');
        if (this.phase !== 'lobby' && this.phase !== 'picking') return;
        this.arenaChoice = msg.arena;
        this.broadcastLobby();
        return;
      case 'team':
        if (this.phase !== 'picking') return;
        p.team = [...msg.picks];
        p.loadouts = structuredClone(msg.loadouts);
        this.broadcastLobby();
        if (this.players.every((q) => q?.team)) this.startMatch();
        return;
      case 'launch': {
        const b = this.battle;
        if (!b || b.stage !== 'launch' || p.launch || this.paused) return;
        p.launch = { error: msg.error, aim: msg.aim, pull: msg.pull };
        if (this.players.every((q) => q?.launch)) this.fire();
        return;
      }
      case 'input':
        p.input = { x: msg.x, z: msg.z };
        p.seq = Math.max(p.seq, msg.seq);
        return;
      case 'special':
        p.special = true;
        p.seq = Math.max(p.seq, msg.seq);
        return;
      case 'dash':
        p.dash = { x: msg.x, z: msg.z };
        p.seq = Math.max(p.seq, msg.seq);
        return;
      case 'overtime':
        if (this.phase !== 'overtimePick' || !p.team?.includes(msg.top)) return;
        p.overtime = msg.top;
        if (this.players.every((q) => q?.overtime)) {
          setOvertime(this.match!, this.players[0]!.overtime!, this.players[1]!.overtime!);
          this.phase = 'match';
          this.startBattle();
        }
        return;
      case 'rematch':
        if (this.phase !== 'result' || !this.players[this.other(side)]) return;
        p.ready = true;
        this.broadcastLobby();
        if (this.players.every((q) => q?.ready)) this.resetToPicking();
        return;
      case 'leave':
        this.leave(side);
        return;
      default:
        return;
    }
  }

  // ------------------------------------------------------------ 比賽流程

  /** 雙方都送出隊伍：抽場地、公開隊伍、開第一戰 */
  private startMatch(): void {
    const [h, g] = this.players as [Player, Player];
    const id = this.arenaChoice === 'random' ? ARENA_IDS[Math.floor(this.deps.rng() * ARENA_IDS.length)] : this.arenaChoice;
    this.arena = ARENAS[id];
    this.match = createMatch(h.team!, g.team!);
    this.lastBattleNo = 0;
    for (const side of [0, 1] as const) {
      const me = this.players[side]!;
      const them = this.players[this.other(side)]!;
      this.send(side, { t: 'teams', mine: [...me.team!], theirs: TOP_IDS.filter((t) => them.team!.includes(t)), loadouts: structuredClone(me.loadouts), arena: id });
    }
    this.phase = 'match';
    this.startBattle();
  }

  /** 開始目前對陣的一戰（平手重打沿用同一組對陣與座位） */
  private startBattle(): void {
    const pairing = currentPairing(this.match!)!;
    const replay = pairing.battle === this.lastBattleNo;
    this.lastBattleNo = pairing.battle;
    for (const p of this.players) {
      if (!p) continue;
      p.launch = null;
      p.input = { x: 0, z: 0 };
      p.special = false;
      p.dash = null;
    }
    const now = this.deps.now();
    this.battle = {
      pairing,
      hostSeat: hostSeatFor(pairing.battle, pairing.overtime),
      replay,
      stage: 'launch',
      goAt: now + INTRO_LEAD_MS + COUNTDOWN_MS,
      sim: null,
      director: new CameraDirector(),
      acc: 0,
      tick: 0,
      nextSnapAt: now,
      events: [],
      dir: [],
      endAt: 0,
      launch: [0, 0],
      aim: [0, 0],
    };
    for (const side of [0, 1] as const) this.send(side, this.battleMessage(side));
  }

  /** 依座位排列的雙方規格 */
  private specs(b: Battle): [SpecRef, SpecRef] {
    return ([0, 1] as const).map((seat) => {
      const side = sideOf(seat, b.hostSeat);
      const top = side === 0 ? b.pairing.player : b.pairing.cpu;
      return { id: top, parts: { ...buildSpec(top, this.players[side]?.loadouts[top] ?? STOCK).parts } };
    }) as [SpecRef, SpecRef];
  }

  /** 某一方看到的「新的一戰」訊息 */
  private battleMessage(side: Side): ServerMessage {
    const b = this.battle!;
    return {
      t: 'battle',
      battle: b.pairing.battle,
      overtime: b.pairing.overtime,
      replay: b.replay,
      seat: seatOf(side, b.hostSeat),
      specs: this.specs(b),
      goAt: b.goAt,
      score: this.persp(this.match!.score, side),
      results: this.rows(side),
    };
  }

  /** 發射：依雙方送來的時機與拉條算力道（沒送的用最低力道），建立模擬並開打 */
  private fire(): void {
    const b = this.battle!;
    const d = DIFFICULTIES.normal;
    for (const seat of [0, 1] as const) {
      const p = this.players[sideOf(seat, b.hostSeat)];
      const l = p?.launch ?? null;
      const timing = launchSpinRatio(l ? l.error : 1, d.launch);
      b.launch[seat] = l?.pull ? pullLaunchRatio(timing, l.pull, d.pullBase) : keyLaunchRatio(timing);
      b.aim[seat] = l ? l.aim : 0;
    }
    const [a, c] = this.specs(b).map((s) => buildSpec(s.id, s.parts));
    b.sim = new BattleSim(a, c, { seed: Math.floor(this.deps.rng() * 1e9), launch: [...b.launch], arena: this.arena, aim: [...b.aim] });
    b.stage = 'fight';
    b.nextSnapAt = this.deps.now() + SNAP_INTERVAL_MS;
    const snap = b.sim.snapshot();
    for (const side of [0, 1] as const) this.send(side, { t: 'launched', snap, launch: [...b.launch], aim: [...b.aim] });
  }

  /** 推進一步模擬：套用雙方操作、收集事件、驅動導演 */
  private stepOnce(b: Battle): void {
    const sim = b.sim!;
    if (b.stage === 'fight') {
      for (const side of [0, 1] as const) {
        const p = this.players[side];
        if (!p) continue;
        const seat = seatOf(side, b.hostSeat);
        sim.setControl(seat, p.input);
        if (p.special) {
          sim.useSpecial(seat);
          p.special = false;
        }
        if (p.dash) {
          sim.dash(seat, p.dash);
          p.dash = null;
        }
        p.applied = p.seq;
      }
    }
    sim.step(STEP);
    b.tick++;
    for (const e of sim.drainEvents()) {
      b.events.push(e);
      if (e.type === 'clash') {
        if (b.director.notifyClash(e)) b.dir.push({ kind: 'closeup', pos: { ...e.pos }, normal: { ...e.normal }, intensity: e.intensity });
      } else if (e.type === 'special') {
        b.director.notifySpecial();
        b.dir.push({ kind: 'special' });
      } else if (e.type === 'finish' && b.stage === 'fight') {
        b.director.notifyFinish(e.pos);
        b.dir.push({ kind: 'finish', pos: { ...e.pos } });
        b.stage = 'end';
        b.endAt = this.deps.now() + ROUND_END_MS;
        sim.setControl(0, { x: 0, z: 0 });
        sim.setControl(1, { x: 0, z: 0 });
      }
    }
  }

  /** 送出快照（兩人共用同一份狀態；撞擊事件只留最強的幾個） */
  private sendSnaps(b: Battle): void {
    const snap = b.sim!.snapshot();
    const clashes = b.events.filter((e) => e.type === 'clash');
    const keep = new Set(clashes.sort((x, y) => (y.type === 'clash' && x.type === 'clash' ? y.intensity - x.intensity : 0)).slice(0, MAX_CLASHES));
    const events = b.events.filter((e) => e.type !== 'clash' || keep.has(e));
    for (const side of [0, 1] as const) {
      const p = this.players[side];
      if (!p) continue;
      this.send(side, { t: 'snap', tick: b.tick, ts: b.director.timeScale, ack: p.applied, snap, events, director: b.dir });
    }
    b.events = [];
    b.dir = [];
  }

  /** 這一戰結束：記錄結果（座位換成陣營），通知雙方並進到下一步 */
  private endRound(b: Battle): void {
    const res = b.sim!.result!;
    const loser = sideOf(res.loser as Seat, b.hostSeat);
    const winner = res.winner === null ? null : sideOf(res.winner as Seat, b.hostSeat);
    const m = this.match!;
    recordResult(m, { finish: res.finish, loser, winner });
    const next = m.phase === 'done' ? 'result' : m.phase === 'overtime' && !m.overtimePick ? 'overtime' : 'battle';
    for (const side of [0, 1] as const) {
      this.send(side, { t: 'round', winner: winner === null ? null : winner === side ? 'me' : 'them', finish: res.finish, score: this.persp(m.score, side), next });
    }
    this.battle = null;
    if (next === 'result') this.finishMatch(false);
    else if (next === 'overtime') {
      this.phase = 'overtimePick';
      for (const p of this.players) if (p) p.overtime = null;
      for (const side of [0, 1] as const) this.send(side, { t: 'overtime' });
    } else this.startBattle();
  }

  /** 整場結束 */
  private finishMatch(forfeit: boolean): void {
    this.phase = 'result';
    this.battle = null;
    this.paused = null;
    for (const p of this.players) if (p) p.ready = false;
    for (const side of [0, 1] as const) this.send(side, this.resultMessage(side, forfeit));
  }

  /** 判負：loser 斷線逾時或比賽中離開 */
  private forfeit(loser: Side): void {
    const m = this.match;
    if (!m) return;
    m.phase = 'done';
    m.winner = this.other(loser);
    this.finishMatch(true);
  }

  /** 某一方看到的結果 */
  private resultMessage(side: Side, forfeit: boolean): ServerMessage {
    const m = this.match!;
    return { t: 'result', winner: m.winner === side ? 'me' : 'them', score: this.persp(m.score, side), results: this.rows(side), forfeit };
  }

  /** 雙方都要再來一場：回到組隊 */
  private resetToPicking(): void {
    this.match = null;
    this.battle = null;
    for (const p of this.players) {
      if (!p) continue;
      p.team = null;
      p.loadouts = {};
      p.ready = false;
      p.overtime = null;
    }
    this.phase = 'picking';
    this.broadcastLobby();
  }

  // ------------------------------------------------------------ 時間推進

  /** 伺服器迴圈每次呼叫：處理逾時、推進模擬、送快照 */
  advance(dtMs: number): void {
    if (this.isClosed) return;
    const now = this.deps.now();
    if (this.players.some((p) => p?.conn)) this.lastActive = now;
    if (this.paused) {
      if (now >= this.paused.until) this.forfeit(this.paused.side);
      return;
    }
    // 大廳、組隊、結果畫面：斷線太久視同離開
    for (const side of [0, 1] as const) {
      const p = this.players[side];
      if (p && p.goneAt !== null && now - p.goneAt >= RECONNECT_MS && this.phase !== 'match' && this.phase !== 'overtimePick') this.leave(side);
    }
    const b = this.battle;
    if (!b || this.isClosed) return;
    if (b.stage === 'launch') {
      if (now >= b.goAt + LAUNCH_TIMEOUT_MS) this.fire();
      return;
    }
    const dt = dtMs / 1000;
    b.director.update(dt);
    b.acc += dt * b.director.timeScale;
    let n = 0;
    while (b.acc >= STEP && n < MAX_STEPS) {
      this.stepOnce(b);
      b.acc -= STEP;
      n++;
    }
    if (n >= MAX_STEPS && b.acc >= STEP) {
      this.deps.log?.(`[${this.code}] 模擬落後實際時間 ${(b.acc * 1000).toFixed(0)} ms，丟棄`);
      b.acc = 0;
    }
    if (now >= b.nextSnapAt) {
      this.sendSnaps(b);
      b.nextSnapAt = Math.max(b.nextSnapAt + SNAP_INTERVAL_MS, now);
    }
    if (b.stage === 'end' && now >= b.endAt) this.endRound(b);
  }

  /** 解除暫停：發射階段的「ゴー」與終結後的停留都往後順延暫停的時間 */
  private unpause(): void {
    const p = this.paused!;
    const dur = this.deps.now() - p.since;
    this.paused = null;
    const b = this.battle;
    if (b) {
      if (b.stage === 'launch') b.goAt += dur;
      if (b.stage === 'end') b.endAt += dur;
      b.nextSnapAt = this.deps.now();
    }
    const other = this.other(p.side);
    this.send(other, { t: 'resumed' });
    if (b?.stage === 'launch') this.send(other, this.battleMessage(other));
  }

  // ------------------------------------------------------------ 送訊息

  /** 補送完整狀態（重連時） */
  private sendState(side: Side): void {
    const p = this.players[side]!;
    this.send(side, { t: 'room', code: this.code, token: p.token, host: side === 0 });
    this.send(side, this.lobbyMessage(side));
    const m = this.match;
    if (m && this.phase !== 'picking') {
      const them = this.players[this.other(side)];
      this.send(side, { t: 'teams', mine: [...(p.team ?? [])], theirs: TOP_IDS.filter((t) => them?.team?.includes(t)), loadouts: structuredClone(p.loadouts), arena: this.arena.id });
    }
    const b = this.battle;
    if (b) {
      this.send(side, this.battleMessage(side));
      if (b.sim) this.send(side, { t: 'launched', snap: b.sim.snapshot(), launch: [...b.launch], aim: [...b.aim] });
    }
    if (this.phase === 'overtimePick' && !p.overtime) this.send(side, { t: 'overtime' });
    if (this.phase === 'result' && m) this.send(side, this.resultMessage(side, false));
  }

  /** 某一方看到的房間狀態 */
  private lobbyMessage(side: Side): ServerMessage {
    const info = (q: Player): PlayerInfo => ({
      name: q.name,
      connected: q.conn !== null,
      ready: this.phase === 'picking' ? q.team !== null : this.phase === 'result' ? q.ready : false,
    });
    const me = this.players[side]!;
    const them = this.players[this.other(side)];
    return { t: 'lobby', phase: this.phase, arena: this.arenaChoice, host: side === 0, me: info(me), opponent: them ? info(them) : null };
  }

  /** 送房間狀態給雙方 */
  private broadcastLobby(): void {
    for (const side of [0, 1] as const) if (this.players[side]?.conn) this.send(side, this.lobbyMessage(side));
  }

  /** 以某一方為準的 [自己, 對手] */
  private persp(v: [number, number], side: Side): [number, number] {
    return side === 0 ? [v[0], v[1]] : [v[1], v[0]];
  }

  /** 以某一方為準的戰績 */
  private rows(side: Side): ResultRow[] {
    return (this.match?.results ?? []).map((r) => ({
      battle: r.battle,
      overtime: r.overtime,
      mine: side === 0 ? r.player : r.cpu,
      theirs: side === 0 ? r.cpu : r.player,
      winner: r.winner === side ? 'me' : 'them',
      finish: r.finish,
      points: this.persp(r.points, side),
    }));
  }

  private error(side: Side, code: string, message: string): void {
    this.send(side, { t: 'error', code, message });
  }

  private other(side: Side): Side {
    return side === 0 ? 1 : 0;
  }

  /** 送訊息給某一方（沒連線就略過；送失敗不影響房間） */
  private send(side: Side, msg: ServerMessage): void {
    const c = this.players[side]?.conn;
    if (!c) return;
    try {
      c.send(msg);
    } catch (e) {
      this.deps.log?.(`[${this.code}] 送出 ${msg.t} 失敗：${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
