import { expect, test } from 'vitest';
import { PROTOCOL_VERSION } from '../src/net/protocol';
import type { TopId } from '../src/sim/types';
import { Bot } from '../server/tests/bot';

/**
 * 線上伺服器檢查：兩個 Node 機器人連正式的對戰伺服器（預設 wss://battle-tops.zeabur.app/ws），
 * 用 CPU 邏輯以真實時間打完整一場 3 對 3（約 2～4 分鐘），確認：
 * - 來源白名單放行 GitHub Pages 的網址；建房、加入、組隊正常。
 * - 雙方的結果互為鏡像（勝負相反、總分對調、每戰對陣一致），沒有錯誤訊息。
 * - 房間列表查得到；列表上沒有別人在等時，兩個機器人快速加入會配進同一間（有人在等就略過，避免配到真實玩家）。
 * 打完整場用不公開的房間，真實玩家的房間列表看不到機器人。並印出往返延遲與對戰中的快照間隔（伺服器每 50 ms 送一次）。
 * 執行（PowerShell 7）：
 *   npx vitest run --project balance live-server-report --reporter=verbose
 *   改測其他伺服器：$env:GAME_SERVER = 'ws://localhost:8787/ws'; npx vitest run --project balance live-server-report --reporter=verbose; Remove-Item Env:GAME_SERVER
 */

/** 要檢查的伺服器 */
const SERVER = process.env.GAME_SERVER ?? 'wss://battle-tops.zeabur.app/ws';
/** 模擬從 GitHub Pages 連線（伺服器只放行白名單上的網頁來源） */
const ORIGIN = 'https://kevintsai1202.github.io';

/** 排序後取百分位數 */
function pct(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

test('線上伺服器：兩個機器人以真實時間打完整一場', async () => {
  const host = new Bot(SERVER, 1, ORIGIN);
  const guest = new Bot(SERVER, 2, ORIGIN);
  try {
    await Promise.all([host.open(), guest.open()]);

    // 往返延遲：連線上各量 10 次
    const rtt: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      host.send({ t: 'ping', c: i });
      await host.waitFor('pong', (m) => m.c === i, 5000);
      rtt.push(performance.now() - t0);
    }

    host.send({ t: 'create', name: '機器人A', public: false, v: PROTOCOL_VERSION });
    const room = await host.waitFor('room', () => true, 10_000);
    guest.send({ t: 'join', code: room.code, name: '機器人B', v: PROTOCOL_VERSION });
    await guest.waitFor('room', () => true, 10_000);
    const hostTeam: TopId[] = ['blaze', 'turtle', 'gale'];
    const guestTeam: TopId[] = ['wolf', 'orion', 'pegasus'];
    // 第 1 步選三顆；第 2 步機器人收到公開陣容後自動準備完成（房主的疾風鳳換軸承軸）
    host.plan = { loadouts: { gale: { disk: null, driver: 'bearing' } } };
    host.send({ t: 'picks', picks: hostTeam });
    guest.send({ t: 'picks', picks: guestTeam });
    const started = performance.now();
    const [hr, gr] = await Promise.all([host.waitFor('result', () => true, 420_000), guest.waitFor('result', () => true, 420_000)]);
    const minutes = (performance.now() - started) / 60_000;

    // 對戰中的快照間隔（一戰之間的空檔超過 1 秒，不算）
    const gaps: number[] = [];
    let prev = -1;
    host.msgs.forEach((m, i) => {
      if (m.t !== 'snap') return;
      const t = host.at[i];
      if (prev >= 0 && t - prev < 1000) gaps.push(t - prev);
      prev = t;
    });

    console.log(`伺服器：${SERVER}（房號 ${room.code}）`);
    console.log(`往返延遲 ms：中位 ${pct(rtt, 0.5).toFixed(0)}、最大 ${Math.max(...rtt).toFixed(0)}`);
    console.log(`整場 ${minutes.toFixed(1)} 分鐘；快照 ${host.all('snap').length} 則；間隔 ms：中位 ${pct(gaps, 0.5).toFixed(0)}、95% ${pct(gaps, 0.95).toFixed(0)}、最大 ${Math.max(...gaps).toFixed(0)}`);
    console.log(`房主：${hr.winner === 'me' ? '勝' : '敗'} ${hr.score.join(' - ')}；戰績 ${hr.results.map((r) => `${r.battle}${r.overtime ? '(延長)' : ''}:${r.mine}vs${r.theirs}→${r.winner}/${r.finish}`).join('，')}`);

    expect(hr.winner).not.toBe(gr.winner);
    expect(hr.score).toEqual([gr.score[1], gr.score[0]]);
    expect(hr.results.map((r) => r.mine)).toEqual(gr.results.map((r) => r.theirs));
    expect(hr.results.map((r) => r.winner)).toEqual(gr.results.map((r) => (r.winner === 'me' ? 'them' : 'me')));
    expect(hr.forfeit).toBe(false);
    expect(host.all('error')).toEqual([]);
    expect(guest.all('error')).toEqual([]);
    // 伺服器每 50 ms 送一次快照：中位數應接近 50
    expect(pct(gaps, 0.5)).toBeGreaterThan(30);
    expect(pct(gaps, 0.5)).toBeLessThan(80);

    // 房間列表與快速加入（新開兩個機器人）
    const q1 = new Bot(SERVER, 3, ORIGIN);
    const q2 = new Bot(SERVER, 4, ORIGIN);
    try {
      await Promise.all([q1.open(), q2.open()]);
      q1.send({ t: 'list' });
      const list = await q1.waitFor('rooms', () => true, 10_000);
      const others = list.rooms.filter((r) => r.status === 'waiting');
      console.log(`房間列表：等人中 ${others.length} 間、對戰中 ${list.rooms.length - others.length} 間`);
      if (others.length) console.log('有人在等，略過快速加入檢查（避免配到真實玩家）');
      else {
        q1.send({ t: 'quick', name: '機器人Q1', v: PROTOCOL_VERSION });
        const r1 = await q1.waitFor('room', () => true, 10_000);
        q2.send({ t: 'quick', name: '機器人Q2', v: PROTOCOL_VERSION });
        const r2 = await q2.waitFor('room', () => true, 10_000);
        console.log(`快速加入：${r1.code}（房主）← ${r2.code}`);
        expect(r1.host).toBe(true);
        expect(r2).toMatchObject({ code: r1.code, host: false });
      }
    } finally {
      q1.close();
      q2.close();
    }
  } finally {
    host.close();
    guest.close();
  }
}, 480_000);
