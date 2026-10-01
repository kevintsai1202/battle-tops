import { describe, expect, test, vi } from 'vitest';
import { MAX_AHEAD_MS, OnlineSession, type Msg } from '../../src/game/online';
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
