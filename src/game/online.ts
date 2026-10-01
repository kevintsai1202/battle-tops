import { gameServerUrl, NetClient } from '../net/client';
import { Predictor } from '../net/predict';
import { PROTOCOL_VERSION, type ArenaChoice, type ClientMessage, type ResultRow, type RoomSummary, type ServerMessage } from '../net/protocol';
import type { PullMetrics } from '../sim/launcher';
import type { TeamLoadouts } from '../sim/parts';
import type { TopId, V2 } from '../sim/types';

/** 伺服器訊息的某一種 */
export type Msg<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

/** 推移最多每秒送幾次、沒變化時的心跳間隔（毫秒） */
const INPUT_MIN_GAP = 1000 / 30;
const INPUT_HEARTBEAT = 1000;
/** 推移變化小於這個量就不送 */
const INPUT_EPS = 0.02;
/**
 * 預測最多往前推多少時間（毫秒）。主執行緒卡住時量到的往返時間會暴增（實測 headless 軟體算圖 7 秒），
 * 照單全收每次校正要重算上百步、又讓主執行緒更慢；超過這個值的延遲就讓自己的陀螺顯示得晚一點。
 */
export const MAX_AHEAD_MS = 250;
/** 模擬每秒步數 */
const STEPS_PER_SEC = 120;
/** 瀏覽房間列表時多久查一次（毫秒） */
export const BROWSE_EVERY = 3000;
/** 瀏覽器記住玩家名稱用的 localStorage 鍵 */
const NAME_KEY = 'battle-tops.name';

/** 讀取上次用的名稱 */
export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

/** 記住名稱 */
export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // 儲存空間被封鎖：這次仍然生效，只是不會記住
  }
}

/**
 * 線上對戰的客戶端狀態（設計見 docs/online-design.md）：連線、房間、雙方隊伍、目前這一戰、預測器，
 * 以及送出操作（推移節流、必殺與衝刺帶序號並先在本機預測）。畫面的反應由 Game 依伺服器訊息處理。
 */
export class OnlineSession {
  readonly net: NetClient;
  /** 自己的名稱 */
  name: string;
  /** 房號（進房後才有）、自己是不是房主、房間是否公開在列表上 */
  code: string | null = null;
  host = false;
  isPublic = true;
  /** 最新的房間狀態、第 2 步公開的陣容、開打前確定的隊伍、目前這一戰 */
  lobby: Msg<'lobby'> | null = null;
  reveal: Msg<'reveal'> | null = null;
  teams: Msg<'teams'> | null = null;
  battle: Msg<'battle'> | null = null;
  /** 戰績與總分（自己的觀點） */
  results: ResultRow[] = [];
  score: [number, number] = [0, 0];
  /** 自己這一戰的座位與預測器（開打後才有） */
  seat: 0 | 1 = 0;
  predictor: Predictor | null = null;
  /** 對手斷線時的判負時間（本機毫秒；沒有暫停為 null） */
  pausedUntil: number | null = null;
  /** 房間列表（最新一次查詢的結果）與收到的次數 */
  rooms: RoomSummary[] = [];
  roomsSeen = 0;
  /** 還沒套用的最新快照（每幀最多校正一次，中間的快照直接略過：快照是完整狀態） */
  private latestSnap: Msg<'snap'> | null = null;
  /** 瀏覽房間列表的定時器（沒在瀏覽時為 null） */
  private browseTimer: ReturnType<typeof setInterval> | null = null;
  /** 進行中的連線（避免同時開兩條） */
  private connecting: Promise<void> | null = null;
  /** 已經離開線上對戰（不再重試連線） */
  private closed = false;
  private seq = 0;
  private lastInput: V2 = { x: 0, z: 0 };
  private lastInputAt = 0;

  constructor(name: string, url = gameServerUrl()) {
    this.name = name;
    this.net = new NetClient(url);
    this.net.onStatus((st) => {
      // 連線有結果了：下次要連線時重新發起
      if (st === 'open' || st === 'closed') this.connecting = null;
      // 瀏覽中一連上就立刻查，不用等下一輪
      if (st === 'open' && this.browseTimer !== null) this.requestRooms();
    });
  }

  /**
   * 連線：已連上直接完成；閒置或已斷就發起連線（同時呼叫只開一條）；
   * 連線中、自動重連中就等狀態變成 open（變成 closed 視為失敗）。
   */
  connect(): Promise<void> {
    const st = this.net.status;
    if (st === 'open') return Promise.resolve();
    if (this.connecting) return this.connecting;
    if (st === 'idle' || st === 'closed') {
      this.connecting = this.net.connect().finally(() => {
        this.connecting = null;
      });
      return this.connecting;
    }
    return new Promise((ok, fail) => {
      const off = this.net.onStatus((s) => {
        if (s === 'open') {
          off();
          ok();
        } else if (s === 'closed') {
          off();
          fail(new Error('連不上對戰伺服器'));
        }
      });
    });
  }

  /** 開始瀏覽房間列表：立刻查一次，之後每 BROWSE_EVERY 毫秒查一次；沒連上就發起連線（斷了下一輪重試） */
  startBrowsing(): void {
    if (this.browseTimer !== null || this.closed) return;
    this.browseTimer = setInterval(() => this.browseTick(), BROWSE_EVERY);
    this.browseTick();
  }

  /** 停止瀏覽房間列表 */
  stopBrowsing(): void {
    if (this.browseTimer !== null) clearInterval(this.browseTimer);
    this.browseTimer = null;
  }

  /** 是否正在瀏覽房間列表 */
  get browsing(): boolean {
    return this.browseTimer !== null;
  }

  /** 瀏覽的一輪：連線中就查列表；閒置或已斷就重試連線（自動重連中交給 NetClient） */
  private browseTick(): void {
    const st = this.net.status;
    if (st === 'open') this.requestRooms();
    else if ((st === 'idle' || st === 'closed') && !this.closed) this.connect().catch(() => undefined);
  }

  /** 查詢房間列表 */
  requestRooms(): void {
    if (this.net.status === 'open') this.send({ t: 'list' });
  }

  /** 收到房間列表 */
  onRooms(m: Msg<'rooms'>): void {
    this.rooms = m.rooms;
    this.roomsSeen++;
  }

  /** 對手的名稱（還沒有對手時為「對手」） */
  get opponentName(): string {
    return this.lobby?.opponent?.name ?? '對手';
  }

  send(m: ClientMessage): void {
    this.net.send(m);
  }

  /** 建立房間；isPublic 為是否列在房間列表 */
  create(isPublic = true): void {
    this.send({ t: 'create', name: this.name, public: isPublic, v: PROTOCOL_VERSION });
  }

  /** 快速加入：加入等最久的公開房間，沒有就建一間公開房間 */
  quick(): void {
    this.send({ t: 'quick', name: this.name, v: PROTOCOL_VERSION });
  }

  join(code: string): void {
    this.send({ t: 'join', code: code.toUpperCase(), name: this.name, v: PROTOCOL_VERSION });
  }

  leave(): void {
    this.send({ t: 'leave' });
  }

  setArena(arena: ArenaChoice): void {
    this.send({ t: 'arena', arena });
  }

  /** 第 1 步：送出選好的三顆（點選順序是第 2 步的預設出場順序） */
  sendPicks(picks: TopId[]): void {
    this.send({ t: 'picks', picks });
  }

  /** 第 2 步調整中：送出目前的出場順序與零件（時間到時伺服器用最後收到的這一份） */
  sendArrange(order: TopId[], loadouts: TeamLoadouts): void {
    this.send({ t: 'arrange', order, loadouts });
  }

  /** 第 2 步準備完成：送出最後的出場順序與零件（送出後鎖定） */
  sendReady(order: TopId[], loadouts: TeamLoadouts): void {
    this.send({ t: 'ready', order, loadouts });
  }

  /** 第 2 步開始（或重連時補送）：記下公開的陣容、截止時間與目前的設定 */
  onReveal(m: Msg<'reveal'>): void {
    this.reveal = m;
  }

  /** 發射：時機誤差（秒）、世界座標的瞄準角度、拉條量測（Space 時為 null） */
  sendLaunch(error: number, aim: number, pull: PullMetrics | null): void {
    this.send({ t: 'launch', error, aim, pull });
  }

  sendOvertime(top: TopId): void {
    this.send({ t: 'overtime', top });
  }

  rematch(): void {
    this.send({ t: 'rematch' });
  }

  /** 進房：記下房號、是否公開與 token（斷線自動回房），停止瀏覽房間列表 */
  onRoom(m: Msg<'room'>): void {
    this.code = m.code;
    this.host = m.host;
    this.isPublic = m.public;
    this.net.setResume(m.code, m.token);
    this.stopBrowsing();
  }

  /** 新的一戰：記下座位與賽況，預測器等開打後再建 */
  onBattle(m: Msg<'battle'>): void {
    this.battle = m;
    this.seat = m.seat;
    this.score = m.score;
    this.results = m.results;
    this.predictor = null;
    this.latestSnap = null;
  }

  /** 開打：用伺服器的初始狀態建立預測器 */
  onLaunched(m: Msg<'launched'>): void {
    this.predictor = new Predictor(m.snap, this.seat);
    this.latestSnap = null;
  }

  /** 快照：還沒有預測器就用它建立；否則記下來，等下一幀 flushSnap 再校正 */
  onSnap(m: Msg<'snap'>): void {
    if (!this.predictor) {
      this.predictor = new Predictor(m.snap, this.seat);
      return;
    }
    this.latestSnap = m;
  }

  /**
   * 每幀呼叫一次：用最新的快照校正預測，往前推約一個往返時間（上限 MAX_AHEAD_MS；慢動作時依時間流速縮短）。
   * 主執行緒卡住時累積的多個快照只校正一次。
   */
  flushSnap(): void {
    const m = this.latestSnap;
    if (!m || !this.predictor) return;
    this.latestSnap = null;
    const aheadMs = Math.min(this.net.clock.rtt, MAX_AHEAD_MS);
    this.predictor.reconcile(m.snap, m.ack, Math.round((aheadMs / 1000) * STEPS_PER_SEC * m.ts));
  }

  /** 每幀：推移有明顯變化且距上次夠久才送，沒變化時每秒送一次心跳 */
  input(control: V2, nowMs: number): void {
    this.predictor?.setControl(control);
    const changed = Math.hypot(control.x - this.lastInput.x, control.z - this.lastInput.z) > INPUT_EPS;
    const gap = nowMs - this.lastInputAt;
    if ((changed && gap >= INPUT_MIN_GAP) || gap >= INPUT_HEARTBEAT) {
      this.send({ t: 'input', seq: ++this.seq, x: control.x, z: control.z });
      this.lastInput = { ...control };
      this.lastInputAt = nowMs;
    }
  }

  /** 必殺：本機預測立即發動並送出 */
  special(): void {
    const t = this.predictor?.sim.tops[this.seat];
    if (!t || !t.alive || t.specialUsed || t.special < 1) return;
    const seq = ++this.seq;
    this.predictor!.special(seq);
    this.send({ t: 'special', seq });
  }

  /** 衝刺：本機預測立即套用並送出 */
  dash(dir: V2): void {
    if (!this.predictor) return;
    const seq = ++this.seq;
    this.predictor.dash(seq, dir);
    this.send({ t: 'dash', seq, x: dir.x, z: dir.z });
  }

  /** 伺服器時間 → 本機時間（毫秒） */
  toLocal(serverMs: number): number {
    return this.net.clock.toLocal(serverMs);
  }

  /** 分享給朋友的連結（保留 server 參數，本機測試用） */
  shareLink(): string {
    const u = new URL(location.href);
    const server = u.searchParams.get('server');
    u.search = '';
    u.hash = '';
    u.searchParams.set('room', this.code ?? '');
    if (server) u.searchParams.set('server', server);
    return u.toString();
  }

  /** 離開線上對戰：停止瀏覽、通知伺服器並關閉連線（之後不再重試連線） */
  close(): void {
    this.closed = true;
    this.stopBrowsing();
    this.leave();
    this.net.close();
  }
}
