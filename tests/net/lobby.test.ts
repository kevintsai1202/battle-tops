import { beforeEach, describe, expect, test } from 'vitest';
import { RoomManager, type EnterResult } from '../../server/src/manager';
import { listingStatus, type Room, type Side } from '../../server/src/room';
import { createRng } from '../../src/sim/rng';
import { FakeConn } from './fake-conn';

/**
 * 房間列表與快速加入（RoomManager.list／quick，假時鐘、假連線）：
 * 只列公開房間；等人中（房主在線、還沒有客人）可加入，對戰中（雙方都在、至少一人在線）灰色顯示；
 * 快速加入挑等最久的公開房間，沒有就建一間公開房間。
 */

let clock = 0;
let tokenN = 0;
let mgr: RoomManager;

beforeEach(() => {
  clock = 1_000_000;
  tokenN = 0;
  mgr = new RoomManager({ now: () => clock, rng: createRng(7), makeToken: () => `token${++tokenN}`.padEnd(24, 'x') });
});

/** 讓時間前進 ms 毫秒（每 1/60 秒推進一次所有房間） */
function advance(ms: number): void {
  const dt = 1000 / 60;
  for (let t = 0; t < ms; t += dt) {
    clock += dt;
    mgr.advance(dt);
  }
}

/** 進房結果：失敗直接丟錯（測試用） */
function entered(r: EnterResult): { room: Room; side: Side } {
  if ('error' in r) throw new Error(r.message);
  return r;
}

/** 建房，回傳房間與房主的連線 */
function create(name: string, isPublic = true): { room: Room; conn: FakeConn } {
  const conn = new FakeConn();
  return { room: entered(mgr.create(conn, name, isPublic)).room, conn };
}

/** 讓一位客人加入 */
function join(room: Room, name: string): FakeConn {
  const conn = new FakeConn();
  entered(mgr.join(room.code, conn, name));
  return conn;
}

describe('房間列表的狀態判斷', () => {
  test('等人中：大廳、房主在線、還沒有客人；對戰中：雙方都在且至少一人在線（組隊、比賽、延長賽挑選、結果畫面）；其他不列', () => {
    const on = { connected: true };
    const off = { connected: false };
    expect(listingStatus('lobby', on, null)).toBe('waiting');
    expect(listingStatus('lobby', off, null)).toBeNull();
    expect(listingStatus('lobby', null, null)).toBeNull();
    expect(listingStatus('lobby', on, on)).toBeNull();
    for (const phase of ['picking', 'match', 'overtimePick', 'result'] as const) {
      expect(listingStatus(phase, on, on)).toBe('playing');
      expect(listingStatus(phase, off, on)).toBe('playing');
      expect(listingStatus(phase, on, off)).toBe('playing');
      expect(listingStatus(phase, off, off)).toBeNull();
      expect(listingStatus(phase, on, null)).toBeNull();
    }
  });
});

describe('房間列表', () => {
  test('只列公開的房間：等人中帶房主名稱、場地、等了幾秒；不公開的不列', () => {
    const a = create('Alice');
    create('Bob', false);
    advance(5000);
    expect(mgr.list()).toEqual([{ code: a.room.code, host: 'Alice', guest: null, arena: 'practice', status: 'waiting', waited: 5 }]);
  });

  test('等人中依等待時間排序（等最久的在前）；剛建立、還沒推進過的房間也列得出來', () => {
    create('Alice');
    advance(10_000);
    create('Bob');
    const list = mgr.list();
    expect(list.map((r) => r.host)).toEqual(['Alice', 'Bob']);
    expect(list.map((r) => r.waited)).toEqual([10, 0]);
  });

  test('客人加入後列為對戰中（帶雙方名稱）；雙方都斷線就不列；房主斷線的等人房間也不列', () => {
    const a = create('Alice');
    join(a.room, 'Bob');
    expect(mgr.list()).toEqual([{ code: a.room.code, host: 'Alice', guest: 'Bob', arena: 'practice', status: 'playing', waited: 0 }]);
    a.room.disconnect(1);
    expect(mgr.list().map((r) => r.status)).toEqual(['playing']);
    a.room.disconnect(0);
    expect(mgr.list()).toEqual([]);
    const c = create('Carol');
    c.room.disconnect(0);
    expect(mgr.list()).toEqual([]);
  });

  test('等人中排在對戰中前面；最多列 20 間等人中、10 間對戰中', () => {
    for (let i = 0; i < 12; i++) join(create(`P${i}`).room, `G${i}`);
    for (let i = 0; i < 25; i++) create(`W${i}`);
    const list = mgr.list();
    expect(list.filter((r) => r.status === 'waiting')).toHaveLength(20);
    expect(list.filter((r) => r.status === 'playing')).toHaveLength(10);
    expect(list.findIndex((r) => r.status === 'playing')).toBe(20);
  });
});

describe('快速加入', () => {
  test('沒有等人的房間：建一間公開房間當房主；下一個快速加入的人（即使同一刻）就加入這間', () => {
    const c1 = new FakeConn();
    const r1 = entered(mgr.quick(c1, 'Alice'));
    expect(r1.side).toBe(0);
    expect(c1.last('room')).toMatchObject({ host: true, public: true });
    const c2 = new FakeConn();
    const r2 = entered(mgr.quick(c2, 'Bob'));
    expect(r2.room).toBe(r1.room);
    expect(r2.side).toBe(1);
    expect(c2.last('room')).toMatchObject({ code: r1.room.code, host: false, public: true });
    expect(r1.room.phase).toBe('picking');
  });

  test('加入等最久的公開房間；略過不公開、房主斷線與對戰中的房間', () => {
    create('Private', false);
    const off = create('Off');
    off.room.disconnect(0);
    const playing = create('Playing');
    join(playing.room, 'Guest');
    advance(1000);
    const target = create('Target');
    advance(1000);
    create('Newer');
    const me = new FakeConn();
    const r = entered(mgr.quick(me, 'Me'));
    expect(r.room).toBe(target.room);
    expect(r.side).toBe(1);
  });

  test('進房訊息標示房間是否公開；斷線重連時也一樣', () => {
    const p = create('Alice', false);
    const first = p.conn.last('room');
    expect(first.public).toBe(false);
    p.room.disconnect(0);
    const again = new FakeConn();
    entered(mgr.resume(p.room.code, first.token, again));
    expect(again.last('room')).toMatchObject({ code: p.room.code, host: true, public: false });
  });
});
