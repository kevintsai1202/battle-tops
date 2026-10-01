import { beforeEach, describe, expect, test } from 'vitest';
import {
  COUNTDOWN_MS,
  hostSeatFor,
  INTRO_LEAD_MS,
  LAUNCH_TIMEOUT_MS,
  RECONNECT_MS,
  Room,
  ROUND_END_MS,
  seatOf,
  sideOf,
} from '../../server/src/room';
import { createRng } from '../../src/sim/rng';
import { TOP_IDS } from '../../src/sim/tops';
import { FakeConn } from './fake-conn';

let clock = 0;
let tokenN = 0;
/** 建立房間（假時鐘、固定亂數） */
function makeRoom(): Room {
  clock = 1_000_000;
  tokenN = 0;
  return new Room('ABCD', { now: () => clock, rng: createRng(42), makeToken: () => `token${++tokenN}`.padEnd(24, 'x') });
}

/** 讓時間前進 ms 毫秒（每 1/60 秒推進一次房間） */
function advance(room: Room, ms: number): void {
  const dt = 1000 / 60;
  for (let t = 0; t < ms; t += dt) {
    clock += dt;
    room.advance(dt);
  }
}

let room: Room;
let host: FakeConn;
let guest: FakeConn;

/** 兩人進房 */
function seat2(): void {
  room = makeRoom();
  host = new FakeConn();
  guest = new FakeConn();
  expect(room.addPlayer(host, '房主')).toBe(0);
  expect(room.addPlayer(guest, '客人')).toBe(1);
}

/** 雙方送出隊伍（房主 blaze→turtle→gale，客人 wolf→orion→pegasus） */
function teams(): void {
  room.handle(0, { t: 'team', picks: ['blaze', 'turtle', 'gale'], loadouts: { blaze: { disk: 'heavy', driver: null } } });
  room.handle(1, { t: 'team', picks: ['wolf', 'orion', 'pegasus'], loadouts: {} });
}

/** 雙方都立刻發射（完美時機） */
function launchBoth(): void {
  room.handle(0, { t: 'launch', error: 0, aim: 0, pull: { length: 1, speed: 1, aim: 0 } });
  room.handle(1, { t: 'launch', error: 0, aim: 0, pull: { length: 1, speed: 1, aim: 0 } });
}

/** 讓指定座位的陀螺爆裂，推進到這一戰結束並進到下一個階段 */
function loseSeat(seat: 0 | 1): void {
  const sim = room.debug.sim!;
  sim.tops[seat].burst = 1;
  advance(room, ROUND_END_MS + 200);
}

describe('座位與陣營', () => {
  test('每戰輪替：第 1、3 戰房主坐 0 號，第 2 戰與延長賽坐 1 號', () => {
    expect(hostSeatFor(1, false)).toBe(0);
    expect(hostSeatFor(2, false)).toBe(1);
    expect(hostSeatFor(3, false)).toBe(0);
    expect(hostSeatFor(4, true)).toBe(1);
  });

  test('座位與陣營互相換算', () => {
    expect(sideOf(0, 0)).toBe(0);
    expect(sideOf(1, 0)).toBe(1);
    expect(sideOf(0, 1)).toBe(1);
    expect(sideOf(1, 1)).toBe(0);
    for (const hs of [0, 1] as const) for (const side of [0, 1] as const) expect(sideOf(seatOf(side, hs), hs)).toBe(side);
  });
});

describe('房間：大廳與組隊', () => {
  beforeEach(seat2);

  test('進房：房主與客人各自收到房號、token 與房間狀態；第三人進不來', () => {
    expect(host.last('room')).toMatchObject({ code: 'ABCD', host: true });
    expect(guest.last('room')).toMatchObject({ code: 'ABCD', host: false });
    expect(host.last('room').token).not.toBe(guest.last('room').token);
    expect(host.last('lobby')).toMatchObject({ phase: 'picking', host: true, me: { name: '房主' }, opponent: { name: '客人', connected: true } });
    expect(guest.last('lobby')).toMatchObject({ host: false, me: { name: '客人' }, opponent: { name: '房主' } });
    expect(room.addPlayer(new FakeConn(), '路人')).toBeNull();
  });

  test('只有房主能改場地，雙方都會收到', () => {
    room.handle(0, { t: 'arena', arena: 'volcano' });
    expect(guest.last('lobby').arena).toBe('volcano');
    room.handle(1, { t: 'arena', arena: 'glacier' });
    expect(host.last('lobby').arena).toBe('volcano');
    expect(guest.last('error')).toBeTruthy();
  });

  test('一方送出隊伍：對方看到「已完成」但看不到內容', () => {
    room.handle(0, { t: 'team', picks: ['blaze', 'turtle', 'gale'], loadouts: {} });
    expect(guest.last('lobby').opponent).toMatchObject({ ready: true });
    expect(guest.msgs.some((m) => JSON.stringify(m).includes('turtle'))).toBe(false);
  });

  test('雙方都送出後公開隊伍：自己的依出場順序、對手的依名鑑順序（出場順序保密），接著開第一戰', () => {
    teams();
    const h = host.last('teams');
    expect(h.mine).toEqual(['blaze', 'turtle', 'gale']);
    expect(h.theirs).toEqual([...TOP_IDS].filter((t) => ['wolf', 'orion', 'pegasus'].includes(t)));
    expect(h.loadouts).toEqual({ blaze: { disk: 'heavy', driver: null } });
    expect(guest.last('teams').loadouts).toEqual({});
    const b = host.last('battle');
    expect(b).toMatchObject({ battle: 1, overtime: false, replay: false, seat: 0 });
    expect(b.specs[0]).toEqual({ id: 'blaze', parts: { disk: 'heavy', driver: 'rubber' } });
    expect(b.specs[1].id).toBe('wolf');
    expect(guest.last('battle').seat).toBe(1);
    expect(b.goAt).toBe(clock + INTRO_LEAD_MS + COUNTDOWN_MS);
  });
});

describe('房間：發射與對戰', () => {
  beforeEach(() => {
    seat2();
    teams();
  });

  test('雙方都發射就開打：收到開打時的模擬狀態、雙方力道', () => {
    launchBoth();
    const l = host.last('launched');
    expect(l.launch).toEqual([1, 1]);
    expect(l.snap.tops[0].specId).toBe('blaze');
    expect(guest.last('launched').snap).toEqual(l.snap);
  });

  test('一方沒發射：「ゴー」後逾時，沒發射的一方用最低力道', () => {
    room.handle(0, { t: 'launch', error: 0, aim: 0, pull: { length: 1, speed: 1, aim: 0 } });
    advance(room, INTRO_LEAD_MS + COUNTDOWN_MS + LAUNCH_TIMEOUT_MS - 300);
    expect(host.all('launched')).toHaveLength(0);
    advance(room, 400);
    const l = host.last('launched');
    expect(l.launch[0]).toBe(1);
    expect(l.launch[1]).toBeCloseTo(0.65, 6);
  });

  test('對戰中每秒約 20 次快照，回報處理到的操作序號；推移套用到自己的座位', () => {
    launchBoth();
    room.handle(1, { t: 'input', seq: 5, x: 1, z: 0 });
    advance(room, 1000);
    const snaps = guest.all('snap');
    expect(snaps.length).toBeGreaterThanOrEqual(18);
    expect(snaps.length).toBeLessThanOrEqual(22);
    const s = guest.last('snap');
    expect(s.ack).toBe(5);
    expect(s.snap.tops[1].control).toEqual({ x: 1, z: 0 });
    expect(host.last('snap').ack).toBe(0);
  });

  test('快照的 ack 是「已經套用到模擬」的序號：收到但還沒推進的操作不算', () => {
    launchBoth();
    advance(room, 200);
    room.handle(1, { t: 'special', seq: 9 });
    // 還沒推進就送快照（模擬慢動作時可能一次推進 0 步）：ack 不能是 9
    room.debugSendSnaps();
    expect(guest.last('snap').ack).toBeLessThan(9);
    advance(room, 100);
    expect(guest.last('snap').ack).toBe(9);
  });

  test('必殺：套用到自己的座位，快照帶出必殺事件與導演的凍結，時間流速變慢', () => {
    launchBoth();
    advance(room, 100);
    room.debug.sim!.tops[1].special = 1;
    room.handle(1, { t: 'special', seq: 1 });
    advance(room, 120);
    const all = host.all('snap');
    expect(all.some((s) => s.events.some((e) => e.type === 'special' && e.id === 1))).toBe(true);
    expect(all.some((s) => s.director.some((d) => d.kind === 'special'))).toBe(true);
    expect(host.last('snap').ts).toBeLessThan(0.2);
  });

  test('陣營換算：第 2 戰房主坐 1 號，房主贏了分數仍記給房主', () => {
    launchBoth();
    loseSeat(1); // 第 1 戰：客人（1 號）爆裂 → 房主 +2
    expect(host.last('round')).toMatchObject({ winner: 'me', finish: 'burst', score: [2, 0], next: 'battle' });
    expect(guest.last('round')).toMatchObject({ winner: 'them', score: [0, 2] });
    const b2 = host.last('battle');
    expect(b2).toMatchObject({ battle: 2, seat: 1 });
    expect(b2.specs[1].id).toBe('turtle');
    expect(b2.specs[0].id).toBe('orion');
    launchBoth();
    loseSeat(0); // 第 2 戰：客人坐 0 號、爆裂 → 房主再 +2
    expect(host.last('round')).toMatchObject({ winner: 'me', score: [4, 0] });
    expect(guest.last('round')).toMatchObject({ winner: 'them', score: [0, 4] });
    expect(host.last('battle')).toMatchObject({ battle: 3, seat: 0 });
  });

  test('平手重打：同一戰、同樣的座位', () => {
    launchBoth();
    const sim = room.debug.sim!;
    sim.tops[0].burst = 1;
    sim.tops[1].burst = 1;
    advance(room, ROUND_END_MS + 200);
    expect(host.last('round')).toMatchObject({ winner: null, next: 'battle' });
    expect(host.last('battle')).toMatchObject({ battle: 1, replay: true, seat: 0 });
  });

  test('延長賽：三戰總分平手 → 雙方同時挑（都挑完才開打）→ 分出勝負結束', () => {
    launchBoth();
    loseSeat(1); // 房主 +2（爆裂）
    launchBoth();
    const s2 = room.debug.sim!;
    s2.tops[1].spin = 0; // 第 2 戰房主坐 1 號、停轉 → 客人 +1
    advance(room, ROUND_END_MS + 200);
    launchBoth();
    room.debug.sim!.tops[0].spin = 0; // 第 3 戰房主坐 0 號、停轉 → 客人 +1，2:2
    advance(room, ROUND_END_MS + 200);
    expect(host.last('round')).toMatchObject({ score: [2, 2], next: 'overtime' });
    expect(host.last('overtime')).toBeTruthy();
    room.handle(0, { t: 'overtime', top: 'gale' });
    expect(host.all('battle').filter((b) => b.overtime)).toHaveLength(0);
    room.handle(1, { t: 'overtime', top: 'nope' as never });
    room.handle(1, { t: 'overtime', top: 'blaze' }); // 不是自己的隊伍 → 不接受
    expect(host.all('battle').filter((b) => b.overtime)).toHaveLength(0);
    room.handle(1, { t: 'overtime', top: 'pegasus' });
    const ob = host.last('battle');
    expect(ob).toMatchObject({ overtime: true, seat: 1 });
    expect(ob.specs[1].id).toBe('gale');
    launchBoth();
    loseSeat(0); // 客人坐 0 號爆裂 → 房主勝
    expect(host.last('result')).toMatchObject({ winner: 'me', score: [4, 2], forfeit: false });
    expect(guest.last('result')).toMatchObject({ winner: 'them', score: [2, 4] });
    expect(host.last('result').results).toHaveLength(4);
  });

  test('再來一場：雙方都按才回到組隊', () => {
    // 三戰都是客人的陀螺爆裂（第 2 戰客人坐 0 號）→ 房主 6:0
    launchBoth();
    loseSeat(1);
    launchBoth();
    loseSeat(0);
    launchBoth();
    loseSeat(1);
    expect(host.last('result')).toMatchObject({ winner: 'me', score: [6, 0] });
    room.handle(0, { t: 'rematch' });
    expect(guest.last('lobby')).toMatchObject({ phase: 'result', opponent: { ready: true } });
    room.handle(1, { t: 'rematch' });
    expect(host.last('lobby')).toMatchObject({ phase: 'picking', me: { ready: false }, opponent: { ready: false } });
  });
});

describe('房間：斷線與離開', () => {
  beforeEach(() => {
    seat2();
    teams();
  });

  test('對戰中斷線：暫停模擬、對手收到判負時間；時間內重連就繼續，重連方收到完整狀態', () => {
    launchBoth();
    advance(room, 500);
    const tick = room.debug.tick;
    room.disconnect(1);
    expect(host.last('paused').until).toBe(clock + RECONNECT_MS);
    advance(room, 5000);
    expect(room.debug.tick).toBe(tick);
    const again = new FakeConn();
    expect(room.resume(again, guest.last('room').token)).toBe(1);
    expect(host.last('resumed')).toBeTruthy();
    expect(again.last('room')).toMatchObject({ code: 'ABCD', host: false });
    expect(again.last('teams').mine).toEqual(['wolf', 'orion', 'pegasus']);
    expect(again.last('battle')).toMatchObject({ battle: 1, seat: 1 });
    expect(again.last('launched').snap.time).toBeGreaterThan(0);
    advance(room, 500);
    expect(room.debug.tick).toBeGreaterThan(tick);
    expect(again.all('snap').length).toBeGreaterThan(5);
  });

  test('發射階段斷線後重連：「ゴー」往後順延暫停的時間，雙方收到新的時間', () => {
    const go = host.last('battle').goAt;
    room.disconnect(0);
    advance(room, 3000);
    room.resume(new FakeConn(), host.last('room').token);
    expect(guest.last('battle').goAt).toBeCloseTo(go + 3000, -2);
  });

  test('斷線超過 30 秒：判對方獲勝', () => {
    launchBoth();
    room.disconnect(0);
    advance(room, RECONNECT_MS + 500);
    expect(guest.last('result')).toMatchObject({ winner: 'me', forfeit: true });
  });

  test('組隊時客人離開：房主回到等待；房主離開：客人收到房間關閉', () => {
    const r2 = makeRoom();
    const h = new FakeConn();
    const g = new FakeConn();
    r2.addPlayer(h, 'a');
    r2.addPlayer(g, 'b');
    r2.handle(1, { t: 'leave' });
    expect(h.last('lobby')).toMatchObject({ phase: 'lobby', opponent: null });
    const g2 = new FakeConn();
    expect(r2.addPlayer(g2, 'c')).toBe(1);
    r2.handle(0, { t: 'leave' });
    expect(g2.last('closed')).toBeTruthy();
    expect(r2.closed).toBe(true);
  });

  test('比賽中離開：對手直接獲勝', () => {
    launchBoth();
    room.handle(1, { t: 'leave' });
    expect(host.last('result')).toMatchObject({ winner: 'me', forfeit: true });
  });
});
