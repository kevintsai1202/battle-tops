import { afterEach, describe, expect, test, vi } from 'vitest';
import { MAX_AHEAD_MS, OnlineSession, type Msg } from '../../src/game/online';
import { PROTOCOL_VERSION } from '../../src/net/protocol';
import { ARENAS } from '../../src/sim/arena';
import { BattleSim } from '../../src/sim/battle';
import { TOP_SPECS } from '../../src/sim/tops';

const STEP = 1 / 120;

/** 一場模擬（伺服器端的權威狀態） */
function newSim(): BattleSim {
  return new BattleSim(TOP_SPECS.pegasus, TOP_SPECS.turtle, { seed: 4, launch: [0.95, 0.9], arena: ARENAS.practice });
}

/** 伺服器送的快照訊息 */
function snapMsg(sim: BattleSim, ack: number, ts = 1): Msg<'snap'> {
  return { t: 'snap', tick: Math.round(sim.time / STEP), ts, ack, snap: sim.snapshot(), events: [], director: [] };
}

/** 已開打（有預測器）的線上連線；url 不會真的連 */
function launched(sim: BattleSim): OnlineSession {
  const o = new OnlineSession('A', 'ws://unused.invalid/ws');
  o.seat = 0;
  o.onLaunched({ t: 'launched', snap: sim.snapshot(), launch: [0.95, 0.9], aim: [0, 0] });
  return o;
}

describe('線上連線：快照校正', () => {
  test('兩幀之間收到多個快照時，只用最新的校正一次（主執行緒卡住後不會連續重算）', () => {
    const sim = newSim();
    const o = launched(sim);
    const spy = vi.spyOn(o.predictor!, 'reconcile');
    for (let ack = 1; ack <= 5; ack++) {
      for (let k = 0; k < 6; k++) sim.step(STEP);
      o.onSnap(snapMsg(sim, ack));
    }
    expect(spy).not.toHaveBeenCalled();
    o.flushSnap();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].time).toBeCloseTo(sim.time, 9);
    expect(spy.mock.calls[0][1]).toBe(5);
    // 沒有新快照就不再校正
    o.flushSnap();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('往前推的步數依往返時間與時間流速；往返時間異常大時有上限', () => {
    const sim = newSim();
    const o = launched(sim);
    const spy = vi.spyOn(o.predictor!, 'reconcile');
    // 往返 60 ms：往前推 60 ms × 120 步／秒 ≈ 7 步
    o.net.clock.add(0, 0, 60);
    o.onSnap(snapMsg(sim, 1));
    o.flushSnap();
    expect(spy.mock.calls[0][2]).toBe(7);
    // 慢動作（0.12 倍）時按比例變少
    o.onSnap(snapMsg(sim, 2, 0.12));
    o.flushSnap();
    expect(spy.mock.calls[1][2]).toBe(1);
    // 主執行緒卡住量到往返 7 秒：最多只往前推 MAX_AHEAD_MS
    for (let i = 0; i < 12; i++) o.net.clock.add(1000 * i, 0, 1000 * i + 7000);
    o.onSnap(snapMsg(sim, 3));
    o.flushSnap();
    expect(spy.mock.calls[2][2]).toBe(Math.round((MAX_AHEAD_MS / 1000) * 120));
  });

  test('新的一戰開始時，丟掉上一戰還沒套用的快照', () => {
    const sim = newSim();
    const o = launched(sim);
    o.onSnap(snapMsg(sim, 1));
    o.onBattle({ t: 'battle', battle: 2, overtime: false, replay: false, seat: 1, specs: [{ id: 'pegasus', parts: {} }, { id: 'turtle', parts: {} }], goAt: 0, score: [1, 0], results: [] } as unknown as Msg<'battle'>);
    const next = newSim();
    o.onLaunched({ t: 'launched', snap: next.snapshot(), launch: [0.9, 0.9], aim: [0, 0] });
    const spy = vi.spyOn(o.predictor!, 'reconcile');
    o.flushSnap();
    expect(spy).not.toHaveBeenCalled();
  });
});

/** 測試用：不真的連線的 OnlineSession，攔下送出的訊息；status 為連線狀態 */
function offline(status: 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' = 'open') {
  const o = new OnlineSession('A', 'ws://unused.invalid/ws');
  o.net.status = status;
  const send = vi.spyOn(o.net, 'send').mockImplementation(() => undefined);
  const connect = vi.spyOn(o.net, 'connect').mockResolvedValue(undefined);
  // 真的 close 會碰 window（Node 測試環境沒有）
  vi.spyOn(o.net, 'close').mockImplementation(() => undefined);
  /** 模擬連線狀態改變（會通知訂閱者） */
  const setStatus = (st: typeof status) => (o.net as unknown as { setStatus(x: string): void }).setStatus(st);
  return { o, send, connect, setStatus };
}

describe('線上連線：房間列表', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('開始瀏覽：已連線就立刻查一次、之後每 3 秒查一次；停止後不再查', () => {
    vi.useFakeTimers();
    const { o, send } = offline('open');
    o.startBrowsing();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith({ t: 'list' });
    vi.advanceTimersByTime(3000);
    expect(send).toHaveBeenCalledTimes(2);
    o.stopBrowsing();
    vi.advanceTimersByTime(9000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  test('還沒連上：開始瀏覽就發起連線，連上的當下立刻查；斷了（closed）下一輪重試連線', () => {
    vi.useFakeTimers();
    const { o, send, connect, setStatus } = offline('idle');
    o.startBrowsing();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    setStatus('open');
    expect(send).toHaveBeenLastCalledWith({ t: 'list' });
    setStatus('closed');
    vi.advanceTimersByTime(3000);
    expect(connect).toHaveBeenCalledTimes(2);
    // 自動重連中（NetClient 自己會重試）不另外發起連線
    setStatus('reconnecting');
    vi.advanceTimersByTime(3000);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  test('進房後停止瀏覽；離開（close）後也不再查、不再重試連線', () => {
    vi.useFakeTimers();
    const { o, send, connect } = offline('open');
    o.startBrowsing();
    o.onRoom({ t: 'room', code: 'ABCD', token: 'x'.repeat(24), host: true, public: true });
    vi.advanceTimersByTime(9000);
    expect(send).toHaveBeenCalledTimes(1);
    const b = offline('closed');
    b.o.startBrowsing();
    b.o.close();
    vi.advanceTimersByTime(9000);
    expect(b.connect).toHaveBeenCalledTimes(1);
    expect(connect).not.toHaveBeenCalled();
  });

  test('收到房間列表：記下內容與收到次數；建房帶公開設定、快速加入帶名稱', () => {
    const { o, send } = offline('open');
    const rooms = [{ code: 'ABCD', host: 'Bob', guest: null, arena: 'practice' as const, status: 'waiting' as const, waited: 3 }];
    o.onRooms({ t: 'rooms', rooms });
    expect(o.rooms).toEqual(rooms);
    expect(o.roomsSeen).toBe(1);
    o.create(false);
    expect(send).toHaveBeenLastCalledWith({ t: 'create', name: 'A', public: false, v: PROTOCOL_VERSION });
    o.quick();
    expect(send).toHaveBeenLastCalledWith({ t: 'quick', name: 'A', v: PROTOCOL_VERSION });
  });

  test('進房訊息都帶協定版本；第 1 步送選的三顆、第 2 步送調整與準備完成；收到公開陣容就記下來', () => {
    const { o, send } = offline('open');
    o.join('abcd');
    expect(send).toHaveBeenLastCalledWith({ t: 'join', code: 'ABCD', name: 'A', v: PROTOCOL_VERSION });
    o.sendPicks(['blaze', 'turtle', 'gale']);
    expect(send).toHaveBeenLastCalledWith({ t: 'picks', picks: ['blaze', 'turtle', 'gale'] });
    const loadouts = { blaze: { disk: 'heavy' as const, driver: null } };
    o.sendArrange(['gale', 'blaze', 'turtle'], loadouts);
    expect(send).toHaveBeenLastCalledWith({ t: 'arrange', order: ['gale', 'blaze', 'turtle'], loadouts });
    o.sendReady(['gale', 'blaze', 'turtle'], loadouts);
    expect(send).toHaveBeenLastCalledWith({ t: 'ready', order: ['gale', 'blaze', 'turtle'], loadouts });
    const reveal: Msg<'reveal'> = { t: 'reveal', mine: ['blaze', 'turtle', 'gale'], theirs: ['wolf', 'orion', 'pegasus'], deadline: 5000, order: ['blaze', 'turtle', 'gale'], loadouts: {}, ready: false };
    o.onReveal(reveal);
    expect(o.reveal).toEqual(reveal);
  });

  test('連線：已連上直接完成；同時呼叫兩次只開一條連線；重連中就等它連上', async () => {
    const a = offline('open');
    await a.o.connect();
    expect(a.connect).not.toHaveBeenCalled();
    const b = offline('closed');
    await Promise.all([b.o.connect(), b.o.connect()]);
    expect(b.connect).toHaveBeenCalledTimes(1);
    const c = offline('reconnecting');
    const done = c.o.connect();
    c.setStatus('open');
    await done;
    expect(c.connect).not.toHaveBeenCalled();
  });
});
