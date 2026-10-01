import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../../src/net/protocol';
import { startServer, type RunningServer } from '../src/app';
import { RoomManager } from '../src/manager';
import { Bot } from './bot';

/**
 * 伺服器整合測試：真的啟動伺服器（隨機連接埠、時間 20 倍速），兩個 Node 機器人透過 WebSocket
 * 用 CPU 邏輯打完整一場 3 對 3，確認協定端到端可用；另外測斷線重連與來源檢查。
 */

/** 時間倍率：一場比賽幾秒內打完 */
const SPEED = 20;

let server: RunningServer;
let url: string;
const bots: Bot[] = [];

beforeEach(async () => {
  server = await startServer({ port: 0, allowedOrigins: ['https://kevintsai1202.github.io'], speed: SPEED, log: () => undefined });
  url = `ws://127.0.0.1:${server.port}/ws`;
});

afterEach(async () => {
  for (const b of bots.splice(0)) b.close();
  await server.close();
});

/** 開一個機器人並等連線 */
async function bot(seed: number, origin?: string): Promise<Bot> {
  const b = new Bot(url, seed, origin);
  bots.push(b);
  await b.open();
  return b;
}

/** 建房、加入、雙方選三顆（第 2 步由機器人收到公開陣容後自動準備完成） */
async function setup(): Promise<[Bot, Bot]> {
  const host = await bot(1);
  host.send({ t: 'create', name: '房主', public: true, v: PROTOCOL_VERSION });
  const room = await host.waitFor('room');
  const guest = await bot(2);
  guest.send({ t: 'join', code: room.code, name: '客人', v: PROTOCOL_VERSION });
  await guest.waitFor('room');
  host.plan = { loadouts: { gale: { disk: null, driver: 'bearing' } } };
  host.send({ t: 'picks', picks: ['blaze', 'turtle', 'gale'] });
  guest.send({ t: 'picks', picks: ['wolf', 'orion', 'pegasus'] });
  return [host, guest];
}

describe('伺服器整合', () => {
  test('兩個機器人透過 WebSocket 打完整一場：雙方看到一致（互為鏡像）的結果', async () => {
    const [host, guest] = await setup();
    const [hr, gr] = await Promise.all([host.waitFor('result'), guest.waitFor('result')]);
    expect(hr.winner).not.toBe(gr.winner);
    expect(hr.score).toEqual([gr.score[1], gr.score[0]]);
    expect(hr.results.length).toBeGreaterThanOrEqual(3);
    expect(hr.results.map((r) => r.mine)).toEqual(gr.results.map((r) => r.theirs));
    expect(hr.results.map((r) => r.winner)).toEqual(gr.results.map((r) => (r.winner === 'me' ? 'them' : 'me')));
    expect(host.all('error')).toEqual([]);
    expect(guest.all('error')).toEqual([]);
    // 每一戰雙方座位相反，第 2 戰房主坐 1 號
    const hb = host.all('battle');
    const gb = guest.all('battle');
    expect(hb.map((b) => b.seat)).toEqual(gb.map((b) => 1 - b.seat));
    expect(hb.find((b) => b.battle === 2 && !b.replay)?.seat).toBe(1);
    // 快照裡雙方的狀態一致（同一份）
    expect(host.all('snap').length).toBeGreaterThan(50);
  }, 90_000);

  test('對戰中斷線：對手收到暫停；用 token 重連後繼續打到結束', async () => {
    const [host, guest] = await setup();
    const token = (await guest.waitFor('room')).token;
    const code = (await host.waitFor('room')).code;
    await guest.waitFor('launched');
    guest.close();
    await host.waitFor('paused');
    const again = await bot(3);
    again.send({ t: 'resume', code, token, v: PROTOCOL_VERSION });
    await host.waitFor('resumed');
    const state = await again.waitFor('launched');
    expect(state.snap.tops).toHaveLength(2);
    const [hr, gr] = await Promise.all([host.waitFor('result'), again.waitFor('result')]);
    expect(hr.winner).not.toBe(gr.winner);
    expect(hr.forfeit).toBe(false);
  }, 90_000);

  test('不在白名單的網頁來源連不上；沒帶來源（機器人）可以連', async () => {
    const evil = new WebSocket(url, { origin: 'https://evil.example.com' });
    const code = await new Promise<number | string>((ok) => {
      evil.once('open', () => ok('open'));
      evil.once('unexpected-response', (_req, res) => ok(res.statusCode ?? 0));
      evil.once('error', () => ok('error'));
    });
    expect(code).toBe(401);
    const good = await bot(9, 'https://kevintsai1202.github.io');
    good.send({ t: 'ping', c: 123 });
    expect((await good.waitFor('pong')).c).toBe(123);
  });

  test('找不到房間與房間已滿會回錯誤訊息', async () => {
    const a = await bot(4);
    a.send({ t: 'join', code: 'ZZZZ', name: 'x', v: PROTOCOL_VERSION });
    expect((await a.waitFor('error')).code).toBe('NOT_FOUND');
    const h = await bot(5);
    h.send({ t: 'create', name: 'h', public: true, v: PROTOCOL_VERSION });
    const { code } = await h.waitFor('room');
    const g = await bot(6);
    g.send({ t: 'join', code, name: 'g', v: PROTOCOL_VERSION });
    await g.waitFor('room');
    const third = await bot(7);
    third.send({ t: 'join', code, name: 't', v: PROTOCOL_VERSION });
    expect((await third.waitFor('error')).code).toBe('ROOM_FULL');
  });

  test('快速加入：兩個機器人先後按，配進同一間；查詢列表看得到等人中、再變成對戰中', async () => {
    const a = await bot(21);
    a.send({ t: 'quick', name: '甲', v: PROTOCOL_VERSION });
    const ra = await a.waitFor('room');
    expect(ra).toMatchObject({ host: true, public: true });
    const viewer = await bot(23);
    viewer.send({ t: 'list' });
    const l1 = await viewer.waitFor('rooms');
    expect(l1.rooms).toEqual([expect.objectContaining({ code: ra.code, host: '甲', guest: null, status: 'waiting' })]);
    const b = await bot(22);
    b.send({ t: 'quick', name: '乙', v: PROTOCOL_VERSION });
    const rb = await b.waitFor('room');
    expect(rb).toMatchObject({ code: ra.code, host: false });
    viewer.send({ t: 'list' });
    const l2 = await viewer.waitFor('rooms', (m) => m !== l1);
    expect(l2.rooms).toEqual([expect.objectContaining({ code: ra.code, host: '甲', guest: '乙', status: 'playing' })]);
  });

  test('舊版網頁（沒帶協定版本）建房、加入、快速加入：回「遊戲已更新，請重新整理」，不會進房；查房間列表照常可用', async () => {
    const old = await bot(41);
    for (const m of [{ t: 'create', name: '舊' }, { t: 'join', code: 'ABCD', name: '舊' }, { t: 'quick', name: '舊' }]) {
      old.ws.send(JSON.stringify(m));
      const e = await old.waitFor('error');
      expect(e).toMatchObject({ code: 'OUTDATED' });
      expect(e.message).toContain('重新整理');
      old.msgs.length = 0;
    }
    expect(old.all('room')).toEqual([]);
    old.send({ t: 'list' });
    expect((await old.waitFor('rooms')).rooms).toEqual([]);
  });

  test('處理訊息時丟出例外：只記錄錯誤，伺服器與這條連線照常服務', async () => {
    // 事件監聽器丟出的例外在 Node 會變成未捕捉例外、整個行程結束（所有房間一起斷線），必須在訊息處理攔下
    const logs: string[] = [];
    const own = await startServer({ port: 0, allowedOrigins: [], speed: SPEED, log: (m) => logs.push(m) });
    const spy = vi.spyOn(RoomManager.prototype, 'join').mockImplementationOnce(() => {
      throw new Error('測試用例外');
    });
    try {
      const b = new Bot(`ws://127.0.0.1:${own.port}/ws`, 11);
      bots.push(b);
      await b.open();
      b.send({ t: 'join', code: 'ABCD', name: 'x', v: PROTOCOL_VERSION });
      b.send({ t: 'ping', c: 7 });
      expect((await b.waitFor('pong', () => true, 5000)).c).toBe(7);
      expect(logs.some((l) => l.includes('測試用例外'))).toBe(true);
    } finally {
      spy.mockRestore();
      await own.close();
    }
  });
});
